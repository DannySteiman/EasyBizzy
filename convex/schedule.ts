/**
 * SCHEDULE MODULE
 * ===============
 * Manager scheduling: assign workers to shift template slots for a given week.
 * Uses slotAvailabilities (worker selections) and slotAssignments (manager assignments).
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireRole, requireSubscriptionAllowed } from "./lib/guards";

async function assertBranchBelongsToTenant(
  ctx: { db: { get: (id: Id<"branches">) => Promise<{ tenantId: Id<"tenants">; name: string; isArchived?: boolean } | null> } },
  tenantId: Id<"tenants">,
  branchId: Id<"branches">
) {
  const branch = await ctx.db.get(branchId);
  if (!branch || branch.tenantId !== tenantId || branch.isArchived) {
    throw new Error("Branch not found.");
  }
  return branch;
}

async function assertSlotBelongsToTenantBranch(
  ctx: { db: { get: (id: Id<"shiftSlotTemplates">) => Promise<{ tenantId: Id<"tenants">; branchId: Id<"branches">; isArchived?: boolean } | null> } },
  tenantId: Id<"tenants">,
  branchId: Id<"branches">,
  slotTemplateId: Id<"shiftSlotTemplates">
) {
  const slot = await ctx.db.get(slotTemplateId);
  if (!slot || slot.tenantId !== tenantId || slot.branchId !== branchId || slot.isArchived) {
    throw new Error("Shift slot not found.");
  }
  return slot;
}

function canSeeAvailabilitiesForWeek(_weekStart: string): { canSee: boolean; reason?: string } {
  return { canSee: true };
}

// -----------------------------------------------------------------------------
// A) getWeek
// -----------------------------------------------------------------------------
export const getWeek = query({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const branch = await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);

    const templates = await ctx.db
      .query("shiftSlotTemplates")
      .withIndex("by_tenant_branch", (q) =>
        q.eq("tenantId", tenantCtx.currentTenantId).eq("branchId", args.branchId)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    templates.sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startMin - b.startMin;
    });

    const assignments = await ctx.db
      .query("slotAssignments")
      .withIndex("by_tenant_branch_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("branchId", args.branchId)
          .eq("weekStart", args.weekStart)
      )
      .collect();

    const assignmentsBySlot = new Map<string, string[]>();
    for (const a of assignments) {
      const key = String(a.slotTemplateId);
      const list = assignmentsBySlot.get(key) ?? [];
      list.push(a.workerUserId);
      assignmentsBySlot.set(key, list);
    }

    const visibility = canSeeAvailabilitiesForWeek(args.weekStart);
    let availabilitiesBySlot = new Map<string, string[]>();

    if (visibility.canSee) {
      const availRows = await ctx.db
        .query("slotAvailabilities")
        .withIndex("by_tenant_branch_week", (q) =>
          q
            .eq("tenantId", tenantCtx.currentTenantId)
            .eq("branchId", args.branchId)
            .eq("weekStart", args.weekStart)
        )
        .collect();

      for (const row of availRows) {
        const key = String(row.slotTemplateId);
        const list = availabilitiesBySlot.get(key) ?? [];
        if (!list.includes(row.workerUserId)) list.push(row.workerUserId);
        availabilitiesBySlot.set(key, list);
      }
    }

    const slots = templates.map((t) => {
      const slotKey = String(t._id);
      const assigned = assignmentsBySlot.get(slotKey) ?? [];
      const available = visibility.canSee ? (availabilitiesBySlot.get(slotKey) ?? []) : [];
      return {
        slotTemplateId: t._id,
        dayOfWeek: t.dayOfWeek,
        startMin: t.startMin,
        endMin: t.endMin,
        label: t.label ?? undefined,
        assignedWorkerUserIds: assigned,
        availableWorkerUserIds: available,
      };
    });

    return {
      weekStart: args.weekStart,
      branch: { _id: args.branchId, name: branch.name },
      visibility,
      slots,
    };
  },
});

// -----------------------------------------------------------------------------
// B) listAvailableWorkersForSlot
// -----------------------------------------------------------------------------
export const listAvailableWorkersForSlot = query({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(),
    slotTemplateId: v.id("shiftSlotTemplates"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const visibility = canSeeAvailabilitiesForWeek(args.weekStart);
    if (!visibility.canSee) {
      return { visible: false, workers: [] };
    }

    await assertSlotBelongsToTenantBranch(
      ctx,
      tenantCtx.currentTenantId,
      args.branchId,
      args.slotTemplateId
    );

    const rows = await ctx.db
      .query("slotAvailabilities")
      .withIndex("by_slot_week", (q) =>
        q.eq("slotTemplateId", args.slotTemplateId).eq("weekStart", args.weekStart)
      )
      .collect();

    const workerIds = [...new Set(rows.map((r) => r.workerUserId))];
    return { visible: true, workers: workerIds };
  },
});

// -----------------------------------------------------------------------------
// C) setAssignmentsForSlot
// -----------------------------------------------------------------------------
export const setAssignmentsForSlot = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(),
    slotTemplateId: v.id("shiftSlotTemplates"),
    workerUserIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);
    await assertSlotBelongsToTenantBranch(
      ctx,
      tenantCtx.currentTenantId,
      args.branchId,
      args.slotTemplateId
    );

    const memberships = await ctx.db
      .query("userTenants")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .collect();

    const workersInBranch = new Map<string, { role: string; branchId: Id<"branches"> | undefined }>();
    for (const m of memberships) {
      if (m.role === "WORKER" && m.branchId === args.branchId) {
        workersInBranch.set(m.userId, { role: m.role, branchId: m.branchId });
      }
    }

    for (const uid of args.workerUserIds) {
      const m = workersInBranch.get(uid);
      if (m && m.role === "WORKER") {
        continue;
      }
      const hasAvailability = await ctx.db
        .query("slotAvailabilities")
        .withIndex("by_slot_week", (q) =>
          q.eq("slotTemplateId", args.slotTemplateId).eq("weekStart", args.weekStart)
        )
        .filter((q) => q.eq(q.field("workerUserId"), uid))
        .first();
      if (hasAvailability) {
        continue;
      }
      throw new Error(`Worker ${uid} is not a valid WORKER in this branch and has no availability for this slot.`);
    }

    const existing = await ctx.db
      .query("slotAssignments")
      .withIndex("by_slot_week", (q) =>
        q.eq("slotTemplateId", args.slotTemplateId).eq("weekStart", args.weekStart)
      )
      .collect();

    for (const row of existing) {
      if (row.tenantId === tenantCtx.currentTenantId && row.branchId === args.branchId) {
        await ctx.db.delete(row._id);
      }
    }

    const now = Date.now();
    for (const workerUserId of args.workerUserIds) {
      await ctx.db.insert("slotAssignments", {
        tenantId: tenantCtx.currentTenantId,
        branchId: args.branchId,
        weekStart: args.weekStart,
        slotTemplateId: args.slotTemplateId,
        workerUserId,
        createdAt: now,
        createdByUserId: tenantCtx.currentUserId,
      });
    }

    return { count: args.workerUserIds.length };
  },
});

// -----------------------------------------------------------------------------
// D) getPublishStatus
// -----------------------------------------------------------------------------
export const getPublishStatus = query({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);

    const row = await ctx.db
      .query("schedulePublishes")
      .withIndex("by_tenant_branch_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("branchId", args.branchId)
          .eq("weekStart", args.weekStart)
      )
      .first();

    if (!row) {
      return { status: "DRAFT" as const };
    }
    return {
      status: row.status,
      publishedAt: row.publishedAt,
      publishedByUserId: row.publishedByUserId,
    };
  },
});

// -----------------------------------------------------------------------------
// E) publishWeek
// -----------------------------------------------------------------------------
export const publishWeek = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    weekStart: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);

    const existing = await ctx.db
      .query("schedulePublishes")
      .withIndex("by_tenant_branch_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("branchId", args.branchId)
          .eq("weekStart", args.weekStart)
      )
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "PUBLISHED",
        publishedAt: now,
        publishedByUserId: tenantCtx.currentUserId,
      });
    } else {
      await ctx.db.insert("schedulePublishes", {
        tenantId: tenantCtx.currentTenantId,
        branchId: args.branchId,
        weekStart: args.weekStart,
        status: "PUBLISHED",
        publishedAt: now,
        publishedByUserId: tenantCtx.currentUserId,
        createdAt: now,
      });
    }
    return { status: "PUBLISHED" as const, publishedAt: now };
  },
});

// -----------------------------------------------------------------------------
// F) workerGetWeek
// -----------------------------------------------------------------------------
export const workerGetWeek = query({
  args: {
    tenantId: v.id("tenants"),
    weekStart: v.string(),
    branchId: v.optional(v.id("branches")), // For OWNER/SAAS_ADMIN dev impersonation
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);

    let branchId: Id<"branches"> | null;

    if (tenantCtx.currentRole === "WORKER") {
      requireRole(tenantCtx, ["WORKER"]);
      branchId = tenantCtx.currentBranchId;
    } else if (tenantCtx.isSaasAdmin || tenantCtx.currentRole === "OWNER") {
      if (!args.branchId) {
        return {
          published: false,
          weekStart: args.weekStart,
          slots: [],
        };
      }
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.tenantId !== tenantCtx.currentTenantId) {
        return {
          published: false,
          weekStart: args.weekStart,
          slots: [],
        };
      }
      branchId = args.branchId;
    } else {
      requireRole(tenantCtx, ["WORKER"]);
      branchId = tenantCtx.currentBranchId;
    }

    if (!branchId) {
      return {
        published: false,
        weekStart: args.weekStart,
        slots: [],
      };
    }

    const publishRow = await ctx.db
      .query("schedulePublishes")
      .withIndex("by_tenant_branch_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("branchId", branchId)
          .eq("weekStart", args.weekStart)
      )
      .first();

    if (!publishRow || publishRow.status !== "PUBLISHED") {
      return {
        published: false,
        weekStart: args.weekStart,
        slots: [],
      };
    }

    const templates = await ctx.db
      .query("shiftSlotTemplates")
      .withIndex("by_tenant_branch", (q) =>
        q.eq("tenantId", tenantCtx.currentTenantId).eq("branchId", branchId)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    const templateById = new Map(templates.map((t) => [String(t._id), t]));

    const assignments = await ctx.db
      .query("slotAssignments")
      .withIndex("by_tenant_branch_week", (q) =>
        q
          .eq("tenantId", tenantCtx.currentTenantId)
          .eq("branchId", branchId)
          .eq("weekStart", args.weekStart)
      )
      .collect();

    const myAssignments = assignments.filter((a) => a.workerUserId === tenantCtx.currentUserId);

    const branch = await ctx.db.get(branchId);
    if (!branch) {
      return { published: false, weekStart: args.weekStart, slots: [] };
    }

    const mySlots = myAssignments
      .map((a) => {
        const t = templateById.get(String(a.slotTemplateId));
        if (!t) return null;
        return {
          dayOfWeek: t.dayOfWeek,
          startMin: t.startMin,
          endMin: t.endMin,
          label: t.label ?? undefined,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => {
        if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
        return a.startMin - b.startMin;
      });

    return {
      published: true,
      weekStart: args.weekStart,
      branch: { _id: branchId, name: branch.name },
      mySlots,
    };
  },
});

// -----------------------------------------------------------------------------
// G) getCutoffSettings
// -----------------------------------------------------------------------------
export const getCutoffSettings = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const row = await ctx.db
      .query("availabilitySettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .first();

    return { cutoffDayOfWeek: row?.cutoffDayOfWeek ?? 3 };
  },
});

// -----------------------------------------------------------------------------
// H) setCutoffSettings
// -----------------------------------------------------------------------------
export const setCutoffSettings = mutation({
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
