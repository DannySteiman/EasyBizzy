import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireRole, requireSubscriptionAllowed } from "./lib/guards";

type ConvexCtx = QueryCtx | MutationCtx;

function validateDayOfWeek(dayOfWeek: number) {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error("Day of week must be between 0 and 6.");
  }
}

function validateStartMin(startMin: number) {
  if (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439) {
    throw new Error("Start time must be between 00:00 and 23:59.");
  }
}

function validateEndMin(endMin: number) {
  if (!Number.isInteger(endMin) || endMin < 1 || endMin > 1440) {
    throw new Error("End time must be between 00:01 and 24:00.");
  }
}

function validateShiftRange(dayOfWeek: number, startMin: number, endMin: number) {
  validateDayOfWeek(dayOfWeek);
  validateStartMin(startMin);
  validateEndMin(endMin);
  if (endMin <= startMin) {
    throw new Error("End time must be after start time.");
  }
}

function normalizeLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

function normalizePosition(position: string | undefined): string | undefined {
  if (position === undefined) return undefined;
  const trimmed = position.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

async function assertBranchBelongsToTenant(
  ctx: ConvexCtx,
  tenantId: Id<"tenants">,
  branchId: Id<"branches">
) {
  const branch = await ctx.db.get(branchId);
  if (!branch || branch.tenantId !== tenantId || branch.isArchived) {
    throw new Error("Location not found.");
  }
  return branch;
}

async function findDuplicateSlot(
  ctx: ConvexCtx,
  tenantId: Id<"tenants">,
  branchId: Id<"branches">,
  dayOfWeek: number,
  startMin: number,
  endMin: number,
  position: string | undefined,
  excludeSlotId?: Id<"shiftSlotTemplates">
) {
  const daySlots = await ctx.db
    .query("shiftSlotTemplates")
    .withIndex("by_tenant_branch_day", (q) =>
      q.eq("tenantId", tenantId).eq("branchId", branchId).eq("dayOfWeek", dayOfWeek)
    )
    .filter((q) => q.neq(q.field("isArchived"), true))
    .collect();

  return daySlots.find(
    (slot) =>
      slot.startMin === startMin &&
      slot.endMin === endMin &&
      normalizePosition(slot.position) === normalizePosition(position) &&
      String(slot._id) !== String(excludeSlotId)
  );
}

export const list = query({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);

    const slots = await ctx.db
      .query("shiftSlotTemplates")
      .withIndex("by_tenant_branch", (q) =>
        q.eq("tenantId", tenantCtx.currentTenantId).eq("branchId", args.branchId)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    slots.sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startMin - b.startMin;
    });

    return slots;
  },
});

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    dayOfWeek: v.number(),
    startMin: v.number(),
    endMin: v.number(),
    position: v.optional(v.string()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);
    validateShiftRange(args.dayOfWeek, args.startMin, args.endMin);

    const duplicate = await findDuplicateSlot(
      ctx,
      tenantCtx.currentTenantId,
      args.branchId,
      args.dayOfWeek,
      args.startMin,
      args.endMin,
      normalizePosition(args.position)
    );
    if (duplicate) {
      throw new Error("This shift slot already exists.");
    }

    const slotId = await ctx.db.insert("shiftSlotTemplates", {
      tenantId: tenantCtx.currentTenantId,
      branchId: args.branchId,
      dayOfWeek: args.dayOfWeek,
      startMin: args.startMin,
      endMin: args.endMin,
      position: normalizePosition(args.position),
      label: normalizeLabel(args.label),
      createdAt: Date.now(),
      createdByUserId: tenantCtx.currentUserId,
      isArchived: false,
    });

    return await ctx.db.get(slotId);
  },
});

export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    slotId: v.id("shiftSlotTemplates"),
    dayOfWeek: v.optional(v.number()),
    startMin: v.optional(v.number()),
    endMin: v.optional(v.number()),
    position: v.optional(v.string()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const existing = await ctx.db.get(args.slotId);
    if (!existing || existing.tenantId !== tenantCtx.currentTenantId || existing.isArchived) {
      throw new Error("Shift slot not found.");
    }

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, existing.branchId);

    const nextDay = args.dayOfWeek ?? existing.dayOfWeek;
    const nextStart = args.startMin ?? existing.startMin;
    const nextEnd = args.endMin ?? existing.endMin;
    const nextPosition = args.position !== undefined ? normalizePosition(args.position) : normalizePosition(existing.position);

    validateShiftRange(nextDay, nextStart, nextEnd);

    const duplicate = await findDuplicateSlot(
      ctx,
      tenantCtx.currentTenantId,
      existing.branchId,
      nextDay,
      nextStart,
      nextEnd,
      nextPosition,
      args.slotId
    );
    if (duplicate) {
      throw new Error("This shift slot already exists.");
    }

    const patch: {
      dayOfWeek?: number;
      startMin?: number;
      endMin?: number;
      position?: string;
      label?: string;
    } = {};

    if (args.dayOfWeek !== undefined) patch.dayOfWeek = nextDay;
    if (args.startMin !== undefined) patch.startMin = nextStart;
    if (args.endMin !== undefined) patch.endMin = nextEnd;
    if (args.position !== undefined) patch.position = nextPosition;
    if (args.label !== undefined) patch.label = normalizeLabel(args.label);

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.slotId, patch);
    }

    return await ctx.db.get(args.slotId);
  },
});

export const remove = mutation({
  args: {
    tenantId: v.id("tenants"),
    slotId: v.id("shiftSlotTemplates"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const existing = await ctx.db.get(args.slotId);
    if (!existing || existing.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Shift slot not found.");
    }

    if (existing.isArchived) {
      return { ok: true };
    }

    await ctx.db.patch(args.slotId, { isArchived: true });
    return { ok: true };
  },
});
