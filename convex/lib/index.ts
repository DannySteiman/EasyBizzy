/**
 * LIBRARY EXPORTS
 * ===============
 * 
 * Central export point for all multi-tenant helpers.
 * Import from here in your Convex functions:
 * 
 * ```ts
 * import { requireTenantContext, requireOwner, TenantContext } from "./lib";
 * ```
 */

// Types
export type { 
  TenantRole, 
  AppRole, 
  PlanTier, 
  SubscriptionStatus,
  TenantContext,
  SaasAdminContext,
} from "./types";

export { 
  TenantContextError, 
  RoleError, 
  SubscriptionError,
} from "./types";

// Tenant Context
export { 
  getTenantContext, 
  getUserTenants, 
  getCurrentUser,
} from "./tenantContext";

// SAAS Admin
export { 
  isSaasAdminEmail, 
  addSaasAdminEmail, 
  removeSaasAdminEmail,
  getSaasAdminEmails,
} from "./saasAdmin";

// Guards
export {
  requireTenantContext,
  requireRole,
  requireOwner,
  requireManager,
  requireSaasAdmin,
  requireActiveSubscription,
  requirePlanTier,
  canAccessBranch,
  requireBranchAccess,
  requireAll,
} from "./guards";

// Polar Integration
export type {
  PolarWebhookEvent,
  PolarSubscription,
  PolarCustomer,
  PolarCheckout,
  HandledPolarEvent,
} from "./polar";

export {
  verifyPolarWebhookSignature,
  mapPolarStatusToSubscriptionStatus,
  mapProductIdToTier,
  setProductTierMapping,
  extractTenantIdFromMetadata,
  webhookSuccess,
  webhookError,
} from "./polar";
