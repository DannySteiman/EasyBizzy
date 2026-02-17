/**
 * GUARD FUNCTIONS - Multi-Tenant Security
 * =======================================
 * 
 * WHERE THIS LIVES: convex/lib/guards.ts
 * 
 * This file contains guard functions that MUST be used by all Main App
 * mutations and queries. Guards ensure:
 * 
 * 1. Tenant context is always resolved (fail closed)
 * 2. Role-based access control is enforced
 * 3. Subscription status is checked
 * 4. Branch access is validated
 * 
 * IMPORTANT: These guards make it IMPOSSIBLE to "forget" tenant scoping.
 * All data access goes through these functions.
 */

import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { 
  TenantContext, 
  TenantContextError, 
  RoleError, 
  SubscriptionError,
  TenantRole, 
  PlanTier,
  SubscriptionStatus,
} from "./types";
import { getTenantContext } from "./tenantContext";
import { isSaasAdminEmail } from "./saasAdmin";
import { canUseFeature, type FeatureName, getEffectiveCapabilities } from "./capabilities";

type ConvexCtx = QueryCtx | MutationCtx;

// =============================================================================
// MAIN GUARD: requireTenantContext
// =============================================================================

/**
 * THE primary guard for all Main App operations.
 * 
 * Call this at the START of every Main App query/mutation.
 * It ensures tenant context is resolved before any data access.
 * 
 * @param ctx - Convex context
 * @param tenantId - The tenant ID (from args or headers)
 * @returns TenantContext - Use this for all subsequent operations
 * @throws TenantContextError if context cannot be resolved
 * 
 * Usage:
 * ```ts
 * export const getOrders = query({
 *   args: { tenantId: v.id("tenants") },
 *   handler: async (ctx, args) => {
 *     // ALWAYS start with this guard
 *     const tenantCtx = await requireTenantContext(ctx, args.tenantId);
 *     
 *     // Now ALL queries must use tenantCtx.currentTenantId
 *     const orders = await ctx.db
 *       .query("orders")
 *       .withIndex("by_tenant", q => q.eq("tenantId", tenantCtx.currentTenantId))
 *       .collect();
 *     
 *     return orders;
 *   },
 * });
 * ```
 */
export async function requireTenantContext(
  ctx: ConvexCtx,
  tenantId: Id<"tenants">
): Promise<TenantContext> {
  // This will throw if context cannot be resolved
  // No silent failures - fail closed
  return await getTenantContext(ctx, tenantId);
}

// =============================================================================
// ROLE GUARDS
// =============================================================================

/**
 * Require specific role(s) within the tenant.
 * 
 * @param tenantCtx - Already resolved tenant context
 * @param allowedRoles - Roles that can perform this action
 * @throws RoleError if user doesn't have required role
 * 
 * Usage:
 * ```ts
 * const tenantCtx = await requireTenantContext(ctx, args.tenantId);
 * requireRole(tenantCtx, ["OWNER", "MANAGER"]); // Only owners and managers
 * ```
 */
export function requireRole(
  tenantCtx: TenantContext,
  allowedRoles: TenantRole[]
): void {
  // SAAS_ADMIN can always bypass role checks (for admin operations)
  if (tenantCtx.isSaasAdmin) {
    return;
  }
  
  if (!allowedRoles.includes(tenantCtx.currentRole)) {
    throw new RoleError(
      `This action requires one of these roles: ${allowedRoles.join(", ")}. Your role: ${tenantCtx.currentRole}`,
      allowedRoles,
      tenantCtx.currentRole
    );
  }
}

/**
 * Convenience: Require OWNER role
 */
export function requireOwner(tenantCtx: TenantContext): void {
  requireRole(tenantCtx, ["OWNER"]);
}

/**
 * Convenience: Require OWNER or MANAGER role
 */
export function requireManager(tenantCtx: TenantContext): void {
  requireRole(tenantCtx, ["OWNER", "MANAGER"]);
}

// =============================================================================
// SAAS_ADMIN GUARD (for Mother App)
// =============================================================================

/**
 * Require SAAS_ADMIN status (for Mother App operations).
 * 
 * @param ctx - Convex context
 * @returns User info with SAAS_ADMIN confirmed
 * @throws Error if user is not a SAAS_ADMIN
 * 
 * Usage:
 * ```ts
 * // In a Mother App admin query
 * export const listAllTenants = query({
 *   handler: async (ctx) => {
 *     await requireSaasAdmin(ctx);
 *     return await ctx.db.query("tenants").collect();
 *   },
 * });
 * ```
 */
export async function requireSaasAdmin(ctx: ConvexCtx) {
  const identity = await ctx.auth.getUserIdentity();
  
  if (!identity) {
    throw new TenantContextError(
      "Authentication required.",
      "NOT_AUTHENTICATED"
    );
  }
  
  const isSaasAdmin = isSaasAdminEmail(identity.email);
  
  if (!isSaasAdmin) {
    throw new Error(
      "This action requires SAAS_ADMIN privileges. Access denied."
    );
  }
  
  return {
    userId: identity.subject,
    email: identity.email,
    isSaasAdmin: true,
  };
}

