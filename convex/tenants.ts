/**
 * TENANT FUNCTIONS
 * ================
 * 
 * Core functions for tenant and membership management.
 * These demonstrate proper usage of guards and tenant context.
 * 
 * WHERE THIS LIVES: convex/tenants.ts
 * 
 * WEBHOOK-FIRST ARCHITECTURE
 * ==========================
 * Tenants are created by Polar webhooks (see polarWebhooks.ts), NOT by the UI.
 * 
 * UI Flow after checkout:
 * 1. Call `getMyActiveTenantAsOwner` to check if tenant exists
 * 2. If YES → redirect to Main App / Owner Onboarding
 * 3. If NO → show "finishing setup..." and poll/retry
 * 
 * NEVER call createTenant from the UI after checkout - the webhook handles it.
 */

import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api } from "./_generated/api";
import { 
  requireSubscriptionAllowed,
  requireOwner, 
  requireRole,
  requireSaasAdmin,
} from "./lib/guards";
import { getUserTenants, getCurrentUser } from "./lib/tenantContext";

// =============================================================================
// TENANT QUERIES
// =============================================================================

/**
 * Get all tenants the current user has access to.
 * Used for tenant switcher UI.
 * 
 * NO tenant context required - this is called BEFORE tenant selection.
 */
export const myTenants = query({
  handler: async (ctx) => {
    const userTenants = await getUserTenants(ctx);
    
    return userTenants.map(({ membership, tenant }) => ({
      tenantId: tenant!._id,
      tenantName: tenant!.name,
      role: membership.role,
      planTier: tenant!.planTier,
      subscriptionStatus: tenant!.subscriptionStatus,
    }));
  },
});

// =============================================================================
// CHECKOUT SUCCESS / APP ENTRY QUERIES (WEBHOOK-FIRST FLOW)
// =============================================================================

/**
 * Check if current user has an active tenant as OWNER.
 * 
 * USE THIS AFTER CHECKOUT SUCCESS:
 * - Called by UI to determine if webhook has processed the subscription
 * - If returns a tenant → redirect to Main App / Owner Onboarding
 * - If returns null → show "finishing setup..." and poll/retry
 * 
 * SECURITY: This query does NOT accept tenantId from client.
 * Ownership is derived from the authenticated user's memberships.
 */
export const getMyActiveTenantAsOwner = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return null; // Not authenticated
    }
    
    const userId = identity.subject;
    
    // Find all memberships where user is OWNER
    const ownerMemberships = await ctx.db
      .query("userTenants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("role"), "OWNER"))
      .collect();
    
    // Find first tenant that is active
    for (const membership of ownerMemberships) {
      const tenant = await ctx.db.get(membership.tenantId);
      
      // "active" counts as access.
      // "trialing" counts as access ONLY if trialEndsAt exists and is not expired (fail closed).
      if (tenant && (tenant.subscriptionStatus === "active" || tenant.subscriptionStatus === "trialing")) {
        if (tenant.subscriptionStatus === "trialing") {
          const expired = !tenant.trialEndsAt || Date.now() > tenant.trialEndsAt;
          if (expired) continue;
        }

        // Get main branch for context
        const mainBranch = await ctx.db
          .query("branches")
          .withIndex("by_tenant_main", (q) => 
            q.eq("tenantId", tenant._id).eq("isMainBranch", true)
          )
          .unique();
        
        return {
          tenantId: tenant._id,
          tenantName: tenant.name,
          planTier: tenant.planTier,
          subscriptionStatus: tenant.subscriptionStatus,
          mainBranchId: mainBranch?._id ?? null,
          membershipId: membership._id,
          // Flag indicating if this is a brand new tenant (created within last 5 minutes)
          // Useful for showing onboarding flow
          isNewTenant: Date.now() - tenant.createdAt < 5 * 60 * 1000,
        };
      }
    }
    
    return null; // No active tenant found as OWNER
  },
});

