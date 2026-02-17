/**
 * POLAR WEBHOOK INTERNAL MUTATIONS
 * ================================
 * 
 * WHERE THIS LIVES: convex/polarWebhooks.ts
 * 
 * CRITICAL: WEBHOOK-FIRST ARCHITECTURE
 * ====================================
 * Polar webhooks are the AUTHORITATIVE SOURCE for tenant creation.
 * The UI/checkout success page must NOT create tenants directly.
 * 
 * Flow:
 * 1. User starts checkout → Polar checkout session created with userId in metadata
 * 2. User completes payment → Polar sends subscription.created webhook
 * 3. Webhook creates: Tenant → Main Branch → OWNER membership
 * 4. UI polls for "do I have an active tenant as OWNER?" → redirects when ready
 * 
 * IDEMPOTENCY GUARANTEES:
 * - Never create duplicate tenants for the same polarSubscriptionId
 * - Never create more than one OWNER per tenant from the same subscription
 * - Safe to receive the same webhook event multiple times
 * 
 * SECURITY:
 * - These mutations are INTERNAL only - cannot be called from client
 * - Only the HTTP handler (after signature verification) can invoke these
 * - Owner identity is derived from webhook data, not client input
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { 
  mapPolarStatusToSubscriptionStatus, 
  mapProductIdToTier,
  extractTenantIdFromMetadata,
  extractUserIdFromMetadata,
  extractCustomerNameFromMetadata,
} from "./lib/polar";

function normalizeEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

function parseIsoToMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// =============================================================================
// INTERNAL QUERIES
// =============================================================================

/**
 * Find a tenant by Polar subscription ID
 * This is the PRIMARY lookup method - polarSubscriptionId is the unique key
 */
export const getTenantByPolarSubscriptionId = internalQuery({
  args: { polarSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tenants")
      .withIndex("by_polar_subscription", (q) => 
        q.eq("polarSubscriptionId", args.polarSubscriptionId)
      )
      .unique();
  },
});

/**
 * Find a tenant by Polar customer ID (fallback lookup)
 */
export const getTenantByPolarCustomerId = internalQuery({
  args: { polarCustomerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tenants")
      .withIndex("by_polar_customer", (q) => 
        q.eq("polarCustomerId", args.polarCustomerId)
      )
      .unique();
  },
});

/**
 * Check if a user already has OWNER membership in a tenant
 */
