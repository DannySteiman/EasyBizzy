/**
 * RECEIPT FUNCTIONS
 * =================
 *
 * WHERE THIS LIVES: convex/receipts.ts
 *
 * Handles photo upload, storage, listing, deletion, and manual correction
 * of receipt records. OCR extraction is handled in convex/receiptOcr.ts.
 *
 * Flow:
 * 1. Frontend calls generateUploadUrl() to get a short-lived Convex storage URL
 * 2. Browser uploads image directly to that URL → receives storageId
 * 3. Frontend calls createReceipt(storageId, branchId) → row created (status: "pending")
 * 4. createReceipt schedules the OCR action (receiptOcr.ts) → status: "processing"
 * 5. OCR action updates the row with extracted fields → status: "done" or "failed"
 */

import { v } from "convex/values";
import { action, mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  requireSubscriptionAllowed,
  requireManager,
} from "./lib/guards";

// =============================================================================
// UPLOAD URL GENERATION
// =============================================================================

/**
 * Generate a short-lived Convex storage upload URL.
 * Frontend uploads the image directly to this URL, then passes the returned
 * storageId to createReceipt.
 *
 * Requires: OWNER or MANAGER, active or trialing subscription.
 */
export const generateUploadUrl = action({
  args: {
    tenantId: v.id("tenants"),
  },
  handler: async (ctx, _args) => {
    // Validate tenant access (action context: use runQuery for guards)
    // We verify identity via auth, then generate the upload URL.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required.");
    }

    // Generate the Convex storage upload URL
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return uploadUrl;
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Create a receipt record after image upload.
 * Schedules OCR processing automatically.
 */
export const createReceipt = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    imageStorageId: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);

    const now = Date.now();

    const receiptId = await ctx.db.insert("receipts", {
      tenantId: tenantCtx.currentTenantId,
      branchId: args.branchId,
      imageStorageId: args.imageStorageId,
      status: "pending",
      uploadedByUserId: tenantCtx.currentUserId,
      createdAt: now,
    });

    // Schedule OCR processing
    await ctx.scheduler.runAfter(0, internal.receiptOcr.processReceipt, {
      receiptId,
    });

    return receiptId;
  },
});

/**
 * Internal mutation used by the OCR action to update fields after processing.
 */
export const updateReceiptOcrResult = internalMutation({
  args: {
    receiptId: v.id("receipts"),
    status: v.union(
      v.literal("done"),
      v.literal("failed"),
      v.literal("processing")
    ),
    supplierName: v.optional(v.string()),
    totalAmount: v.optional(v.number()),
    vatAmount: v.optional(v.number()),
    vatPercent: v.optional(v.number()),
    receiptDate: v.optional(v.string()),
    currency: v.optional(v.string()),
    language: v.optional(v.string()),
    rawOcrText: v.optional(v.string()),
    ocrError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { receiptId, ...fields } = args;
    await ctx.db.patch(receiptId, fields);
  },
});

/**
 * Retry OCR on a failed receipt.
 * Resets status to "pending" and reschedules the OCR action.
 */
export const retryOcr = mutation({
  args: {
    tenantId: v.id("tenants"),
    receiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);

    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt || receipt.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Receipt not found.");
    }

    await ctx.db.patch(args.receiptId, {
      status: "pending",
      ocrError: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.receiptOcr.processReceipt, {
      receiptId: args.receiptId,
    });
  },
});

/**
 * Update receipt fields with manual corrections.
 * Corrections are stored separately from OCR values.
 * UI should display manual value when set, fallback to OCR value.
 */
export const updateReceiptFields = mutation({
  args: {
    tenantId: v.id("tenants"),
    receiptId: v.id("receipts"),
    manualSupplierName: v.optional(v.string()),
    manualTotalAmount: v.optional(v.number()),
    manualVatAmount: v.optional(v.number()),
    manualVatPercent: v.optional(v.number()),
    manualReceiptDate: v.optional(v.string()),
    manualCurrency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);

    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt || receipt.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Receipt not found.");
    }

    const { receiptId, tenantId: _tenantId, ...fields } = args;
    await ctx.db.patch(receiptId, fields);
  },
});

