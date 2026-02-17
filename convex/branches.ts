/**
 * BRANCH FUNCTIONS
 * ================
 * 
 * Functions for managing branches within a tenant.
 * Demonstrates branch-level access control.
 * 
 * WHERE THIS LIVES: convex/branches.ts
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { 
  requireSubscriptionAllowed,
  requirePlanCapability,
  requireOwner,
  requireManager,
  requireBranchAccess,
  canAccessBranch,
  requireRole,
  requireTenantContext,
} from "./lib/guards";
import { getEffectiveCapabilities } from "./lib/capabilities";
import { Id } from "./_generated/dataModel";
import { getMaxLocationsForPlan, getUpgradeMessage } from "./lib/locationLimits";

// =============================================================================
// BRANCH QUERIES
// =============================================================================

/**
 * Get all branches for a tenant.
 * Returns only branches the user has access to based on their role.
 */
export const getBranches = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    // Guard: subscription must be allowed for Main App usage
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    
    // Fetch all branches for this tenant
    const allBranches = await ctx.db
      .query("branches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      // Hide archived branches (undefined => active)
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();
    
    // Filter to only branches the user can access
    const accessibleBranches = allBranches.filter((branch) =>
      canAccessBranch(tenantCtx, branch._id)
    );
    
    return accessibleBranches;
  },
});

/**
 * Get a specific branch.
 * Requires branch-level access.
 */
export const getBranch = query({
  args: { 
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
  },
  handler: async (ctx, args) => {
    // Guard: subscription allowed + branch access
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireBranchAccess(tenantCtx, args.branchId);
    
    const branch = await ctx.db.get(args.branchId);
    
    // Extra safety: verify branch belongs to this tenant
    if (!branch || branch.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Branch not found");
    }
    
    return branch;
  },
});

/**
 * Get the main branch for a tenant.
 */
export const getMainBranch = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    
    const mainBranch = await ctx.db
      .query("branches")
      .withIndex("by_tenant_main", (q) => 
        q.eq("tenantId", tenantCtx.currentTenantId).eq("isMainBranch", true)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .unique();
    
    return mainBranch;
  },
});

// =============================================================================
// LOCATIONS (Branches) — Vertical slice CRUD (plan-gated)
// =============================================================================

function normalizeBranchName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Location name is required.");
  }
  if (trimmed.length > 60) {
    throw new Error("Location name must be 60 characters or less.");
  }
  return trimmed;
}

async function assertBranchBelongsToTenant(
  ctx: { db: any },
  tenantId: Id<"tenants">,
  branchId: Id<"branches">
) {
  const branch = await ctx.db.get(branchId);
  if (!branch || branch.tenantId !== tenantId) {
    throw new Error("Location not found.");
  }
  return branch as {
    _id: Id<"branches">;
    tenantId: Id<"tenants">;
    name: string;
    isMainBranch: boolean;
    createdAt: number;
    isArchived?: boolean;
  };
}

/**
 * List branches for Locations management.
 * - OWNER + MANAGER only
 * - Returns only non-archived branches
 */
export const list = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    // Required by spec (and keeps tenant scoping explicit).
    await requireTenantContext(ctx, args.tenantId);

    // Guard: subscription allowed + OWNER/MANAGER role
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);

    const branches = await ctx.db
      .query("branches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    return branches.map((b: any) => ({
      _id: b._id,
      name: b.name,
      isMainBranch: b.isMainBranch,
      createdAt: b.createdAt,
      isArchived: Boolean(b.isArchived),
    }));
  },
});

/**
 * Create a new branch/location.
 * - OWNER only
 * - BASIC: max 1 active location
 * - PRO+: multi-branch allowed
 */
export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const name = normalizeBranchName(args.name);

    const existing = await ctx.db
      .query("branches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    const activeBranchCount = existing.length;
    const effectivePlanTier = tenantCtx.subscriptionStatus === "trialing" ? "BASIC" : tenantCtx.planTier;
    const maxAllowed = getMaxLocationsForPlan(effectivePlanTier);

    if (activeBranchCount >= maxAllowed) {
      throw new Error(getUpgradeMessage(effectivePlanTier));
    }

    const branchId = await ctx.db.insert("branches", {
      tenantId: tenantCtx.currentTenantId,
      name,
      isMainBranch: false,
      createdAt: Date.now(),
      isArchived: false,
    });

    const created = await ctx.db.get(branchId);
    return created;
  },
});

/**
 * Rename a branch/location.
 * - OWNER only
 */
export const rename = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const branch = await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);
    if (branch.isArchived) {
      throw new Error("Location not found.");
    }

    const name = normalizeBranchName(args.name);
    await ctx.db.patch(args.branchId, { name });

    return { success: true };
  },
});

/**
 * Archive a branch/location.
 * - OWNER only
 * - Cannot archive last active location
 * - Cannot archive if any team members are assigned to it
 */