export const getOwnerMembership = internalQuery({
  args: { 
    tenantId: v.id("tenants"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("userTenants")
      .withIndex("by_user_tenant", (q) => 
        q.eq("userId", args.userId).eq("tenantId", args.tenantId)
      )
      .unique();
    
    return membership?.role === "OWNER" ? membership : null;
  },
});

// =============================================================================
// SUBSCRIPTION EVENT HANDLERS (WEBHOOK-FIRST)
// =============================================================================

/**
 * Handle subscription.created event
 * 
 * THIS IS THE CORE WEBHOOK-FIRST HANDLER
 * 
 * When a subscription becomes active:
 * 1. UPSERT tenant using polarSubscriptionId as unique key
 * 2. Create main branch if missing
 * 3. Create OWNER membership if missing
 * 
 * Idempotency: Safe to call multiple times for the same subscription
 */
export const handleSubscriptionCreated = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
    productId: v.string(),
    status: v.string(),
    // ISO timestamp string from Polar (used to derive trialEndsAt for trialing subs)
    currentPeriodEnd: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    customerName: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // =========================================================================
    // STEP 1: Determine subscription status and plan tier
    // =========================================================================
    
    const subscriptionStatus = mapPolarStatusToSubscriptionStatus(
      args.status as "active" | "past_due" | "canceled" | "incomplete" | "incomplete_expired" | "trialing" | "unpaid"
    );
    
    const planTier = mapProductIdToTier(args.productId) ?? "BASIC";
    
    // Only provision tenant for allowed subscription states.
    // IMPORTANT: Trialing is allowed for Main App usage, but is NOT paid "active".
    if (subscriptionStatus !== "active" && subscriptionStatus !== "trialing") {
      console.log(`Subscription ${args.subscriptionId} status is ${subscriptionStatus}, skipping tenant provisioning`);
      return {
        success: true,
        message: `Subscription not allowed (${subscriptionStatus}), no tenant provisioned`,
        tenantId: null,
      };
    }

    // Derive trialEndsAt (ms) when Polar subscription is trialing.
    // We use current_period_end as the trial end boundary for gating.
    const trialEndsAt = subscriptionStatus === "trialing"
      ? parseIsoToMs(args.currentPeriodEnd ?? null)
      : null;
    
    // =========================================================================
    // STEP 2: Resolve the owner user OR prepare for claiming
    // =========================================================================
    
    // userId from metadata is available for authenticated checkouts
    const userId = extractUserIdFromMetadata(args.metadata);
    
    // Check if this is an anonymous checkout (checkout-first flow)
    const isAnonymousCheckout = args.metadata?.checkoutType === "anonymous";
    
    if (!userId && !isAnonymousCheckout) {
      console.log(
        `No userId in metadata for subscription ${args.subscriptionId}. ` +
        `Will create unclaimed tenant with email: ${args.customerEmail}`
      );
    }
    
    if (isAnonymousCheckout) {
      console.log(
        `Anonymous checkout detected for subscription ${args.subscriptionId}. ` +
        `Creating unclaimed tenant for email: ${args.customerEmail}`
      );
    }
    
    // =========================================================================
    // STEP 3: Resolve which tenant this subscription belongs to (NO DUPLICATES)
    // =========================================================================

    const customerEmailNormalized = normalizeEmail(args.customerEmail);
    const tenantIdFromMetadata = extractTenantIdFromMetadata(args.metadata);

    const ownerMatches = (t: { ownerId?: string; ownerEmail?: string }) => {
      if (userId && t.ownerId === userId) return true;
      const tenantOwnerEmail = normalizeEmail(t.ownerEmail);
      return !!customerEmailNormalized && tenantOwnerEmail === customerEmailNormalized;
    };

    const customerMatches = (t: { polarCustomerId?: string }) => {
      // If tenant has no customer ID yet, allow linking.
      if (!t.polarCustomerId) return true;
      return t.polarCustomerId === args.customerId;
    };

    // 3A) Preferred linkage for upgrades/downgrades: metadata.tenantId
    // Convex documents are runtime objects; keep typing loose inside webhook logic.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tenant: any | null = null;

    if (tenantIdFromMetadata) {
      const candidate = await ctx.db.get(tenantIdFromMetadata as Id<"tenants">);
      if (candidate && (customerMatches(candidate) || ownerMatches(candidate))) {
        tenant = candidate;
        console.log(`[Polar] Linked subscription ${args.subscriptionId} to tenant from metadata: ${candidate._id}`);
      } else {
        console.warn(
          `[Polar] metadata.tenantId provided but did not verify ownership/customer match. ` +
          `Refusing to link subscription ${args.subscriptionId} to tenantId=${tenantIdFromMetadata}`
        );
      }
    }

    // 3B) Idempotency key: polarSubscriptionId
    if (!tenant) {
      tenant = await ctx.db
        .query("tenants")
        .withIndex("by_polar_subscription", (q) =>
          q.eq("polarSubscriptionId", args.subscriptionId)
        )
        .unique();
    }

    // 3C) Upgrade fallback: polarCustomerId + owner match (same customer, new subscription id)
    if (!tenant) {
      const candidates = await ctx.db
        .query("tenants")
        .withIndex("by_polar_customer", (q) => q.eq("polarCustomerId", args.customerId))
        .collect();

      tenant = candidates.find((t) => ownerMatches(t)) ?? null;
      if (tenant) {
        console.log(`[Polar] Linked subscription ${args.subscriptionId} to existing tenant via customerId+owner match: ${tenant._id}`);
      }
    }

    let tenantId: Id<"tenants">;
    let isNewTenant = false;

    // If we are linking this subscription to an existing tenant, ensure no other tenant keeps this subscription ID.
    const clearSubscriptionFromOtherTenant = async (targetTenantId: Id<"tenants">) => {
      const existing = await ctx.db
        .query("tenants")
        .withIndex("by_polar_subscription", (q) => q.eq("polarSubscriptionId", args.subscriptionId))
        .unique();

      if (existing && existing._id !== targetTenantId) {
        console.warn(
          `[Polar] Found another tenant (${existing._id}) already linked to subscription ${args.subscriptionId}. ` +
          `Clearing its polarSubscriptionId to prevent duplicates.`
        );
        await ctx.db.patch(existing._id, { polarSubscriptionId: undefined, subscriptionStatus: "inactive" });
      }
    };

    if (tenant) {
      tenantId = tenant._id;
      await clearSubscriptionFromOtherTenant(tenantId);

      await ctx.db.patch(tenantId, {
        polarCustomerId: args.customerId,
        polarSubscriptionId: args.subscriptionId, // overwrite/replace (upgrade/downgrade stays on same tenant)
        subscriptionStatus,
        planTier,
        ...(trialEndsAt !== null ? { trialEndsAt } : { trialEndsAt: undefined }),
        // Update ownerEmail if provided and tenant is unclaimed
        ...(args.customerEmail && !tenant.claimed && { ownerEmail: args.customerEmail }),
        // If this is an authenticated upgrade and the tenant wasn't claimed, claim it.
        ...(userId && !tenant.ownerId ? { ownerId: userId, claimed: true } : {}),
      });

      console.log(`Updated tenant ${tenantId} for subscription ${args.subscriptionId}`);
    } else {
      // 3D) Net-new purchase: create a brand-new tenant
      const tenantName =
        extractCustomerNameFromMetadata(args.metadata) ??
        args.customerName ??
        (args.customerEmail ? args.customerEmail.split("@")[0] + "'s Workspace" : "New Workspace");

      const isClaimed = !!userId;

      tenantId = await ctx.db.insert("tenants", {
        name: tenantName,
        planTier,
        subscriptionStatus,
        ...(trialEndsAt !== null ? { trialEndsAt } : {}),
        polarCustomerId: args.customerId,
        polarSubscriptionId: args.subscriptionId,
        // Checkout-first claiming fields
        ownerEmail: args.customerEmail,
        ownerId: userId ?? undefined,
        claimed: isClaimed,
        createdAt: now,
      });
      isNewTenant = true;
      console.log(`Created new tenant ${tenantId} for subscription ${args.subscriptionId} (claimed: ${isClaimed})`);
    }
    
    // =========================================================================
    // STEP 4: Ensure Main Branch exists
    // =========================================================================
    
    let mainBranch = await ctx.db
      .query("branches")
      .withIndex("by_tenant_main", (q) => 
        q.eq("tenantId", tenantId).eq("isMainBranch", true)
      )
      .unique();
    
    let branchId: Id<"branches">;
    
    if (mainBranch) {
      branchId = mainBranch._id;
    } else {
      // Create main branch
      branchId = await ctx.db.insert("branches", {
        tenantId,
        name: "Main Branch",
        isMainBranch: true,
        createdAt: now,
      });
      console.log(`Created main branch ${branchId} for tenant ${tenantId}`);
    }
    
    // =========================================================================
    // STEP 5: Ensure OWNER membership exists (if we have userId)
    // =========================================================================
    
    let membershipId: Id<"userTenants"> | null = null;
    
    if (userId) {
      // Check if this user already has a membership in this tenant
      const existingMembership = await ctx.db
        .query("userTenants")
        .withIndex("by_user_tenant", (q) => 
          q.eq("userId", userId).eq("tenantId", tenantId)
        )
        .unique();
      
      if (existingMembership) {
        // User already has membership - ensure they're OWNER if this is their subscription
        if (existingMembership.role !== "OWNER") {
          // Upgrade to OWNER (this subscription makes them the owner)
          await ctx.db.patch(existingMembership._id, { role: "OWNER" });
          console.log(`Upgraded user ${userId} to OWNER in tenant ${tenantId}`);
        }
        membershipId = existingMembership._id;
      } else {
        // Create OWNER membership
        membershipId = await ctx.db.insert("userTenants", {
          userId,
          tenantId,
          role: "OWNER",
          branchId: undefined, // OWNER has access to all branches
          createdAt: now,
        });
        console.log(`Created OWNER membership for user ${userId} in tenant ${tenantId}`);
      }
    }
    
    return { 
      success: true, 
      tenantId,
      branchId,
      membershipId,
      isNewTenant,
      message: isNewTenant 
        ? "Tenant, branch, and owner created" 
        : "Tenant updated (already existed)",
    };
  },
});

