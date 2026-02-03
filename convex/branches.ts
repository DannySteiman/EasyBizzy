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
} from "./lib/guards";
import { getEffectiveCapabilities } from "./lib/capabilities";

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
      .unique();
    
    return mainBranch;
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
