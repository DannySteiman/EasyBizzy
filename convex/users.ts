/**
 * USER QUERIES
 * ============
 * 
 * WHERE THIS LIVES: convex/users.ts
 * 
 * Queries for user information, primarily used for:
 * - Entry gate routing (SAAS_ADMIN check)
 * - User profile display
 * - Role-based UI decisions
 */

import { query } from "./_generated/server";
import { isSaasAdminEmail } from "./lib/saasAdmin";

/**
 * Get current user info including SAAS_ADMIN status.
 * 
 * USE THIS FOR:
 * - Entry gate to determine if user is SAAS_ADMIN
 * - Displaying user info in UI
 * - Role-based feature flags
 * 
 * Returns null if not authenticated.
 */
export const getMyUserInfo = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return null;
    }
    
    return {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
      isSaasAdmin: isSaasAdminEmail(identity.email),
    };
  },
});

/**
 * Check if current user is a SAAS_ADMIN.
 * Lightweight query just for the boolean check.
 */
export const isMeSaasAdmin = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return false;
    }
    
    return isSaasAdminEmail(identity.email);
  },
});