// =============================================================================
// CHECKOUT-FIRST CLAIMING FLOW
// =============================================================================

/**
 * Check if there's an unclaimed tenant for the current user's email.
 * 
 * USE THIS AFTER SIGN-UP:
 * - Called to check if user should claim an existing tenant
 * - If returns a tenant → call claimTenantByEmail to claim it
 * - If returns null → user needs to go through checkout
 * 
 * SECURITY: Only returns tenants matching the authenticated user's email.
 */
export const getUnclaimedTenantForMyEmail = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity || !identity.email) {
      return null;
    }
    
    const userEmail = identity.email.toLowerCase().trim();
    
    // Find unclaimed tenant with matching email
    const unclaimedTenants = await ctx.db
      .query("tenants")
      .withIndex("by_owner_email", (q) => q.eq("ownerEmail", userEmail))
      .filter((q) => q.eq(q.field("claimed"), false))
      .collect();
    
    if (unclaimedTenants.length === 0) {
      return null;
    }
    
    // Return the most recent unclaimed tenant
    const tenant = unclaimedTenants.sort((a, b) => b.createdAt - a.createdAt)[0];
    
    return {
      tenantId: tenant._id,
      tenantName: tenant.name,
      planTier: tenant.planTier,
      subscriptionStatus: tenant.subscriptionStatus,
      createdAt: tenant.createdAt,
    };
  },
});

/**
 * Claim an unclaimed tenant by email.
 * 
 * USE THIS AFTER SIGN-UP when getUnclaimedTenantForMyEmail returns a tenant.
 * 
 * This mutation:
 * 1. Verifies the tenant exists and is unclaimed
 * 2. Verifies the user's email matches the tenant's ownerEmail
 * 3. Sets ownerId and claimed = true
 * 4. Creates OWNER membership for the user
 * 
 * SECURITY:
 * - Only works for tenants matching the authenticated user's email
 * - Cannot claim tenants belonging to others
 */
export const claimTenantByEmail = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity || !identity.email) {
      throw new Error("You must be signed in with a verified email to claim a workspace");
    }
    
    const userId = identity.subject;
    const userEmail = identity.email.toLowerCase().trim();
    
    // Find unclaimed tenant with matching email
    const unclaimedTenants = await ctx.db
      .query("tenants")
      .withIndex("by_owner_email", (q) => q.eq("ownerEmail", userEmail))
      .filter((q) => q.eq(q.field("claimed"), false))
      .collect();
    
    if (unclaimedTenants.length === 0) {
      throw new Error("No unclaimed workspace found for your email");
    }
    
    // Claim the most recent unclaimed tenant
    const tenant = unclaimedTenants.sort((a, b) => b.createdAt - a.createdAt)[0];
    
    // Update tenant to claimed
    await ctx.db.patch(tenant._id, {
      ownerId: userId,
      claimed: true,
    });
    
    // Check if membership already exists (shouldn't, but be safe)
    const existingMembership = await ctx.db
      .query("userTenants")
      .withIndex("by_user_tenant", (q) => 
        q.eq("userId", userId).eq("tenantId", tenant._id)
      )
      .unique();
    
    let membershipId;
    
    if (existingMembership) {
      // Ensure they're OWNER
      if (existingMembership.role !== "OWNER") {
        await ctx.db.patch(existingMembership._id, { role: "OWNER" });
      }
      membershipId = existingMembership._id;
    } else {
      // Create OWNER membership
      membershipId = await ctx.db.insert("userTenants", {
        userId,
        tenantId: tenant._id,
        role: "OWNER",
        branchId: undefined,
        createdAt: Date.now(),
      });
    }
    
    // Ensure main branch exists
    const mainBranch = await ctx.db
      .query("branches")
      .withIndex("by_tenant_main", (q) => 
        q.eq("tenantId", tenant._id).eq("isMainBranch", true)
      )
      .unique();
    
    if (!mainBranch) {
      await ctx.db.insert("branches", {
        tenantId: tenant._id,
        name: "Main Branch",
        isMainBranch: true,
        createdAt: Date.now(),
      });
    }
    
    console.log(`Tenant ${tenant._id} claimed by user ${userId} (email: ${userEmail})`);
    
    return {
      success: true,
      tenantId: tenant._id,
      tenantName: tenant.name,
      membershipId,
    };
  },
});