/**
 * Handle subscription.updated event
 * 
 * Called when a subscription is updated (plan change, status change, etc.)
 * Updates tenant status and plan tier accordingly.
 */
export const handleSubscriptionUpdated = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
    productId: v.string(),
    status: v.string(),
    currentPeriodEnd: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const customerEmailNormalized = normalizeEmail(args.customerEmail);
    const userId = extractUserIdFromMetadata(args.metadata);
    const tenantIdFromMetadata = extractTenantIdFromMetadata(args.metadata);

    const ownerMatches = (t: { ownerId?: string; ownerEmail?: string }) => {
      if (userId && t.ownerId === userId) return true;
      const tenantOwnerEmail = normalizeEmail(t.ownerEmail);
      return !!customerEmailNormalized && tenantOwnerEmail === customerEmailNormalized;
    };

    const customerMatches = (t: { polarCustomerId?: string }) => {
      if (!t.polarCustomerId) return true;
      return t.polarCustomerId === args.customerId;
    };

    // Preferred linkage: metadata.tenantId (ensures upgrades/downgrades stay on SAME tenant)
    let tenant: any | null = null;
    if (tenantIdFromMetadata) {
      const candidate = await ctx.db.get(tenantIdFromMetadata as Id<"tenants">);
      if (candidate && (customerMatches(candidate) || ownerMatches(candidate))) {
        tenant = candidate;
        console.log(`[Polar] subscription.updated linked via metadata.tenantId: ${candidate._id}`);
      } else {
        console.warn(
          `[Polar] subscription.updated: metadata.tenantId provided but did not verify match. ` +
          `Ignoring tenantId=${tenantIdFromMetadata}`
        );
      }
    }

    // Primary key fallback: subscriptionId
    if (!tenant) {
      tenant = await ctx.db
        .query("tenants")
        .withIndex("by_polar_subscription", (q) =>
          q.eq("polarSubscriptionId", args.subscriptionId)
        )
        .unique();
    }

    // Upgrade fallback: customerId + owner match
    if (!tenant) {
      const candidates = await ctx.db
        .query("tenants")
        .withIndex("by_polar_customer", (q) => q.eq("polarCustomerId", args.customerId))
        .collect();
      tenant = candidates.find((t) => ownerMatches(t)) ?? null;
    }
    
    if (!tenant) {
      // If subscription update arrives before subscription.created, handle it
      // by calling the create handler (which is idempotent)
      console.log(`Tenant not found for subscription update ${args.subscriptionId}, treating as create`);
      
      // Re-route to create handler (this ensures tenant gets created)
      const result = await ctx.runMutation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ctx as any)._modules.internal.polarWebhooks.handleSubscriptionCreated,
        {
          subscriptionId: args.subscriptionId,
          customerId: args.customerId,
          productId: args.productId,
          status: args.status,
          currentPeriodEnd: args.currentPeriodEnd,
          customerEmail: args.customerEmail,
          metadata: args.metadata,
        }
      );
      
      return result;
    }
    
    // Map product to tier
    const planTier = mapProductIdToTier(args.productId);
    
    // Map status
    const subscriptionStatus = mapPolarStatusToSubscriptionStatus(
      args.status as "active" | "past_due" | "canceled" | "incomplete" | "incomplete_expired" | "trialing" | "unpaid"
    );

    const trialEndsAt = subscriptionStatus === "trialing"
      ? parseIsoToMs(args.currentPeriodEnd ?? null)
      : null;

    // Prevent duplicate tenant creation for upgrades: if another tenant somehow has this subscriptionId, clear it.
    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_polar_subscription", (q) => q.eq("polarSubscriptionId", args.subscriptionId))
      .unique();
    if (existing && existing._id !== tenant._id) {
      console.warn(
        `[Polar] subscription.updated: another tenant (${existing._id}) is linked to subscription ${args.subscriptionId}. ` +
        `Clearing to prevent duplicates.`
      );
      await ctx.db.patch(existing._id, { polarSubscriptionId: undefined, subscriptionStatus: "inactive" });
    }
    
    // Update the tenant
    await ctx.db.patch(tenant._id, {
      subscriptionStatus,
      polarSubscriptionId: args.subscriptionId, // Ensure this is set
      ...(planTier && { planTier }),
      ...(trialEndsAt !== null ? { trialEndsAt } : { trialEndsAt: undefined }),
    });
    
    console.log(`Subscription updated for tenant ${tenant._id}: status=${subscriptionStatus}, tier=${planTier}`);
    
    return { success: true, tenantId: tenant._id };
  },
});

