/**
 * POLAR CHECKOUT FUNCTIONS
 * ========================
 * 
 * WHERE THIS LIVES: convex/checkout.ts
 * 
 * This file contains actions to create Polar checkout sessions.
 * 
 * TWO CHECKOUT FLOWS:
 * 
 * A) NEW USER CHECKOUT (startNewSubscriptionCheckout):
 *    - User has NO tenant yet
 *    - userId in metadata is used to create OWNER membership via webhook
 *    - Redirects to /checkout/success which polls for tenant creation
 * 
 * B) EXISTING TENANT UPGRADE (createCheckout):
 *    - OWNER upgrades their existing tenant's subscription
 *    - tenantId in metadata links to existing tenant
 * 
 * FLOW:
 * 1. Frontend calls checkout action with appropriate params
 * 2. Backend creates a Polar checkout session with metadata
 * 3. Frontend redirects user to Polar checkout URL
 * 4. After payment, Polar sends webhook to /webhooks/polar
 * 5. Webhook creates tenant (new) or updates subscription (existing)
 * 
 * ENVIRONMENT:
 * Set POLAR_ENVIRONMENT=sandbox for testing, or omit/set to "production" for live.
 */

import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { api } from "./_generated/api";

// =============================================================================
// PRODUCT IDs (must match convex/lib/polar.ts)
// =============================================================================

const TIER_TO_PRODUCT_ID: Record<"BASIC" | "PRO" | "BUSINESS" | "ENTERPRISE", string> = {
  // Sandbox Product IDs
  "BASIC": "ef6ac2cb-46e9-45da-a6a1-904b272b4593",
  "PRO": "6c246b51-981c-4532-8acf-fa7614eae62b",
  // Business (unlimited) — legacy product previously called "ENTERPRISE"
  "BUSINESS": "6531fabd-c5bc-45fe-ab45-2ac3f77b893d",
  "ENTERPRISE": "6531fabd-c5bc-45fe-ab45-2ac3f77b893d",
};

// =============================================================================
// NEW USER CHECKOUT (Webhook-First Tenant Creation)
// =============================================================================

/**
 * Start a new subscription checkout for a user WITHOUT a tenant.
 * 
 * CRITICAL: This is used when a user has no tenant and wants to subscribe.
 * The webhook will create the tenant, branch, and OWNER membership.
 * 
 * @param planTier - Which plan to subscribe to
 * @param customerName - Optional name for the new tenant (workspace)
 * @returns The checkout URL to redirect the user to
 * 
 * METADATA INCLUDED:
 * - userId: Convex Auth subject (CRITICAL for OWNER creation)
 * - customerName: For naming the tenant
 * 
 * Usage in frontend:
 * ```typescript
 * const checkoutUrl = await convex.action(api.checkout.startNewSubscriptionCheckout, {
 *   planTier: "PRO",
 *   customerName: "My Business",
 * });
 * window.location.href = checkoutUrl;
 * ```
 */
export const startNewSubscriptionCheckout = action({
  args: {
    planTier: v.union(
      v.literal("BASIC"),
      v.literal("PRO"),
      v.literal("BUSINESS"),
      v.literal("ENTERPRISE")
    ),
    customerName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    // Get authenticated user
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      throw new Error("You must be signed in to start a subscription");
    }
    
    const userId = identity.subject;
    const userEmail = identity.email;
    
    // Get Polar access token from environment
    const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;
    
    if (!polarAccessToken) {
      throw new Error("POLAR_ACCESS_TOKEN not configured");
    }
    
    // Determine API base URL and app URL based on environment
    const polarEnvironment = process.env.POLAR_ENVIRONMENT || "production";
    const polarApiBase = polarEnvironment === "sandbox" 
      ? "https://sandbox-api.polar.sh" 
      : "https://api.polar.sh";
    
    // Get app base URL for redirects
    const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    
    // Get the product ID for the selected tier
    const productId = TIER_TO_PRODUCT_ID[args.planTier];
    
    if (!productId) {
      throw new Error(`Invalid plan tier: ${args.planTier}`);
    }
    
    // Build redirect URLs
    const successUrl = `${appBaseUrl}/checkout/success`;
    const cancelUrl = `${appBaseUrl}/checkout/cancel`;
    
    console.log("[Checkout] Creating new subscription checkout:", {
      userId,
      userEmail,
      planTier: args.planTier,
      productId,
      successUrl,
      cancelUrl,
      customerName: args.customerName,
    });
    
    // Create Polar checkout session
    const response = await fetch(`${polarApiBase}/v1/checkouts/custom/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${polarAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          // CRITICAL: userId is how webhook knows who to make OWNER
          userId: userId,
          // Optional: for naming the tenant
          customerName: args.customerName || (userEmail ? `${userEmail.split("@")[0]}'s Workspace` : "New Workspace"),
        },
        // Pre-fill customer email for better UX
        ...(userEmail && { customer_email: userEmail }),
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error("[Checkout] Polar checkout creation failed:", error);
      throw new Error("Failed to create checkout session");
    }
    
    const checkout = await response.json();
    
    console.log("[Checkout] Created checkout session:", {
      checkoutId: checkout.id,
      url: checkout.url,
    });
    
    // Return the checkout URL for frontend redirect
    return checkout.url;
  },
});