/**
 * Check if tenant is ready (exists and is active).
 * 
 * USE THIS ON CHECKOUT SUCCESS PAGE for polling.
 * Works for both authenticated and anonymous users (by checking email claim).
 */
export const isMyTenantReady = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return { ready: false, reason: "not_authenticated" };
    }
    
    const userId = identity.subject;
    const userEmail = identity.email?.toLowerCase().trim();
    
    // First check: Does user have an OWNER membership with active tenant?
    const ownerMemberships = await ctx.db
      .query("userTenants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("role"), "OWNER"))
      .collect();
    
    for (const membership of ownerMemberships) {
      const tenant = await ctx.db.get(membership.tenantId);
      // "active" counts as ready.
      // "trialing" counts as ready ONLY if trialEndsAt exists and is not expired (fail closed).
      if (tenant && (tenant.subscriptionStatus === "active" || tenant.subscriptionStatus === "trialing")) {
        if (tenant.subscriptionStatus === "trialing") {
          const expired = !tenant.trialEndsAt || Date.now() > tenant.trialEndsAt;
          if (expired) continue;
        }

        return { 
          ready: true, 
          tenantId: tenant._id, 
          tenantName: tenant.name,
          claimed: true,
        };
      }
    }
    
    // Second check: Is there an unclaimed tenant for this email?
    if (userEmail) {
      const unclaimedTenant = await ctx.db
        .query("tenants")
        .withIndex("by_owner_email", (q) => q.eq("ownerEmail", userEmail))
        .filter((q) => q.eq(q.field("claimed"), false))
        .first();
      
      // "active" counts as ready.
      // "trialing" counts as ready ONLY if trialEndsAt exists and is not expired (fail closed).
      if (unclaimedTenant && (unclaimedTenant.subscriptionStatus === "active" || unclaimedTenant.subscriptionStatus === "trialing")) {
        if (unclaimedTenant.subscriptionStatus === "trialing") {
          const expired = !unclaimedTenant.trialEndsAt || Date.now() > unclaimedTenant.trialEndsAt;
          if (expired) return { ready: false, reason: "trial_expired" };
        }

        return { 
          ready: true, 
          tenantId: unclaimedTenant._id, 
          tenantName: unclaimedTenant.name,
          claimed: false, // Needs claiming!
          needsClaiming: true,
        };
      }
    }
    
    return { ready: false, reason: "no_active_tenant" };
  },
});

// =============================================================================
// FREE TRIAL MANAGEMENT
// =============================================================================

const TRIAL_DURATION_DAYS = 14;

/**
 * Create a free trial tenant for the current user.
 * 
 * USE THIS: When a new user signs up and has no tenant.
 * This gives them 14 days of free access.
 * 
 * Creates:
 * - Tenant with "trialing" status
 * - Main branch
 * - OWNER membership for the user
 */