// =============================================================================
// SUBSCRIPTION GUARDS
// =============================================================================

export type SubscriptionGateErrorCode =
  | "SUBSCRIPTION_REQUIRED"   // no paid or trial access
  | "PAYMENT_PAST_DUE"        // payment failed
  | "SUBSCRIPTION_CANCELED"   // canceled
  | "TRIAL_EXPIRED";          // trial ended

export type FeatureGateErrorCode =
  | "FEATURE_REQUIRES_PRO"
  | "FEATURE_NOT_AVAILABLE";

function throwGateError(
  code: SubscriptionGateErrorCode | FeatureGateErrorCode,
  message: string,
  extra?: Record<string, unknown>
): never {
  throw new ConvexError({
    code,
    message,
    ...(extra ?? {}),
  });
}

/**
 * Authoritative subscription gate for Main App operations.
 *
 * Allowed statuses for Main App usage:
 * - "active" (paid)
 * - "trialing" (if allowTrial=true) AND trial not expired
 *
 * Disallowed:
 * - "inactive"
 * - "past_due"
 * - "canceled"
 *
 * IMPORTANT:
 * - SAAS_ADMIN bypasses this gate (Mother App must not be blocked by tenant billing).
 */
export async function requireSubscriptionAllowed(
  ctx: ConvexCtx,
  tenantId: Id<"tenants">,
  options?: { allowTrial?: boolean }
): Promise<TenantContext> {
  const allowTrial = options?.allowTrial !== false;
  const tenantCtx = await requireTenantContext(ctx, tenantId);

  // SAAS_ADMIN bypass (support/admin workflows)
  if (tenantCtx.isSaasAdmin) {
    return tenantCtx;
  }

  const status = tenantCtx.subscriptionStatus;

  if (status === "active") {
    return tenantCtx;
  }

  if (status === "trialing") {
    if (!allowTrial) {
      throwGateError(
        "SUBSCRIPTION_REQUIRED",
        "This action requires a paid subscription (trial not allowed for this operation)."
      );
    }

    // Trial is time-limited; if expired, block.
    if (tenantCtx.trialEndsAt !== null && Date.now() > tenantCtx.trialEndsAt) {
      throwGateError("TRIAL_EXPIRED", "Your free trial has expired. Please upgrade to continue.", {
        trialEndsAt: tenantCtx.trialEndsAt,
      });
    }

    return tenantCtx;
  }

  // Everything else is blocked.
  switch (status) {
    case "inactive":
      throwGateError("SUBSCRIPTION_REQUIRED", "An active subscription is required to use this feature.");
    case "past_due":
      throwGateError("PAYMENT_PAST_DUE", "Your subscription payment is past due. Please update billing to continue.");
    case "canceled":
      throwGateError("SUBSCRIPTION_CANCELED", "Your subscription is canceled. Please resubscribe to continue.");
    default:
      // Future-proof if new statuses are added.
      throwGateError("SUBSCRIPTION_REQUIRED", `Subscription status '${status}' is not allowed.`);
  }
}

/**
 * Require active subscription status.
 * 
 * @param tenantCtx - Resolved tenant context
 * @param allowedStatuses - Statuses that permit the action (default: active only)
 * @throws SubscriptionError if subscription status doesn't allow action
 */
export function requireActiveSubscription(
  tenantCtx: TenantContext,
  allowedStatuses: SubscriptionStatus[] = ["active"]
): void {
  // SAAS_ADMIN bypasses subscription checks (for admin/support)
  if (tenantCtx.isSaasAdmin) {
    return;
  }
  
  if (!allowedStatuses.includes(tenantCtx.subscriptionStatus)) {
    throw new SubscriptionError(
      `This action requires an active subscription. Current status: ${tenantCtx.subscriptionStatus}`,
      "BASIC", // Placeholder
      tenantCtx.planTier
    );
  }
}

/**
 * Require minimum plan tier for a feature.
 * 
 * @param tenantCtx - Resolved tenant context
 * @param minimumTier - The minimum required tier
 * @throws SubscriptionError if plan tier is insufficient
 * 
 * Usage:
 * ```ts
 * // For a PRO-only feature
 * requirePlanTier(tenantCtx, "PRO");
 * ```
 */
export function requirePlanTier(
  tenantCtx: TenantContext,
  minimumTier: PlanTier
): void {
  // SAAS_ADMIN bypasses tier checks
  if (tenantCtx.isSaasAdmin) {
    return;
  }
  
  // NOTE: "ENTERPRISE" is a legacy alias for "BUSINESS".
  const tierOrder: PlanTier[] = ["BASIC", "PRO", "BUSINESS", "ENTERPRISE"];
  const currentTierIndex = tierOrder.indexOf(tenantCtx.planTier);
  const requiredTierIndex = tierOrder.indexOf(minimumTier);
  
  if (currentTierIndex < requiredTierIndex) {
    throw new SubscriptionError(
      `This feature requires ${minimumTier} plan or higher. Current plan: ${tenantCtx.planTier}`,
      minimumTier,
      tenantCtx.planTier
    );
  }
}