export const archive = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
  },
  handler: async (ctx, args) => {
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);

    const branch = await assertBranchBelongsToTenant(ctx, tenantCtx.currentTenantId, args.branchId);
    if (branch.isArchived) {
      return { success: true };
    }

    const activeBranches = await ctx.db
      .query("branches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    if (activeBranches.length <= 1) {
      throw new Error("You must keep at least one active location.");
    }

    // Optional safety: prevent archiving when any memberships are assigned to this branch.
    const assignedMembers = await ctx.db
      .query("userTenants")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("tenantId"), tenantCtx.currentTenantId))
      .collect();

    if (assignedMembers.length > 0) {
      throw new Error("Reassign team members before archiving this location.");
    }

    // Keep invariant: ensure there is always a main branch among active branches.
    if (branch.isMainBranch) {
      const nextMain = activeBranches.find((b: any) => String(b._id) !== String(branch._id));
      if (nextMain) {
        await ctx.db.patch(nextMain._id, { isMainBranch: true });
      }
      await ctx.db.patch(args.branchId, { isMainBranch: false });
    }

    await ctx.db.patch(args.branchId, { isArchived: true });
    return { success: true };
  },
});

// =============================================================================
// BRANCH MUTATIONS
// =============================================================================

/**
 * Create a new branch.
 * Only OWNER can create branches.
 */
export const createBranch = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Guard: subscription allowed + OWNER role
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);

    // Enforce plan gating:
    // - BASIC (and all trials) can keep only 1 branch (the main branch).
    // - Creating a SECOND branch requires PRO+ (multiBranch capability).
    // - PRO has maxBranches=5, ENTERPRISE unlimited.
    const existingBranches = await ctx.db
      .query("branches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    const caps = getEffectiveCapabilities(tenantCtx);
    const currentCount = existingBranches.length;

    // If a main branch already exists, adding more is a PRO+ feature.
    if (currentCount >= 1) {
      await requirePlanCapability(ctx, args.tenantId, "multiBranch");
    }

    // Enforce absolute branch count limit for the effective tier.
    if (caps.maxBranches !== null && currentCount >= caps.maxBranches) {
      throw new ConvexError({
        code: "MAX_BRANCHES_REACHED",
        message: `Your plan allows up to ${caps.maxBranches} branch(es). Upgrade to add more.`,
        maxBranches: caps.maxBranches,
        currentCount,
        planTier: tenantCtx.planTier,
        subscriptionStatus: tenantCtx.subscriptionStatus,
      });
    }
    
    const branchId = await ctx.db.insert("branches", {
      tenantId: tenantCtx.currentTenantId,
      name: args.name,
      address: args.address,
      isMainBranch: false, // Only the first branch is main
      createdAt: Date.now(),
    });
    
    return { branchId };
  },
});

/**
 * Update a branch.
 * OWNER can update any branch.
 * MANAGER can only update their assigned branch.
 */
export const updateBranch = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Guard: tenant context + manager level access
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireManager(tenantCtx);
    requireBranchAccess(tenantCtx, args.branchId);
    
    // Verify branch belongs to this tenant
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Branch not found");
    }
    
    await ctx.db.patch(args.branchId, {
      ...(args.name && { name: args.name }),
      ...(args.address !== undefined && { address: args.address }),
    });
    
    return { success: true };
  },
});

/**
 * Delete a branch.
 * Only OWNER can delete branches.
 * Cannot delete the main branch.
 */
export const deleteBranch = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
  },
  handler: async (ctx, args) => {
    // Guard: subscription allowed + OWNER role
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);
    
    const branch = await ctx.db.get(args.branchId);
    
    if (!branch || branch.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Branch not found");
    }
    
    if (branch.isMainBranch) {
      throw new Error("Cannot delete the main branch");
    }
    
    // TODO: Check for existing data tied to this branch before deleting
    
    await ctx.db.delete(args.branchId);
    
    return { success: true };
  },
});

/**
 * Set a different branch as the main branch.
 * Only OWNER can change the main branch.
 */
export const setMainBranch = mutation({
  args: {
    tenantId: v.id("tenants"),
    branchId: v.id("branches"),
  },
  handler: async (ctx, args) => {
    // Guard: subscription allowed + OWNER role
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);
    
    const newMainBranch = await ctx.db.get(args.branchId);
    
    if (!newMainBranch || newMainBranch.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Branch not found");
    }
    
    if (newMainBranch.isMainBranch) {
      return { success: true }; // Already the main branch
    }
    
    // Find current main branch and unset it
    const currentMain = await ctx.db
      .query("branches")
      .withIndex("by_tenant_main", (q) => 
        q.eq("tenantId", tenantCtx.currentTenantId).eq("isMainBranch", true)
      )
      .unique();
    
    if (currentMain) {
      await ctx.db.patch(currentMain._id, { isMainBranch: false });
    }
    
    // Set new main branch
    await ctx.db.patch(args.branchId, { isMainBranch: true });
    
    return { success: true };
  },
});