export const createTrialTenant = mutation({
  args: {
    tenantName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      throw new Error("Must be authenticated to create a trial");
    }
    
    const userId = identity.subject;
    const userEmail = identity.email;
    const userName = identity.name;
    
    // Check if user already has a tenant
    const existingMembership = await ctx.db
      .query("userTenants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    
    if (existingMembership) {
      throw new Error("You already have a workspace");
    }
    
    const now = Date.now();
    const trialEndsAt = now + (TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    
    // Generate tenant name
    const tenantName = args.tenantName || 
      (userName ? `${userName}'s Workspace` : 
       userEmail ? `${userEmail.split("@")[0]}'s Workspace` : 
       "My Workspace");
    
    // Create the tenant with trial status
    const tenantId = await ctx.db.insert("tenants", {
      name: tenantName,
      planTier: "BASIC", // Trial users get BASIC features
      subscriptionStatus: "trialing",
      trialEndsAt,
      ownerEmail: userEmail,
      ownerId: userId,
      claimed: true,
      createdAt: now,
    });
    
    // Create main branch
    const branchId = await ctx.db.insert("branches", {
      tenantId,
      name: "Main Branch",
      isMainBranch: true,
      createdAt: now,
    });
    
    // Create OWNER membership
    const membershipId = await ctx.db.insert("userTenants", {
      userId,
      tenantId,
      role: "OWNER",
      branchId: undefined,
      createdAt: now,
    });
    
    console.log(`Created trial tenant ${tenantId} for user ${userId}, expires ${new Date(trialEndsAt).toISOString()}`);
    
    return {
      tenantId,
      branchId,
      membershipId,
      trialEndsAt,
      daysRemaining: TRIAL_DURATION_DAYS,
    };
  },
});

/**
 * Check if the current user's trial has expired.
 */
export const getTrialStatus = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return null;
    }
    
    const userId = identity.subject;
    
    // Find user's OWNER membership
    const ownerMembership = await ctx.db
      .query("userTenants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("role"), "OWNER"))
      .first();
    
    if (!ownerMembership) {
      return null;
    }
    
    const tenant = await ctx.db.get(ownerMembership.tenantId);
    
    if (!tenant) {
      return null;
    }
    
    // Only return trial info if status is "trialing"
    if (tenant.subscriptionStatus !== "trialing") {
      return {
        isTrialing: false,
        isPaid: tenant.subscriptionStatus === "active",
        tenantId: tenant._id,
      };
    }
    
    const now = Date.now();
    const trialEndsAt = tenant.trialEndsAt || now;
    const isExpired = now > trialEndsAt;
    const daysRemaining = Math.max(0, Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)));
    
    return {
      isTrialing: true,
      isPaid: false,
      isExpired,
      trialEndsAt,
      daysRemaining,
      tenantId: tenant._id,
      tenantName: tenant.name,
    };
  },
});

/**
 * Check subscription status for the current user.
 * 
 * Returns information about:
 * - Whether user has any tenant
 * - Whether any tenant is active
 * - Recommended action (redirect to onboarding, show upgrade prompt, etc.)
 * 
 * USE THIS FOR:
 * - App entry gate (block access if no active subscription)
 * - Dashboard subscription status display
 */
