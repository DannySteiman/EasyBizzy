/**
 * Locations (branches) plan limits — single source of truth (backend).
 *
 * IMPORTANT:
 * - We treat legacy "ENTERPRISE" as "BUSINESS" for limits.
 * - Unknown plan strings fail closed to BASIC limits.
 */
export function getMaxLocationsForPlan(plan: string): number {
  switch (plan) {
    case "BASIC":
      return 1;
    case "PRO":
      return 3;
    case "BUSINESS":
    case "ENTERPRISE": // legacy alias
      return Infinity;
    default:
      return 1;
  }
}

export function getUpgradeMessage(plan: string): string {
  switch (plan) {
    case "BASIC":
      return "Upgrade to PRO to add more locations.";
    case "PRO":
      return "Upgrade to BUSINESS to add more locations.";
    case "BUSINESS":
    case "ENTERPRISE": // legacy alias
      return "";
    default:
      return "Upgrade to PRO to add more locations.";
  }
}

