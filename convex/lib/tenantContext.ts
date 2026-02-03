/**
 * TENANT CONTEXT HELPER
 * =====================
 * 
 * This is THE core helper for the multi-tenant system.
 * It resolves the current user's tenant context for Main App operations.
 * 
 * WHERE THIS LIVES: convex/lib/tenantContext.ts
 * 
 * WHAT IT DOES:
 * 1. Gets the authenticated user from Convex Auth
 * 2. Determines which tenant they're operating within
 * 3. Fetches their membership (role, branch assignment)
 * 4. Returns a complete TenantContext object
 * 
 * HOW TENANT IS DETERMINED:
 * The tenantId can come from:
 * - A header set by the client (X-Tenant-Id)
 * - A URL parameter
 * - Session storage
 * - The user's only/default tenant (if they belong to just one)
 * 
 * For this implementation, we require the tenantId to be passed explicitly.
 * This makes the system predictable and avoids "magic" tenant selection.
 */

import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { TenantContext, TenantContextError, TenantRole } from "./types";
import { isSaasAdminEmail } from "./saasAdmin";

// Type for Convex context (works for both queries and mutations)
type ConvexCtx = QueryCtx | MutationCtx;

// =============================================================================
// MAIN FUNCTION: getTenantContext
// =============================================================================

/**
 * Resolves the complete tenant context for the current request.
 * 
 * This is the ONLY way to get tenant information in Main App code.
 * Do NOT access tenants/userTenants directly - always go through this function.
 * 
 * @param ctx - Convex query or mutation context
 * @param tenantId - The tenant ID the user wants to operate within
 * @returns TenantContext with all necessary information
 * @throws TenantContextError if context cannot be resolved
 * 
 * Usage:
 * ```ts
 * export const myQuery = query({
 *   args: { tenantId: v.id("tenants") },
 *   handler: async (ctx, args) => {
 *     const tenantCtx = await getTenantContext(ctx, args.tenantId);
 *     // Now use tenantCtx.currentTenantId for all queries
 *   },
 * });
 * ```
 */
export async function getTenantContext(
  ctx: ConvexCtx,
  tenantId: Id<"tenants">
): Promise<TenantContext> {
  // Step 1: Get authenticated user
  const identity = await ctx.auth.getUserIdentity();
  
  if (!identity) {
    throw new TenantContextError(
      "Authentication required. Please log in.",
      "NOT_AUTHENTICATED"
    );
  }
  
  // The user's unique identifier (subject claim from auth provider)
  const userId = identity.subject;
  
  // Step 2: Check if user is a SAAS_ADMIN
  const isSaasAdmin = isSaasAdminEmail(identity.email);
  
  // Step 3: Fetch the tenant to ensure it exists
  const tenant = await ctx.db.get(tenantId);
  
  if (!tenant) {
    throw new TenantContextError(
      "Tenant not found. The tenant may have been deleted.",
      "INVALID_TENANT"
    );
  }
  
  // Step 4: Find the user's membership in this tenant
  const membership = await ctx.db
    .query("userTenants")
    .withIndex("by_user_tenant", (q) => 
      q.eq("userId", userId).eq("tenantId", tenantId)
    )
    .unique();
  
  if (!membership) {
    throw new TenantContextError(
      "You don't have access to this tenant. Contact the tenant owner for an invitation.",
      "NO_TENANT_ACCESS"
    );
  }
  
  // Step 5: Build and return the complete context
  return {
    currentUserId: userId,
    currentTenantId: tenantId,
    currentMembershipId: membership._id,
    currentRole: membership.role as TenantRole,
    currentBranchId: membership.branchId ?? null,
    planTier: tenant.planTier,
    subscriptionStatus: tenant.subscriptionStatus,
    trialEndsAt: tenant.trialEndsAt ?? null,
    isSaasAdmin,
  };
}

// =============================================================================
// HELPER: Get user's available tenants
// =============================================================================

/**
 * Get all tenants a user has access to.
 * Useful for tenant switcher UI or determining default tenant.
 * 
 * @param ctx - Convex context
 * @returns Array of tenant memberships with tenant details
 */
export async function getUserTenants(ctx: ConvexCtx) {
  const identity = await ctx.auth.getUserIdentity();
  
  if (!identity) {
    throw new TenantContextError(
      "Authentication required.",
      "NOT_AUTHENTICATED"
    );
  }
  
  const userId = identity.subject;
  
  // Get all memberships for this user
  const memberships = await ctx.db
    .query("userTenants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  
  // Fetch tenant details for each membership
  const tenantsWithMembership = await Promise.all(
    memberships.map(async (membership) => {
      const tenant = await ctx.db.get(membership.tenantId);
      return {
        membership,
        tenant,
      };
    })
  );
  
  // Filter out any null tenants (deleted tenants)
  return tenantsWithMembership.filter((t) => t.tenant !== null);
}

// =============================================================================
// HELPER: Check if user is authenticated (without tenant context)
// =============================================================================

/**
 * Get basic user info without requiring tenant context.
 * Use this for operations that don't need tenant scoping.
 * 
 * @param ctx - Convex context
 * @returns User info including SAAS_ADMIN status
 */
export async function getCurrentUser(ctx: ConvexCtx) {
  const identity = await ctx.auth.getUserIdentity();
  
  if (!identity) {
    throw new TenantContextError(
      "Authentication required.",
      "NOT_AUTHENTICATED"
    );
  }
  
  return {
    userId: identity.subject,
    email: identity.email,
    name: identity.name,
    isSaasAdmin: isSaasAdminEmail(identity.email),
  };
}