export const getMySubscriptionStatus = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return {
        authenticated: false,
        hasTenant: false,
        hasActiveTenant: false,
        isOwner: false,
        recommendedAction: "login" as const,
        tenant: null,
      };
    }
    
    const userId = identity.subject;
    
    // Get all user's memberships
    const memberships = await ctx.db
      .query("userTenants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    
    if (memberships.length === 0) {
      return {
        authenticated: true,
        hasTenant: false,
        hasActiveTenant: false,
        isOwner: false,
        recommendedAction: "subscribe" as const, // User needs to purchase a subscription
        tenant: null,
      };
    }
    
    // Check each tenant for status
    const ownerMembership = memberships.find((m) => m.role === "OWNER");
    
    for (const membership of memberships) {
      const tenant = await ctx.db.get(membership.tenantId);
      
      if (!tenant) continue;
      
      // "active" or "trialing" counts as having access
      if (tenant.subscriptionStatus === "active" || tenant.subscriptionStatus === "trialing") {
        // Check if trial is expired
        // IMPORTANT: trialing must be time-limited; if trialEndsAt is missing, fail closed.
        const isTrialExpired = tenant.subscriptionStatus === "trialing" && (
          !tenant.trialEndsAt || Date.now() > tenant.trialEndsAt
        );
        
        if (isTrialExpired) {
          // Trial expired - treat as inactive
          continue;
        }
        
        return {
          authenticated: true,
          hasTenant: true,
          hasActiveTenant: true,
          isOwner: membership.role === "OWNER",
          recommendedAction: "enter_app" as const,
          tenant: {
            tenantId: tenant._id,
            name: tenant.name,
            planTier: tenant.planTier,
            subscriptionStatus: tenant.subscriptionStatus,
            role: membership.role,
            // Include trial info
            isTrialing: tenant.subscriptionStatus === "trialing",
            trialEndsAt: tenant.trialEndsAt,
            daysRemaining: tenant.trialEndsAt 
              ? Math.max(0, Math.ceil((tenant.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)))
              : undefined,
          },
        };
      }
    }
    
    // User has tenants but none are active
    const firstTenant = await ctx.db.get(memberships[0].tenantId);
    
    return {
      authenticated: true,
      hasTenant: true,
      hasActiveTenant: false,
      isOwner: !!ownerMembership,
      recommendedAction: ownerMembership ? "reactivate" as const : "contact_owner" as const,
      tenant: firstTenant ? {
        tenantId: firstTenant._id,
        name: firstTenant.name,
        planTier: firstTenant.planTier,
        subscriptionStatus: firstTenant.subscriptionStatus,
        role: memberships[0].role,
      } : null,
    };
  },
});

/**
 * Get current tenant details.
 * Requires tenant context - user must have access to this tenant.
 */
export const getTenant = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    // Guard: Main App usage requires allowed subscription (active or trialing)
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    
    // Fetch tenant using the validated tenantId from context
    const tenant = await ctx.db.get(tenantCtx.currentTenantId);
    
    return {
      tenant,
      currentRole: tenantCtx.currentRole,
      currentBranchId: tenantCtx.currentBranchId,
      currentUserId: tenantCtx.currentUserId,
    };
  },
});

/**
 * Get all members of the current tenant.
 * Only OWNER and MANAGER can view members.
 */
export const getTenantMembers = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    // Subscription must be allowed for Main App usage.
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    // Role check (OWNER + MANAGER only)
    requireRole(tenantCtx, ["OWNER", "MANAGER"]);
    
    // Fetch all memberships for this tenant
    const memberships = await ctx.db
      .query("userTenants")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
      .collect();
    
    return memberships;
  },
});

// =============================================================================
// TENANT MUTATIONS
// =============================================================================

/**
 * DEPRECATED FOR CHECKOUT FLOW - Use Polar webhook instead.
 * 
 * Create a new tenant manually (without Polar subscription).
 * 
 * WHEN TO USE THIS:
 * - SAAS_ADMIN creating a tenant for testing
 * - Manual tenant creation for special cases
 * - Development/debugging
 * 
 * WHEN NOT TO USE THIS:
 * - After Polar checkout (webhook handles tenant creation)
 * - From checkout success page (poll for webhook instead)
 * 
 * NOTE: Tenants created this way have subscriptionStatus: "inactive"
 * They need a Polar subscription to become active.
 * 
 * For normal user signups, use the webhook-first flow:
 * 1. Redirect to Polar checkout with metadata.userId
 * 2. Webhook creates tenant with active subscription
 * 3. UI polls getMyActiveTenantAsOwner until ready
 */