/**
 * Handle subscription.canceled event
 * 
 * Called when a subscription is canceled (but may still be active until period end)
 */
export const handleSubscriptionCanceled = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Find tenant by subscription ID
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_polar_subscription", (q) => 
        q.eq("polarSubscriptionId", args.subscriptionId)
      )
      .unique();
    
    if (!tenant) {
      console.error(`Could not find tenant for subscription cancel: ${args.subscriptionId}`);
      return { success: false, error: "Tenant not found" };
    }
    
    // If cancel_at_period_end is true, subscription is still active until period ends
    // Otherwise, it's immediately canceled
    const subscriptionStatus = args.cancelAtPeriodEnd ? "active" : "canceled";
    
    await ctx.db.patch(tenant._id, {
      subscriptionStatus,
    });
    
    console.log(`Subscription canceled for tenant ${tenant._id}: immediate=${!args.cancelAtPeriodEnd}`);
    
    return { success: true, tenantId: tenant._id };
  },
});

/**
 * Handle subscription.revoked event
 * 
 * Called when a subscription is fully revoked (no more access)
 */
export const handleSubscriptionRevoked = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find tenant by subscription ID
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_polar_subscription", (q) => 
        q.eq("polarSubscriptionId", args.subscriptionId)
      )
      .unique();
    
    if (!tenant) {
      console.error(`Could not find tenant for subscription revoke: ${args.subscriptionId}`);
      return { success: false, error: "Tenant not found" };
    }
    
    await ctx.db.patch(tenant._id, {
      subscriptionStatus: "inactive",
    });
    
    console.log(`Subscription revoked for tenant ${tenant._id}`);
    
    return { success: true, tenantId: tenant._id };
  },
});