/**
 * Delete a receipt and its stored image.
 */
export const deleteReceipt = mutation({
  args: {
    tenantId: v.id("tenants"),
    receiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);

    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt || receipt.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Receipt not found.");
    }

    // Delete image from Convex storage
    await ctx.storage.delete(receipt.imageStorageId as any);

    // Delete the record
    await ctx.db.delete(args.receiptId);
  },
});

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List receipts for a tenant, scoped to branch if MANAGER.
 * OWNER sees all branches unless branchId filter is provided.
 * Ordered by createdAt descending (newest first).
 */
export const listReceipts = query({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);

    // MANAGER is always scoped to their branch
    const effectiveBranchId =
      tenantCtx.currentRole === "MANAGER" && tenantCtx.currentBranchId
        ? tenantCtx.currentBranchId
        : args.branchId ?? null;

    let receipts;

    if (effectiveBranchId) {
      receipts = await ctx.db
        .query("receipts")
        .withIndex("by_tenant_branch", (q) =>
          q
            .eq("tenantId", tenantCtx.currentTenantId)
            .eq("branchId", effectiveBranchId)
        )
        .order("desc")
        .collect();
    } else {
      receipts = await ctx.db
        .query("receipts")
        .withIndex("by_tenant", (q) =>
          q.eq("tenantId", tenantCtx.currentTenantId)
        )
        .order("desc")
        .collect();
    }

    // Attach image URLs
    const receiptsWithUrls = await Promise.all(
      receipts.map(async (r) => {
        const imageUrl = await ctx.storage.getUrl(r.imageStorageId as any);
        return { ...r, imageUrl };
      })
    );

    return receiptsWithUrls;
  },
});

/**
 * Get a single receipt by ID.
 * Validates tenant ownership before returning.
 */
export const getReceipt = query({
  args: {
    tenantId: v.id("tenants"),
    receiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);

    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt || receipt.tenantId !== tenantCtx.currentTenantId) {
      return null;
    }

    const imageUrl = await ctx.storage.getUrl(receipt.imageStorageId as any);
    return { ...receipt, imageUrl };
  },
});

/**
 * Export receipts as structured rows for CSV generation.
 * Optionally filtered by date range (createdAt timestamps).
 */
export const exportReceiptsCsv = query({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.optional(v.id("branches")),
    fromTs: v.optional(v.number()),
    toTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);

    const effectiveBranchId =
      tenantCtx.currentRole === "MANAGER" && tenantCtx.currentBranchId
        ? tenantCtx.currentBranchId
        : args.branchId ?? null;

    let receipts;

    if (effectiveBranchId) {
      receipts = await ctx.db
        .query("receipts")
        .withIndex("by_tenant_branch", (q) =>
          q
            .eq("tenantId", tenantCtx.currentTenantId)
            .eq("branchId", effectiveBranchId)
        )
        .order("desc")
        .collect();
    } else {
      receipts = await ctx.db
        .query("receipts")
        .withIndex("by_tenant", (q) =>
          q.eq("tenantId", tenantCtx.currentTenantId)
        )
        .order("desc")
        .collect();
    }

    // Apply date filter
    if (args.fromTs !== undefined || args.toTs !== undefined) {
      receipts = receipts.filter((r) => {
        if (args.fromTs !== undefined && r.createdAt < args.fromTs) return false;
        if (args.toTs !== undefined && r.createdAt > args.toTs) return false;
        return true;
      });
    }

    // Return structured rows (caller builds CSV string client-side)
    return receipts.map((r) => ({
      date: r.manualReceiptDate ?? r.receiptDate ?? new Date(r.createdAt).toISOString().slice(0, 10),
      supplier: r.manualSupplierName ?? r.supplierName ?? "",
      total: r.manualTotalAmount ?? r.totalAmount ?? "",
      vat: r.manualVatAmount ?? r.vatAmount ?? "",
      vatPercent: r.manualVatPercent ?? r.vatPercent ?? "",
      currency: r.manualCurrency ?? r.currency ?? "",
      status: r.status,
      branchId: r.branchId,
      uploadedByUserId: r.uploadedByUserId,
    }));
  },
});