export const createTenant = mutation({
  args: {
    name: v.string(),
    branchName: v.optional(v.string()),
    branchAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get current user (no tenant context yet - we're creating one!)
    const user = await getCurrentUser(ctx);
    
    const now = Date.now();
    
    // 1. Create the tenant (inactive - no subscription yet)
    const tenantId = await ctx.db.insert("tenants", {
      name: args.name,
      planTier: "BASIC", // Default plan
      subscriptionStatus: "inactive", // Inactive until Polar checkout
      createdAt: now,
    });
    
    // 2. Create the main branch
    const branchId = await ctx.db.insert("branches", {
      tenantId,
      name: args.branchName || "Main Branch",
      address: args.branchAddress,
      isMainBranch: true,
      createdAt: now,
    });
    
    // 3. Create OWNER membership for the creating user
    const membershipId = await ctx.db.insert("userTenants", {
      userId: user.userId,
      tenantId,
      role: "OWNER",
      branchId: undefined, // OWNER has access to all branches
      createdAt: now,
    });
    
    console.log(
      `Manual tenant creation: ${tenantId} by user ${user.userId}. ` +
      `Note: subscriptionStatus is inactive. Needs Polar subscription.`
    );
    
    return {
      tenantId,
      branchId,
      membershipId,
    };
  },
});

/**
 * Update tenant settings.
 * Only OWNER can update tenant settings.
 */
export const updateTenant = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Guard: subscription allowed + OWNER role
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);
    
    // Update the tenant
    await ctx.db.patch(tenantCtx.currentTenantId, {
      ...(args.name && { name: args.name }),
    });
    
    return { success: true };
  },
});

/**
 * Invite a user to the tenant.
 * Only OWNER can invite new members.
 */
export const inviteUser = mutation({
  args: {
    tenantId: v.id("tenants"),
    userId: v.string(), // The user ID to invite
    role: v.union(v.literal("OWNER"), v.literal("MANAGER"), v.literal("WORKER")),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    // Guard: subscription allowed + OWNER role
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);

    // TODO(worker-limits): when adding a real user directory and invite flow by email,
    // enforce caps.maxWorkers for WORKER role using getEffectiveCapabilities(tenantCtx).
    // const caps = getEffectiveCapabilities(tenantCtx);
    // if (args.role === "WORKER") { ... enforce caps.maxWorkers ... }
    
    // Check if user already has membership
    const existing = await ctx.db
      .query("userTenants")
      .withIndex("by_user_tenant", (q) => 
        q.eq("userId", args.userId).eq("tenantId", tenantCtx.currentTenantId)
      )
      .unique();
    
    if (existing) {
      throw new Error("User already has access to this tenant");
    }
    
    // Create membership
    const membershipId = await ctx.db.insert("userTenants", {
      userId: args.userId,
      tenantId: tenantCtx.currentTenantId,
      role: args.role,
      branchId: args.branchId,
      createdAt: Date.now(),
    });
    
    return { membershipId };
  },
});

/**
 * Remove a user from the tenant.
 * Only OWNER can remove members.
 */
export const removeUser = mutation({
  args: {
    tenantId: v.id("tenants"),
    membershipId: v.id("userTenants"),
  },
  handler: async (ctx, args) => {
    // Guard: subscription allowed + OWNER role
    const tenantCtx = await requireSubscriptionAllowed(ctx, args.tenantId);
    requireOwner(tenantCtx);
    
    // Verify the membership belongs to this tenant
    const membership = await ctx.db.get(args.membershipId);
    
    if (!membership || membership.tenantId !== tenantCtx.currentTenantId) {
      throw new Error("Membership not found in this tenant");
    }
    
    // Prevent removing yourself if you're the only OWNER
    if (membership.role === "OWNER") {
      const owners = await ctx.db
        .query("userTenants")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantCtx.currentTenantId))
        .filter((q) => q.eq(q.field("role"), "OWNER"))
        .collect();
      
      if (owners.length <= 1) {
        throw new Error("Cannot remove the last owner. Transfer ownership first.");
      }
    }
    
    await ctx.db.delete(args.membershipId);
    
    return { success: true };
  },
});

// =============================================================================
// SAAS_ADMIN ONLY (Mother App)
// =============================================================================

/**
 * List all tenants in the system.
 * SAAS_ADMIN only - for Mother App admin dashboard.
 */
