/**
 * TEAM FUNCTIONS - Email allowlist + branch assignment
 * ===================================================
 *
 * WHERE THIS LIVES: convex/team.ts
 *
 * Supports:
 * - Owners configuring MANAGER/WORKER access by email (no invite flow)
 * - Branch assignment required when tenant has > 1 branch
 * - Syncing memberships automatically on login based on email
 */

import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireOwner, requireRole, requireTenantContext } from "./lib/guards";

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function assertValidEmail(email: string) {
  const normalized = normalizeEmail(email);
  // Minimal validation (not exhaustive)
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  if (!ok) {
    throw new Error("Invalid email address");
  }
  return normalized;
}

type ConvexCtx = QueryCtx | MutationCtx;

async function getTenantBranches(ctx: ConvexCtx, tenantId: Id<"tenants">) {
  const branches = await ctx.db
    .query("branches")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .filter((q) => q.neq(q.field("isArchived"), true))
    .collect();

  const mainBranch = branches.find((b: any) => b.isMainBranch) ?? null;

  return {
    branches,
    branchCount: branches.length,
    mainBranch,
  };
}

async function assertBranchBelongsToTenant(
  ctx: ConvexCtx,
  tenantId: Id<"tenants">,
  branchId: Id<"branches">
) {
  const branch = await ctx.db.get(branchId);
  if (!branch || branch.tenantId !== tenantId || branch.isArchived) {
    throw new Error("Branch not found");
  }
  return branch;
}

function resolveBranchForRole(options: {
  branchCount: number;
  role: "MANAGER" | "WORKER";
  branchId?: Id<"branches">;
  mainBranchId?: Id<"branches"> | null;
}) {
  const { branchCount, role } = options;
  let branchId = options.branchId;

  // BRANCH RULES:
  // - If branchCount > 1: branchId MUST be provided (for both MANAGER and WORKER)
  // - If branchCount == 1: branchId optional; default to main branch for safety
  if (branchCount > 1) {
    if (!branchId) {
      throw new Error(`Branch is required for ${role} when tenant has multiple locations`);
    }
    return branchId;
  }

  if (!branchId) {
    if (!options.mainBranchId) {
      throw new Error("Main branch not found");
    }
    branchId = options.mainBranchId;
  }

  return branchId;
}

// =============================================================================
// A) Query: listTeamAccess
// =============================================================================

export const listTeamAccess = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const tenantCtx = await requireTenantContext(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const branches = await ctx.db
      .query("branches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    const members = await ctx.db
      .query("userTenants")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .collect();

    const accessEmails = await ctx.db
      .query("tenantAccessEmails")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .collect();

    return {
      branches: branches.map((b) => ({ _id: b._id, name: b.name, isMainBranch: b.isMainBranch })),
      members: members.map((m) => ({
        membershipId: m._id,
        userId: m.userId,
        role: m.role,
        branchId: m.branchId ?? null,
        createdAt: m.createdAt,
      })),
      accessEmails: accessEmails.map((a) => ({
        accessId: a._id,
        email: a.email,
        role: a.role,
        branchId: a.branchId ?? null,
        createdAt: a.createdAt,
      })),
    };
  },
});

// =============================================================================
// C) Mutation: addAccessEmail
// =============================================================================

export const addAccessEmail = mutation({
  args: {
    tenantId: v.id("tenants"),
    email: v.string(),
    role: v.union(v.literal("MANAGER"), v.literal("WORKER")),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireTenantContext(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const email = assertValidEmail(args.email);
    const role = args.role;

    const { branchCount, mainBranch } = await getTenantBranches(ctx, tenantCtx.currentTenantId);
    const resolvedBranchId = resolveBranchForRole({
      branchCount,
      role,
      branchId: args.branchId,
      mainBranchId: mainBranch?._id ?? null,
    });

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, resolvedBranchId);

    const existing = await ctx.db
      .query("tenantAccessEmails")
      .withIndex("by_tenant_email", (q) =>
        q.eq("tenantId", tenantCtx.currentTenantId).eq("email", email)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role,
        branchId: resolvedBranchId,
      });

      const saved = await ctx.db.get(existing._id);
      return saved;
    }

    const accessId = await ctx.db.insert("tenantAccessEmails", {
      tenantId: tenantCtx.currentTenantId,
      email,
      role,
      branchId: resolvedBranchId,
      createdAt: Date.now(),
      createdByUserId: tenantCtx.currentUserId,
    });

    return await ctx.db.get(accessId);
  },
});

// =============================================================================
// D) Mutation: updateAccessEmail
// =============================================================================

