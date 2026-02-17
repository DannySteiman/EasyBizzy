/**
 * AVAILABILITY MODULE
 * ===================
 * Worker availability submission: workers select which shift template slots
 * they can work for a given week (this week / next week). Cutoff and edit lock enforced.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireRole, requireSubscriptionAllowed } from "./lib/guards";
import { getCurrentDayOfWeek, getCurrentWeekStartISO, getNextWeekStartISO } from "./lib/weekUtils";

// -----------------------------------------------------------------------------
// A) getSettings
// -----------------------------------------------------------------------------
export const getSettings = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER", "WORKER"]);

    const row = await ctx.db
      .query("availabilitySettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .first();

    return { cutoffDayOfWeek: row?.cutoffDayOfWeek ?? 3 };
  },
});

// -----------------------------------------------------------------------------
// B) setCutoffDay
// -----------------------------------------------------------------------------
export const setCutoffDay = mutation({
  args: {
    tenantId: v.id("tenants"),
    cutoffDayOfWeek: v.number(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    if (!Number.isInteger(args.cutoffDayOfWeek) || args.cutoffDayOfWeek < 0 || args.cutoffDayOfWeek > 6) {
      throw new Error("cutoffDayOfWeek must be between 0 and 6 (0=Monday, 6=Sunday).");
    }

    const existing = await ctx.db
      .query("availabilitySettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { cutoffDayOfWeek: args.cutoffDayOfWeek });
    } else {
      await ctx.db.insert("availabilitySettings", {
        tenantId: tenantCtx.currentTenantId,
        cutoffDayOfWeek: args.cutoffDayOfWeek,
        createdAt: now,
      });
    }
    return { ok: true };
  },
});

// -----------------------------------------------------------------------------
// C) getMyWeek
// -----------------------------------------------------------------------------
export const getMyWeek = query({
  args: {
    tenantId: v.id("tenants"),
    weekStart: v.string(),
    branchId: v.optional(v.id("branches")), // For OWNER/SAAS_ADMIN dev impersonation
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);

    let workerBranchId: Id<"branches"> | null;

    if (tenantCtx.currentRole === "WORKER") {
      requireRole(tenantCtx, ["WORKER"]);
      workerBranchId = tenantCtx.currentBranchId;
    } else if (tenantCtx.isSaasAdmin || tenantCtx.currentRole === "OWNER") {
      if (!args.branchId) {
        throw new Error("When testing as worker, select a branch first.");
      }
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.tenantId !== tenantCtx.currentTenantId) {
        throw new Error("Branch not found.");
      }
      workerBranchId = args.branchId;
    } else {
      requireRole(tenantCtx, ["WORKER"]);
      workerBranchId = tenantCtx.currentBranchId;
    }

    if (!workerBranchId) {
      throw new Error("You must be assigned to a branch. Contact your manager.");
    }

    const workerUserId = tenantCtx.currentUserId;
    const branch = await ctx.db.get(workerBranchId);
    if (!branch || branch.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Branch not found.");
    }

    const settings = await ctx.db
      .query("availabilitySettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .first();
    const cutoffDayOfWeek = settings?.cutoffDayOfWeek ?? 3;

    const templates = await ctx.db
      .query("shiftSlotTemplates")
      .withIndex("by_tenant_branch", (q) =>
        q.eq("tenantId", tenantCtx.currentTenantId).eq("branchId", workerBranchId)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    templates.sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startMin - b.startMin;
    });

    const availabilities = await ctx.db
      .query("slotAvailabilities")
      .withIndex("by_tenant_worker_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("workerUserId", workerUserId)
          .eq("weekStart", args.weekStart)
      )
      .collect();

    const selectedIds = new Set(availabilities.map((a) => String(a.slotTemplateId)));

    const currentWeekStart = getCurrentWeekStartISO();
    const currentDayOfWeek = getCurrentDayOfWeek();
    const nextWeekStart = getNextWeekStartISO();

    let isEditable: boolean;
    if (args.weekStart === currentWeekStart) {
      isEditable = currentDayOfWeek <= cutoffDayOfWeek;
    } else if (args.weekStart === nextWeekStart) {
      isEditable = true; // v1: always allow editing next week
    } else {
      isEditable = false; // past weeks or far future
    }

    const slots = templates.map((t) => ({
      slotTemplateId: t._id,
      dayOfWeek: t.dayOfWeek,
      startMin: t.startMin,
      endMin: t.endMin,
      label: t.label ?? undefined,
      isSelected: selectedIds.has(String(t._id)),
    }));

    return {
      branch: { _id: branch._id, name: branch.name },
      weekStart: args.weekStart,
      cutoffDayOfWeek,
      isEditable,
      slots,
    };
  },
});

// -----------------------------------------------------------------------------
// D) setMySelections
// -----------------------------------------------------------------------------
export const setMySelections = mutation({
  args: {
    tenantId: v.id("tenants"),
    weekStart: v.string(),
    selectedSlotTemplateIds: v.array(v.id("shiftSlotTemplates")),
    branchId: v.optional(v.id("branches")), // For OWNER/SAAS_ADMIN dev impersonation
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);

    let workerBranchId: Id<"branches"> | null;

    if (tenantCtx.currentRole === "WORKER") {
      requireRole(tenantCtx, ["WORKER"]);
      workerBranchId = tenantCtx.currentBranchId;
    } else if (tenantCtx.isSaasAdmin || tenantCtx.currentRole === "OWNER") {
      if (!args.branchId) {
        throw new Error("When testing as worker, select a branch first.");
      }
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.tenantId !== tenantCtx.currentTenantId) {
        throw new Error("Branch not found.");
      }
      workerBranchId = args.branchId;
    } else {
      requireRole(tenantCtx, ["WORKER"]);
      workerBranchId = tenantCtx.currentBranchId;
    }

    const workerUserId = tenantCtx.currentUserId;

    if (!workerBranchId) {
      throw new Error("You must be assigned to a branch. Contact your manager.");
    }

    const currentWeekStart = getCurrentWeekStartISO();
    const currentDayOfWeek = getCurrentDayOfWeek();
    const settings = await ctx.db
      .query("availabilitySettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .first();
    const cutoffDayOfWeek = settings?.cutoffDayOfWeek ?? 3;

    if (args.weekStart === currentWeekStart && currentDayOfWeek > cutoffDayOfWeek) {
      throw new Error("Availability for this week is closed.");
    }

    for (const slotId of args.selectedSlotTemplateIds) {
      const slot = await ctx.db.get(slotId);
      if (
        !slot ||
        slot.tenantId !== tenantCtx.currentTenantId ||
        slot.branchId !== workerBranchId ||
        slot.isArchived
      ) {
        throw new Error("Invalid shift slot. One or more slots do not belong to your branch.");
      }
    }

    const existing = await ctx.db
      .query("slotAvailabilities")
      .withIndex("by_tenant_worker_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("workerUserId", workerUserId)
          .eq("weekStart", args.weekStart)
      )
      .collect();

    for (const row of existing) {
      if (row.branchId === workerBranchId) {
        await ctx.db.delete(row._id);
      }
    }

    const now = Date.now();
    for (const slotId of args.selectedSlotTemplateIds) {
      await ctx.db.insert("slotAvailabilities", {
        tenantId: tenantCtx.currentTenantId,
        branchId: workerBranchId,
        weekStart: args.weekStart,
        workerUserId,
        slotTemplateId: slotId,
        createdAt: now,
      });
    }

    return { count: args.selectedSlotTemplateIds.length };
  },
});

// -----------------------------------------------------------------------------
// E) listWeekForManager (stub for 6.6C)
// -----------------------------------------------------------------------------
export const listWeekForManager = query({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.tenantId !== tenantCtx.currentTenantId || branch.isArchived) {
      throw new Error("Branch not found.");
    }

    const rows = await ctx.db
      .query("slotAvailabilities")
      .withIndex("by_tenant_branch_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("branchId", args.branchId)
          .eq("weekStart", args.weekStart)
      )
      .collect();

    const bySlot = new Map<string, string[]>();
    for (const row of rows) {
      const key = String(row.slotTemplateId);
      const list = bySlot.get(key) ?? [];
      list.push(row.workerUserId);
      bySlot.set(key, list);
    }

    const items = Array.from(bySlot.entries()).map(([slotId, workerUserIds]) => ({
      slotTemplateId: slotId as Id<"shiftSlotTemplates">,
      workerUserIds,
    }));

    return { visible: true, items };
  },
});
