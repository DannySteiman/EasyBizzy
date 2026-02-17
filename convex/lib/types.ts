/**
 * SHARED TYPES - Multi-Tenant Foundation
 * ======================================
 * 
 * Central location for all type definitions used across the codebase.
 * Import these types instead of redefining them elsewhere.
 */

import { Id } from "../_generated/dataModel";

// =============================================================================
// ROLE TYPES
// =============================================================================

/**
 * Roles for Main App users (stored in userTenants table)
 * - OWNER: Full tenant access, billing, user management
 * - MANAGER: Branch operations, staff management
 * - WORKER: Basic operations (orders, etc.)
 */
export type TenantRole = "OWNER" | "MANAGER" | "WORKER";

/**
 * All possible roles including SAAS_ADMIN
 * Use this for comprehensive role checks
 */
export type AppRole = TenantRole | "SAAS_ADMIN";

// =============================================================================
// SUBSCRIPTION TYPES (Polar placeholders)
// =============================================================================

/**
 * Subscription plan tiers - determines feature access
 */
// NOTE: "ENTERPRISE" is a legacy alias for "BUSINESS" (kept for backwards compatibility).
export type PlanTier = "BASIC" | "PRO" | "BUSINESS" | "ENTERPRISE";

/**
 * Subscription status values
 * - inactive: No subscription yet (default for new tenants)
 * - active: Subscription is active and paid
 * - past_due: Payment failed, grace period
 * - canceled: Subscription was canceled
 */
export type SubscriptionStatus = "trialing" | "inactive" | "active" | "past_due" | "canceled";

// =============================================================================
// TENANT CONTEXT TYPE
// =============================================================================

/**
 * The runtime context returned by getTenantContext()
 * Contains all information needed to scope queries/mutations to a tenant.
 * 
 * This is THE authoritative source for "who is this user and what can they access"
 * during any Main App request.
 */
export type TenantContext = {
  // The authenticated user's ID
  currentUserId: string;
  
  // The tenant they're operating within
  currentTenantId: Id<"tenants">;
  
  // Their membership record ID (userTenants._id)
  currentMembershipId: Id<"userTenants">;
  
  // Their role within this tenant
  currentRole: TenantRole;
  
  // The branch they're assigned to (null = all branches / OWNER)
  currentBranchId: Id<"branches"> | null;
  
  // Subscription info (from tenants table)
  planTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  
  /**
   * Trial end timestamp (ms since epoch) when subscriptionStatus === "trialing".
   * null when not trialing or unknown.
   *
   * IMPORTANT: Trialing is time-limited and is NOT paid "active".
   */
  trialEndsAt: number | null;
  
  // True if this user is a SAAS_ADMIN (checked separately from tenant membership)
  isSaasAdmin: boolean;
};

/**
 * Context returned when user is ONLY a SAAS_ADMIN (no tenant context)
 * Used for Mother App operations that don't require tenant scope
 */
export type SaasAdminContext = {
  currentUserId: string;
  isSaasAdmin: true;
};

// =============================================================================
// GUARD ERROR TYPES
// =============================================================================

/**
 * Error thrown when tenant context cannot be resolved
 */
export class TenantContextError extends Error {
  constructor(
    message: string,
    public code: "NOT_AUTHENTICATED" | "NO_TENANT_ACCESS" | "NO_ACTIVE_TENANT" | "INVALID_TENANT"
  ) {
    super(message);
    this.name = "TenantContextError";
  }
}

/**
 * Error thrown when user doesn't have required role
 */
export class RoleError extends Error {
  constructor(
    message: string,
    public requiredRoles: AppRole[],
    public actualRole: AppRole | null
  ) {
    super(message);
    this.name = "RoleError";
  }
}

/**
 * Error thrown when subscription doesn't allow an action
 */
export class SubscriptionError extends Error {
  constructor(
    message: string,
    public requiredTier: PlanTier,
    public actualTier: PlanTier
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}