/**
 * Authoritative plan capability gate (backend enforced).
 *
 * - Resolves tenant context
 * - Enforces subscription allowed (active or trialing)
 * - Checks capabilities matrix using EFFECTIVE tier (trialing => BASIC capabilities)
 *
 * CSV export is intentionally not gated by plan tier (capability always true),
 * but should still be protected by requireSubscriptionAllowed for access control.
 */
export async function requirePlanCapability(
  ctx: ConvexCtx,
  tenantId: Id<"tenants">,
  feature: FeatureName
): Promise<TenantContext> {
  const tenantCtx = await requireSubscriptionAllowed(ctx, tenantId, { allowTrial: true });

  const ok = canUseFeature(feature, tenantCtx);
  if (ok) {
    return tenantCtx;
  }

  // Right now we only have one PRO-gated feature in use (multi-branch).
  if (feature === "multiBranch") {
    const caps = getEffectiveCapabilities(tenantCtx);
    throwGateError(
      "FEATURE_REQUIRES_PRO",
      "Upgrade to Pro to unlock multi-branch.",
      {
        feature,
        planTier: tenantCtx.planTier,
        subscriptionStatus: tenantCtx.subscriptionStatus,
        maxBranches: caps.maxBranches,
      }
    );
  }

  throwGateError("FEATURE_NOT_AVAILABLE", "This feature is not available on your plan.", {
    feature,
    planTier: tenantCtx.planTier,
    subscriptionStatus: tenantCtx.subscriptionStatus,
  });
}

// =============================================================================
// BRANCH GUARDS
// =============================================================================

/**
 * Check if user has access to a specific branch.
 * 
 * Rules:
 * - OWNER: Access to all branches
 * - MANAGER/WORKER: Only their assigned branch (or all if branchId is null)
 * 
 * @param tenantCtx - Resolved tenant context
 * @param branchId - The branch being accessed
 * @returns true if access is allowed, false otherwise
 */
export function canAccessBranch(
  tenantCtx: TenantContext,
  branchId: Id<"branches">
): boolean {
  // OWNER has access to all branches
  if (tenantCtx.currentRole === "OWNER") {
    return true;
  }
  
  // SAAS_ADMIN has access to all branches
  if (tenantCtx.isSaasAdmin) {
    return true;
  }
  
  // If user has no branch restriction, they can access all branches
  if (tenantCtx.currentBranchId === null) {
    return true;
  }
  
  // Otherwise, check if the branch matches their assignment
  return tenantCtx.currentBranchId === branchId;
}

/**
 * Require access to a specific branch.
 * 
 * @param tenantCtx - Resolved tenant context
 * @param branchId - The branch being accessed
 * @throws Error if user cannot access this branch
 */
export function requireBranchAccess(
  tenantCtx: TenantContext,
  branchId: Id<"branches">
): void {
  if (!canAccessBranch(tenantCtx, branchId)) {
    throw new Error(
      "You don't have access to this branch. Contact your manager for access."
    );
  }
}

// =============================================================================
// COMBINED GUARD: The Ultimate Wrapper
// =============================================================================

/**
 * Options for the combined guard
 */
type GuardOptions = {
  tenantId: Id<"tenants">;
  requiredRoles?: TenantRole[];
  requiredTier?: PlanTier;
  requireActive?: boolean;
  branchId?: Id<"branches">;
};

/**
 * Combined guard that checks everything in one call.
 * Use this for cleaner code when you need multiple checks.
 * 
 * @param ctx - Convex context
 * @param options - Guard configuration
 * @returns TenantContext if all checks pass
 * 
 * Usage:
 * ```ts
 * const tenantCtx = await requireAll(ctx, {
 *   tenantId: args.tenantId,
 *   requiredRoles: ["OWNER", "MANAGER"],
 *   requiredTier: "PRO",
 *   requireActive: true,
 *   branchId: args.branchId,
 * });
 * ```
 */
export async function requireAll(
  ctx: ConvexCtx,
  options: GuardOptions
): Promise<TenantContext> {
  // 1. Resolve tenant context (always required)
  const tenantCtx = await requireTenantContext(ctx, options.tenantId);
  
  // 2. Check role if specified
  if (options.requiredRoles) {
    requireRole(tenantCtx, options.requiredRoles);
  }
  
  // 3. Check subscription status if required
  if (options.requireActive) {
    requireActiveSubscription(tenantCtx);
  }
  
  // 4. Check plan tier if specified
  if (options.requiredTier) {
    requirePlanTier(tenantCtx, options.requiredTier);
  }
  
  // 5. Check branch access if specified
  if (options.branchId) {
    requireBranchAccess(tenantCtx, options.branchId);
  }
  
  return tenantCtx;
}