export const listAllTenants = query({
  handler: async (ctx) => {
    // Guard: SAAS_ADMIN required
    await requireSaasAdmin(ctx);
    
    const tenants = await ctx.db.query("tenants").collect();
    
    // Get stats for each tenant
    const tenantsWithStats = await Promise.all(
      tenants.map(async (tenant) => {
        const memberships = await ctx.db
          .query("userTenants")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
          .collect();

        const branchCount = await ctx.db
          .query("branches")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
          .collect()
          .then((b) => b.length);

        const accessEmailCount = await ctx.db
          .query("tenantAccessEmails")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
          .collect()
          .then((a) => a.length);
        
        return {
          ...tenant,
          memberCount: memberships.length,
          branchCount,
          accessEmailCount,
        };
      })
    );
    
    return tenantsWithStats;
  },
});

/**
 * Update tenant subscription (for Polar webhook or manual admin action).
 * SAAS_ADMIN only.
 */
export const updateTenantSubscription = mutation({
  args: {
    tenantId: v.id("tenants"),
    planTier: v.optional(v.union(
      v.literal("BASIC"),
      v.literal("PRO"),
      v.literal("BUSINESS"),
      v.literal("ENTERPRISE")
    )),
    subscriptionStatus: v.optional(v.union(
      v.literal("trialing"),
      v.literal("inactive"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled")
    )),
    polarCustomerId: v.optional(v.string()),
    polarSubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Guard: SAAS_ADMIN required
    await requireSaasAdmin(ctx);
    
    const { tenantId, ...updates } = args;
    
    // Remove undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );
    
    await ctx.db.patch(tenantId, cleanUpdates);
    
    return { success: true };
  },
});

/**
 * Extend a trial tenant by N days.
 * SAAS_ADMIN only (support workflow).
 */
export const adminExtendTrial = mutation({
  args: {
    tenantId: v.id("tenants"),
    days: v.number(), // positive integer recommended
  },
  handler: async (ctx, args) => {
    await requireSaasAdmin(ctx);

    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new Error("Tenant not found");
    }

    if (tenant.subscriptionStatus !== "trialing") {
      throw new Error("Trial can only be extended for trialing tenants");
    }

    const days = Math.floor(args.days);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      throw new Error("Invalid days");
    }

    const now = Date.now();
    const currentEndsAt = tenant.trialEndsAt ?? now;
    const base = Math.max(currentEndsAt, now);
    const nextEndsAt = base + days * 24 * 60 * 60 * 1000;

    await ctx.db.patch(args.tenantId, { trialEndsAt: nextEndsAt });

    return { success: true, trialEndsAt: nextEndsAt };
  },
});

/**
 * Update tenant details (name, etc).
 * SAAS_ADMIN only.
 */
export const adminUpdateTenant = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Guard: SAAS_ADMIN required
    await requireSaasAdmin(ctx);
    
    const { tenantId, ...updates } = args;
    
    // Remove undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );
    
    if (Object.keys(cleanUpdates).length > 0) {
      await ctx.db.patch(tenantId, cleanUpdates);
    }
    
    return { success: true };
  },
});

/**
 * Delete a tenant and all related data (internal mutation).
 * Called by adminDeleteTenantWithUsers action.
 */
export const adminDeleteTenantData = mutation({
  args: {
    tenantId: v.id("tenants"),
  },
  handler: async (ctx, args) => {
    // Guard: SAAS_ADMIN required
    await requireSaasAdmin(ctx);
    
    // Delete all user memberships for this tenant
    const memberships = await ctx.db
      .query("userTenants")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    
    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }
    
    // Delete all branches for this tenant
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    
    for (const branch of branches) {
      await ctx.db.delete(branch._id);
    }
    
    // Delete the tenant
    await ctx.db.delete(args.tenantId);
    
    return { success: true };
  },
});

/**
 * Get tenant info for deletion (returns user IDs to delete from Clerk).
 * SAAS_ADMIN only.
 */
