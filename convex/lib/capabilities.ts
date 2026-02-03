/**
 * CAPABILITIES MATRIX (Single Source of Truth)
 * ===========================================
 *
 * This module defines what each plan tier can do.
 *
 * IMPORTANT SEMANTICS:
 * - Trialing users get BASIC capabilities (regardless of purchased product tier).
 * - CSV export is ALWAYS allowed for all plan tiers (still requires allowed subscription status).
 *
 * Backend must be authoritative: use these helpers inside Convex guards.
 */
import type { PlanTier, SubscriptionStatus, TenantContext } from "./types";

export type FeatureName =
  | "multiBranch"
  | "exportCsv";

export type Capabilities = {
  /** PRO+ — allow creating additional branches beyond the main branch. */
  multiBranch: boolean;

  /** Max number of branches allowed for the tenant. null = unlimited. */
  maxBranches: number | null;

  /** Max number of workers allowed for the tenant. null = unlimited. */
  maxWorkers: number | null;

  /**
   * Always true for all tiers.
   * Still requires subscription status allowed (active or trialing).
   */
  exportCsv: true;
};

const CAPABILITIES_BY_TIER: Record<PlanTier, Capabilities> = {
  BASIC: {
    multiBranch: false,
    maxBranches: 1,
    maxWorkers: 5,
    exportCsv: true,
  },
  PRO: {
    multiBranch: true,
    maxBranches: 5,
    maxWorkers: 30,
    exportCsv: true,
  },
  ENTERPRISE: {
    multiBranch: true,
    maxBranches: null, // unlimited
    maxWorkers: null, // unlimited
    exportCsv: true,
  },
};

export function getCapabilities(planTier: PlanTier): Capabilities {
  return CAPABILITIES_BY_TIER[planTier];
}

/**
 * Trialing tenants behave like BASIC for capabilities (time-limited).
 * Paid tenants use their stored planTier.
 */
export function getEffectivePlanTier(
  planTier: PlanTier,
  subscriptionStatus: SubscriptionStatus
): PlanTier {
  return subscriptionStatus === "trialing" ? "BASIC" : planTier;
}

export function getEffectiveCapabilities(ctx: Pick<TenantContext, "planTier" | "subscriptionStatus">): Capabilities {
  return getCapabilities(getEffectivePlanTier(ctx.planTier, ctx.subscriptionStatus));
}

/**
 * Pure capability check.
 * IMPORTANT: This does NOT decide whether subscription status is allowed — guards do that.
 */
export function canUseFeature(
  feature: FeatureName,
  tenantCtx: Pick<TenantContext, "planTier" | "subscriptionStatus">
): boolean {
  const caps = getEffectiveCapabilities(tenantCtx);
  return Boolean(caps[feature]);
}