// =============================================================================
// ANONYMOUS CHECKOUT (Checkout-First Flow)
// =============================================================================

/**
 * Start an ANONYMOUS checkout - no authentication required!
 * 
 * This enables the checkout-first flow:
 * 1. Anonymous user visits /pricing
 * 2. Selects a plan → this action creates Polar checkout
 * 3. Polar collects email during checkout
 * 4. After payment, webhook creates UNCLAIMED tenant
 * 5. User is redirected to /checkout/success
 * 6. Success page prompts user to create account with same email
 * 7. After sign-up, tenant is claimed
 * 
 * NO userId in metadata - tenant will be claimed by email matching.
 * 
 * @param planTier - Which plan to subscribe to
 * @returns The checkout URL to redirect the user to
 */
export const startAnonymousCheckout = action({
  args: {
    planTier: v.union(
      v.literal("BASIC"),
      v.literal("PRO"),
      v.literal("BUSINESS"),
      v.literal("ENTERPRISE")
    ),
  },
  handler: async (_ctx, args): Promise<string> => {
    // NO authentication required!
    
    // Get Polar access token from environment
    const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;
    
    if (!polarAccessToken) {
      throw new Error("POLAR_ACCESS_TOKEN not configured");
    }
    
    // Determine API base URL based on environment
    const polarEnvironment = process.env.POLAR_ENVIRONMENT || "production";
    const polarApiBase = polarEnvironment === "sandbox" 
      ? "https://sandbox-api.polar.sh" 
      : "https://api.polar.sh";
    
    // Get app base URL for redirects
    const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    
    // Get the product ID for the selected tier
    const productId = TIER_TO_PRODUCT_ID[args.planTier];
    
    if (!productId) {
      throw new Error(`Invalid plan tier: ${args.planTier}`);
    }
    
    // Build redirect URLs - include planTier for success page context
    const successUrl = `${appBaseUrl}/checkout/success?plan=${args.planTier}&anonymous=true`;
    const cancelUrl = `${appBaseUrl}/checkout/cancel`;
    
    console.log("[Checkout] Creating ANONYMOUS checkout:", {
      planTier: args.planTier,
      productId,
      successUrl,
      cancelUrl,
    });
    
    // Create Polar checkout session
    // Polar will collect email during checkout
    const response = await fetch(`${polarApiBase}/v1/checkouts/custom/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${polarAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          // Mark as anonymous checkout - NO userId
          checkoutType: "anonymous",
          planTier: args.planTier,
        },
        // Let Polar collect email - don't pre-fill
        // customer_email will be collected by Polar
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error("[Checkout] Polar anonymous checkout creation failed:", error);
      throw new Error("Failed to create checkout session");
    }
    
    const checkout = await response.json();
    
    console.log("[Checkout] Created anonymous checkout session:", {
      checkoutId: checkout.id,
      url: checkout.url,
    });
    
    // Return the checkout URL for frontend redirect
    return checkout.url;
  },
});

// =============================================================================
// EXISTING TENANT CHECKOUT (Upgrade/Change Plan)
// =============================================================================

/**
 * Create a Polar checkout session for an EXISTING tenant subscription.
 * 
 * Use this when OWNER wants to upgrade/change their subscription.
 * 
 * @param tenantId - The tenant to subscribe
 * @param planTier - Which plan to subscribe to
 * @returns The checkout URL to redirect the user to
 * 
 * Usage in frontend:
 * ```typescript
 * const checkoutUrl = await convex.action(api.checkout.createCheckout, {
 *   tenantId: "...",
 *   planTier: "PRO",
 * });
 * window.location.href = checkoutUrl;
 * ```
 */
export const createCheckout = action({
  args: {
    tenantId: v.id("tenants"),
    planTier: v.union(
      v.literal("BASIC"),
      v.literal("PRO"),
      v.literal("BUSINESS"),
      v.literal("ENTERPRISE")
    ),
  },
  handler: async (ctx, args): Promise<string> => {
    // Get authenticated user
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      throw new Error("You must be signed in to manage billing");
    }
    
    const userId = identity.subject;
    
    // Get Polar access token from environment
    const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;
    
    if (!polarAccessToken) {
      throw new Error("POLAR_ACCESS_TOKEN not configured");
    }
    
    // Determine API base URL based on environment
    const polarEnvironment = process.env.POLAR_ENVIRONMENT || "production";
    const polarApiBase = polarEnvironment === "sandbox" 
      ? "https://sandbox-api.polar.sh" 
      : "https://api.polar.sh";
    
    // Get app base URL for redirects
    const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    
    // Verify user has access to this tenant and is OWNER
    const membership = await ctx.runQuery(api.checkout.verifyCheckoutPermission, {
      tenantId: args.tenantId,
    });
    
    if (!membership) {
      throw new Error("You don't have permission to manage billing for this tenant");
    }
    
    // Get the product ID for the selected tier
    const productId = TIER_TO_PRODUCT_ID[args.planTier];
    
    if (!productId) {
      throw new Error(`Invalid plan tier: ${args.planTier}`);
    }
    
    // Build redirect URLs - include tenantId for context
    const successUrl = `${appBaseUrl}/checkout/success?tenantId=${args.tenantId}`;
    const cancelUrl = `${appBaseUrl}/checkout/cancel`;
    
    console.log("[Checkout] Creating upgrade checkout:", {
      userId,
      tenantId: args.tenantId,
      planTier: args.planTier,
      productId,
      successUrl,
      cancelUrl,
    });
    
    // Create Polar checkout session
    const response = await fetch(`${polarApiBase}/v1/checkouts/custom/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${polarAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          // For existing tenant: tenantId links subscription to tenant
          tenantId: args.tenantId,
          // Also include userId for reference
          userId: userId,
        },
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error("[Checkout] Polar checkout creation failed:", error);
      throw new Error("Failed to create checkout session");
    }
    
    const checkout = await response.json();
    
    console.log("[Checkout] Created checkout session:", {
      checkoutId: checkout.id,
      url: checkout.url,
    });
    
    // Return the checkout URL for frontend redirect
    return checkout.url;
  },
});