export const getTenantUsersForDeletion = query({
  args: {
    tenantId: v.id("tenants"),
  },
  handler: async (ctx, args) => {
    // Guard: SAAS_ADMIN required
    await requireSaasAdmin(ctx);
    
    // Get the tenant
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      return { userIds: [] };
    }
    
    // Get all user memberships for this tenant
    const memberships = await ctx.db
      .query("userTenants")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    
    // Collect unique user IDs
    const userIds = [...new Set(memberships.map(m => m.userId))];
    
    // Also include ownerId if set
    if (tenant.ownerId && !userIds.includes(tenant.ownerId)) {
      userIds.push(tenant.ownerId);
    }
    
    return { userIds };
  },
});

/**
 * Delete a tenant AND its Clerk users.
 * SAAS_ADMIN only.
 * 
 * This action:
 * 1. Gets all user IDs associated with the tenant
 * 2. Deletes each user from Clerk
 * 3. Deletes the tenant data from our database
 * 
 * WARNING: This permanently deletes:
 * - The tenant and all its data
 * - All Clerk user accounts associated with this tenant
 */
export const adminDeleteTenant = action({
  args: {
    tenantId: v.id("tenants"),
    deleteClerkUsers: v.optional(v.boolean()), // Default true
  },
  handler: async (ctx, args): Promise<{ success: boolean; deletedClerkUsers: number }> => {
    const shouldDeleteClerkUsers = args.deleteClerkUsers !== false;
    let deletedClerkUsers = 0;
    
    // Get the user IDs to delete
    const result = await ctx.runQuery(api.tenants.getTenantUsersForDeletion, {
      tenantId: args.tenantId,
    });
    const userIds: string[] = result.userIds;
    
    // Delete users from Clerk if requested
    if (shouldDeleteClerkUsers && userIds.length > 0) {
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      
      if (!clerkSecretKey) {
        // Important: if we continue and delete tenant data, the email(s) will still be "taken"
        // because the Clerk users still exist. Fail loudly.
        throw new Error(
          "CLERK_SECRET_KEY is not set. Cannot delete Clerk users, so emails will remain taken."
        );
      }

      const headers = {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      };

      // Validate the key before deleting anything to avoid partial deletion.
      const probe = await fetch("https://api.clerk.com/v1/users?limit=1", {
        method: "GET",
        headers,
      });
      if (!probe.ok) {
        const body = await probe.text();
        throw new Error(
          `Clerk API authentication failed (${probe.status}). Check CLERK_SECRET_KEY. ${body}`
        );
      }

      console.log(`Deleting ${userIds.length} Clerk user(s)...`);
      const failures: Array<{ userId: string; status: number; body: string }> = [];

      for (const userId of userIds) {
        try {
          const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
            method: "DELETE",
            headers,
          });

          if (response.ok) {
            deletedClerkUsers += 1;
            console.log(`Deleted Clerk user: ${userId}`);
            continue;
          }

          if (response.status === 404) {
            console.log(`Clerk user not found (already deleted?): ${userId}`);
            continue;
          }

          const body = await response.text();
          failures.push({ userId, status: response.status, body: body.slice(0, 800) });
        } catch (error) {
          failures.push({
            userId,
            status: 0,
            body: String(error).slice(0, 800),
          });
        }
      }

      if (failures.length > 0) {
        const first = failures[0];
        throw new Error(
          `Failed to delete ${failures.length} Clerk user(s). Example: ${first.userId} status ${first.status}: ${first.body}`
        );
      }
    }
    
    // Delete the tenant data from our database
    await ctx.runMutation(api.tenants.adminDeleteTenantData, {
      tenantId: args.tenantId,
    });
    
    return { 
      success: true, 
      deletedClerkUsers: shouldDeleteClerkUsers ? deletedClerkUsers : 0,
    };
  },
});