export const updateAccessEmail = mutation({
  args: {
    tenantId: v.id("tenants"),
    accessId: v.id("tenantAccessEmails"),
    role: v.optional(v.union(v.literal("MANAGER"), v.literal("WORKER"))),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireTenantContext(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const access = await ctx.db.get(args.accessId);
    if (!access || access.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Access email not found");
    }

    const nextRole = args.role ?? access.role;
    const { branchCount, mainBranch } = await getTenantBranches(ctx, tenantCtx.currentTenantId);
    const nextBranchId = resolveBranchForRole({
      branchCount,
      role: nextRole,
      branchId: args.branchId ?? access.branchId ?? undefined,
      mainBranchId: mainBranch?._id ?? null,
    });

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, nextBranchId);

    await ctx.db.patch(args.accessId, {
      ...(args.role ? { role: args.role } : {}),
      branchId: nextBranchId,
    });

    return await ctx.db.get(args.accessId);
  },
});

// =============================================================================
// E) Mutation: removeAccessEmail
// =============================================================================

export const removeAccessEmail = mutation({
  args: {
    tenantId: v.id("tenants"),
    accessId: v.id("tenantAccessEmails"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireTenantContext(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const access = await ctx.db.get(args.accessId);
    if (!access || access.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Access email not found");
    }

    await ctx.db.delete(args.accessId);
    return { success: true };
  },
});

// =============================================================================
// F) Mutation: removeMember
// =============================================================================

export const removeMember = mutation({
  args: {
    tenantId: v.id("tenants"),
    membershipId: v.id("userTenants"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireTenantContext(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Member not found");
    }

    // Prevent removing self OWNER membership
    if (membership.userId === tenantCtx.currentUserId && membership.role === "OWNER") {
      throw new Error("You cannot remove your own owner membership");
    }

    await ctx.db.delete(args.membershipId);
    return { success: true };
  },
});

// =============================================================================
// G) Mutation: updateMemberBranch
// =============================================================================

export const updateMemberBranch = mutation({
  args: {
    tenantId: v.id("tenants"),
    membershipId: v.id("userTenants"),
    branchId: v.id("branches"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireTenantContext(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Member not found");
    }

    if (membership.role === "OWNER") {
      throw new Error("Cannot change branch for OWNER");
    }

    const { branchCount } = await getTenantBranches(ctx, tenantCtx.currentTenantId);
    if (branchCount > 1 && !args.branchId) {
      throw new Error("Branch is required when tenant has multiple locations");
    }

    await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);

    await ctx.db.patch(args.membershipId, {
      branchId: args.branchId,
    });

    return { success: true };
  },
});

// =============================================================================
// H) Mutation: syncMyAccessFromEmail
// =============================================================================

export const syncMyAccessFromEmail = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.email) {
      throw new Error("Authentication with email required");
    }

    const userId = identity.subject;
    const email = normalizeEmail(identity.email);

    const entries = await ctx.db
      .query("tenantAccessEmails")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();

    const tenantIds: Id<"tenants">[] = [];
    let upserts = 0;

    for (const entry of entries) {
      const tenant = await ctx.db.get(entry.tenantId);
      if (!tenant) continue;

      tenantIds.push(entry.tenantId);

      // Resolve target branch (fail closed)
      const { branchCount, mainBranch } = await getTenantBranches(ctx, entry.tenantId);
      const targetBranchId = resolveBranchForRole({
        branchCount,
        role: entry.role,
        branchId: entry.branchId ?? undefined,
        mainBranchId: mainBranch?._id ?? null,
      });

      await assertBranchBelongsToTenant(ctx, entry.tenantId, targetBranchId);

      const existingMembership = await ctx.db
        .query("userTenants")
        .withIndex("by_user_tenant", (q) => q.eq("userId", userId).eq("tenantId", entry.tenantId))
        .unique();

      if (!existingMembership) {
        await ctx.db.insert("userTenants", {
          userId,
          tenantId: entry.tenantId,
          role: entry.role,
          branchId: targetBranchId,
          createdAt: Date.now(),
        });
        upserts += 1;
        continue;
      }

      // Never overwrite OWNER role
      if (existingMembership.role === "OWNER") {
        continue;
      }

      const needsRole = existingMembership.role !== entry.role;
      const needsBranch = (existingMembership.branchId ?? null) !== targetBranchId;

      if (needsRole || needsBranch) {
        await ctx.db.patch(existingMembership._id, {
          ...(needsRole ? { role: entry.role } : {}),
          ...(needsBranch ? { branchId: targetBranchId } : {}),
        });
        upserts += 1;
      }
    }

    // De-dupe tenantIds
    const uniqueTenantIds = Array.from(new Set(tenantIds));

    return {
      synced: uniqueTenantIds.length > 0,
      tenantIds: uniqueTenantIds,
      count: upserts,
    };
  },
});

