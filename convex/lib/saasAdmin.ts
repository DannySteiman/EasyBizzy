/**
 * SAAS_ADMIN MECHANISM
 * ====================
 * 
 * Simple allowlist-based system for identifying SAAS_ADMIN users.
 * 
 * SAAS_ADMIN is a GLOBAL role, not tied to any tenant.
 * These users have access to the Mother App (admin dashboard) for:
 * - Viewing all tenants
 * - Managing subscriptions
 * - System-wide operations
 * 
 * HOW IT WORKS:
 * - We maintain an allowlist of email addresses
 * - When checking if a user is SAAS_ADMIN, we check their email against this list
 * - In production, you might want to move this to environment variables or a database table
 * 
 * IMPORTANT: SAAS_ADMIN does NOT automatically grant access to tenant data.
 * They must still have explicit membership (via userTenants) to access specific tenants.
 */

// =============================================================================
// SAAS_ADMIN EMAIL ALLOWLIST
// =============================================================================

/**
 * List of email addresses that are granted SAAS_ADMIN privileges.
 * 
 * TODO: In production, consider:
 * - Moving to environment variables: process.env.SAAS_ADMIN_EMAILS?.split(",")
 * - Creating a separate "admins" table in the database
 * - Using a more sophisticated permission system
 */
const SAAS_ADMIN_EMAILS: string[] = [
  'steimandanny@gmail.com'
  // Add SAAS_ADMIN email addresses here
  // Example: "admin@yourcompany.com"
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if an email address belongs to a SAAS_ADMIN
 * 
 * @param email - The email address to check
 * @returns true if the email is in the SAAS_ADMIN allowlist
 * 
 * Usage:
 * ```ts
 * const user = await ctx.auth.getUserIdentity();
 * if (user && isSaasAdminEmail(user.email)) {
 *   // User is a SAAS_ADMIN
 * }
 * ```
 */
export function isSaasAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  
  // Case-insensitive comparison for email matching
  const normalizedEmail = email.toLowerCase().trim();
  return SAAS_ADMIN_EMAILS.some(
    adminEmail => adminEmail.toLowerCase().trim() === normalizedEmail
  );
}

/**
 * Check if a user ID is a SAAS_ADMIN
 * This is a placeholder for when you have the user's email available
 * 
 * In practice, you'll typically call this with the user's email from auth:
 * ```ts
 * const identity = await ctx.auth.getUserIdentity();
 * const isAdmin = isSaasAdminEmail(identity?.email);
 * ```
 * 
 * If you need to check by user ID, you'd need to look up the user first,
 * which requires access to the users table (depends on your auth setup).
 */

/**
 * Add a SAAS_ADMIN email at runtime
 * Useful for testing or dynamic admin management
 * 
 * WARNING: This only persists for the current process.
 * For production, use environment variables or database storage.
 */
export function addSaasAdminEmail(email: string): void {
  const normalizedEmail = email.toLowerCase().trim();
  if (!SAAS_ADMIN_EMAILS.includes(normalizedEmail)) {
    SAAS_ADMIN_EMAILS.push(normalizedEmail);
  }
}

/**
 * Remove a SAAS_ADMIN email at runtime
 * 
 * WARNING: This only persists for the current process.
 */
export function removeSaasAdminEmail(email: string): void {
  const normalizedEmail = email.toLowerCase().trim();
  const index = SAAS_ADMIN_EMAILS.findIndex(
    e => e.toLowerCase().trim() === normalizedEmail
  );
  if (index !== -1) {
    SAAS_ADMIN_EMAILS.splice(index, 1);
  }
}

/**
 * Get all SAAS_ADMIN emails (for debugging/admin purposes)
 * Returns a copy to prevent external modification
 */
export function getSaasAdminEmails(): string[] {
  return [...SAAS_ADMIN_EMAILS];
}