/**
 * Internal query to verify user can manage billing.
 * Called by createCheckout action.
 */
export const verifyCheckoutPermission = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return null;
    }
    
    const userId = identity.subject;
    
    // Find membership
    const membership = await ctx.db
      .query("userTenants")
      .withIndex("by_user_tenant", (q) => 
        q.eq("userId", userId).eq("tenantId", args.tenantId)
      )
      .unique();
    
    // Only OWNER can manage billing
    if (!membership || membership.role !== "OWNER") {
      return null;
    }
    
    return membership;
  },
});

// =============================================================================
// SUBSCRIPTION STATUS QUERY
// =============================================================================

/**
 * Get current subscription status for a tenant.
 * Useful for displaying plan info in the UI.
 */
export const getSubscriptionStatus = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      throw new Error("Not authenticated");
    }
    
    const userId = identity.subject;
    
    // Verify user has access to this tenant
    const membership = await ctx.db
      .query("userTenants")
      .withIndex("by_user_tenant", (q) => 
        q.eq("userId", userId).eq("tenantId", args.tenantId)
      )
      .unique();
    
    if (!membership) {
      throw new Error("You don't have access to this tenant");
    }
    
    // Get tenant subscription info
    const tenant = await ctx.db.get(args.tenantId);
    
    if (!tenant) {
      throw new Error("Tenant not found");
    }
    
    return {
      planTier: tenant.planTier,
      subscriptionStatus: tenant.subscriptionStatus,
      isActive: tenant.subscriptionStatus === "active",
      canUpgrade: tenant.planTier !== "BUSINESS" && tenant.planTier !== "ENTERPRISE",
      canDowngrade: tenant.planTier !== "BASIC",
    };
  },
});

// =============================================================================
// PLAN INFO (for displaying options)
// =============================================================================

/**
 * Get available plans with pricing info.
 * No authentication required - public info.
 */
export const getAvailablePlans = query({
  handler: async () => {
    return [
      {
        tier: "BASIC" as const,
        name: "Basic Plan",
        price: 9.99,
        currency: "USD",
        interval: "month",
        features: [
          "1 branch",
          "Up to 5 users",
          "Basic reports",
        ],
        productId: TIER_TO_PRODUCT_ID.BASIC,
      },
      {
        tier: "PRO" as const,
        name: "Professional Plan",
        price: 29.99,
        currency: "USD",
        interval: "month",
        features: [
          "Up to 5 branches",
          "Up to 25 users",
          "Advanced reports",
          "Priority support",
        ],
        productId: TIER_TO_PRODUCT_ID.PRO,
      },
      {
        tier: "BUSINESS" as const,
        name: "Business Plan",
        price: 99.99,
        currency: "USD",
        interval: "month",
        features: [
          "Unlimited branches",
          "Unlimited users",
          "Custom reports",
          "Dedicated support",
          "API access",
        ],
        productId: TIER_TO_PRODUCT_ID.BUSINESS,
      },
    ];
  },
});