// =============================================================================
// CHECKOUT EVENT HANDLERS
// =============================================================================

/**
 * Handle checkout.created or checkout.updated event
 * 
 * Note: The actual tenant creation happens in subscription.created
 * This handler is mainly for logging/tracking checkout progress
 */
export const handleCheckoutEvent = internalMutation({
  args: {
    checkoutId: v.string(),
    status: v.string(),
    customerId: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (_ctx, args) => {
    // Log checkout status for debugging
    console.log(`Checkout ${args.checkoutId} status: ${args.status}`);
    
    // Note: We don't create tenants here!
    // Tenant creation is ONLY done in handleSubscriptionCreated
    // This ensures webhook-first architecture
    
    if (args.status === "succeeded") {
      console.log(
        `Checkout succeeded for customer ${args.customerId}. ` +
        `Waiting for subscription.created webhook to create tenant.`
      );
    }
    
    return { 
      success: true, 
      message: `Checkout ${args.status} acknowledged`,
    };
  },
});

// =============================================================================
// UTILITY: Manual subscription sync (for SAAS_ADMIN)
// =============================================================================

/**
 * Manually link a Polar subscription to a tenant
 * Use this if webhook failed or for testing
 */
export const linkSubscriptionToTenant = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    polarCustomerId: v.string(),
    polarSubscriptionId: v.string(),
    planTier: v.union(
      v.literal("BASIC"),
      v.literal("PRO"),
      v.literal("BUSINESS"),
      v.literal("ENTERPRISE")
    ),
    subscriptionStatus: v.union(
      v.literal("inactive"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled")
    ),
  },
  handler: async (ctx, args) => {
    const { tenantId, ...updates } = args;
    
    await ctx.db.patch(tenantId, updates);
    
    return { success: true };
  },
});

/**
 * Manually create OWNER membership for a user in a tenant
 * Use this if webhook metadata was missing userId
 */
export const createOwnerMembership = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if membership already exists
    const existing = await ctx.db
      .query("userTenants")
      .withIndex("by_user_tenant", (q) => 
        q.eq("userId", args.userId).eq("tenantId", args.tenantId)
      )
      .unique();
    
    if (existing) {
      if (existing.role === "OWNER") {
        return { success: true, membershipId: existing._id, message: "Already OWNER" };
      }
      // Upgrade to OWNER
      await ctx.db.patch(existing._id, { role: "OWNER" });
      return { success: true, membershipId: existing._id, message: "Upgraded to OWNER" };
    }
    
    // Create new OWNER membership
    const membershipId = await ctx.db.insert("userTenants", {
      userId: args.userId,
      tenantId: args.tenantId,
      role: "OWNER",
      branchId: undefined,
      createdAt: Date.now(),
    });
    
    // Ensure main branch exists
    const mainBranch = await ctx.db
      .query("branches")
      .withIndex("by_tenant_main", (q) => 
        q.eq("tenantId", args.tenantId).eq("isMainBranch", true)
      )
      .unique();
    
    if (!mainBranch) {
      await ctx.db.insert("branches", {
        tenantId: args.tenantId,
        name: "Main Branch",
        isMainBranch: true,
        createdAt: Date.now(),
      });
    }
    
    return { success: true, membershipId, message: "Created OWNER membership" };
  },
});
