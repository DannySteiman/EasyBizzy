/**
 * POLAR INTEGRATION HELPERS
 * =========================
 * 
 * WHERE THIS LIVES: convex/lib/polar.ts
 * 
 * This file contains:
 * 1. Type definitions for Polar webhook events
 * 2. Webhook signature verification
 * 3. Event parsing helpers
 * 
 * IMPORTANT: You must set these environment variables in Convex:
 * - POLAR_WEBHOOK_SECRET: The webhook secret from Polar dashboard
 * - POLAR_ACCESS_TOKEN: Your Polar API key (for API calls)
 */

// =============================================================================
// POLAR WEBHOOK EVENT TYPES
// =============================================================================

/**
 * Base structure for all Polar webhook events
 */
export type PolarWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
};

/**
 * Polar subscription object (simplified)
 */
export type PolarSubscription = {
  id: string;
  status: "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid";
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  customer_id: string;
  product_id: string;
  price_id: string;
  metadata: Record<string, string>;
};

/**
 * Polar customer object (simplified)
 */
export type PolarCustomer = {
  id: string;
  email: string;
  name: string | null;
  metadata: Record<string, string>;
};

/**
 * Polar checkout object (simplified)
 */
export type PolarCheckout = {
  id: string;
  status: "open" | "expired" | "succeeded";
  customer_id: string | null;
  product_id: string;
  product_price_id: string;
  metadata: Record<string, string>;
  success_url: string;
  customer_email: string | null;
};

/**
 * Subscription event data
 */
export type SubscriptionEventData = {
  subscription: PolarSubscription;
  customer: PolarCustomer;
};

/**
 * Checkout event data
 */
export type CheckoutEventData = {
  checkout: PolarCheckout;
};

// =============================================================================
// WEBHOOK EVENT TYPES (what we handle)
// =============================================================================

export type PolarSubscriptionCreated = {
  type: "subscription.created";
  data: SubscriptionEventData;
};

export type PolarSubscriptionUpdated = {
  type: "subscription.updated";
  data: SubscriptionEventData;
};

export type PolarSubscriptionCanceled = {
  type: "subscription.canceled";
  data: SubscriptionEventData;
};

export type PolarSubscriptionRevoked = {
  type: "subscription.revoked";
  data: SubscriptionEventData;
};

export type PolarCheckoutCreated = {
  type: "checkout.created";
  data: CheckoutEventData;
};

export type PolarCheckoutUpdated = {
  type: "checkout.updated";
  data: CheckoutEventData;
};

/**
 * All webhook event types we handle
 */
export type HandledPolarEvent =
  | PolarSubscriptionCreated
  | PolarSubscriptionUpdated
  | PolarSubscriptionCanceled
  | PolarSubscriptionRevoked
  | PolarCheckoutCreated
  | PolarCheckoutUpdated;

// =============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify Polar webhook signature using HMAC-SHA256
 * 
 * Polar uses Standard Webhooks format with these headers:
 * - webhook-id: Unique message ID
 * - webhook-timestamp: Unix timestamp
 * - webhook-signature: "v1,base64_signature" (may have multiple signatures)
 * 
 * The signed payload format is: "{webhook-id}.{webhook-timestamp}.{body}"
 * 
 * @param payload - The raw request body as string
 * @param webhookId - The webhook-id header value
 * @param webhookTimestamp - The webhook-timestamp header value  
 * @param webhookSignature - The webhook-signature header value
 * @param secret - Your POLAR_WEBHOOK_SECRET
 * @returns true if signature is valid
 */
export async function verifyPolarWebhookSignature(
  payload: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  secret: string
): Promise<boolean> {
  try {
    // Validate required headers
    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.error("Missing required webhook headers:", {
        hasId: !!webhookId,
        hasTimestamp: !!webhookTimestamp,
        hasSignature: !!webhookSignature,
      });
      return false;
    }
    
    // Check timestamp is not too old (5 minutes tolerance)
    const timestampNum = parseInt(webhookTimestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampNum) > 300) {
      console.error("Webhook timestamp too old:", { timestampNum, now, diff: Math.abs(now - timestampNum) });
      return false;
    }
    
    // Create the signed payload: "{id}.{timestamp}.{body}"
    const signedPayload = `${webhookId}.${webhookTimestamp}.${payload}`;
    
    // The secret from Polar may start with "whsec_" or "polar_whs_" 
    // We need to handle different formats
    let secretBuffer: ArrayBuffer;
    const encoder = new TextEncoder();
    
    if (secret.startsWith("whsec_")) {
      // Standard Webhooks format - decode base64 after prefix
      const secretBase64 = secret.slice(6);
      const binaryString = atob(secretBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      secretBuffer = bytes.buffer;
    } else {
      // Polar format (polar_whs_...) - use as-is
      secretBuffer = encoder.encode(secret).buffer;
    }
    
    // Compute HMAC-SHA256
    const key = await crypto.subtle.importKey(
      "raw",
      secretBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload)
    );
    
    // Convert to base64
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
    
    // Parse the signature header - format: "v1,base64sig" or "v1,sig1 v1,sig2"
    // Polar may send multiple signatures, we need to match any one
    const signatures = webhookSignature.split(" ");
    
    for (const sig of signatures) {
      const [version, expectedSig] = sig.split(",");
      if (version === "v1" && expectedSig === computedSignature) {
        return true;
      }
    }
    
    console.error("Signature mismatch:", {
      computed: computedSignature,
      received: webhookSignature,
    });
    return false;
  } catch (error) {
    console.error("Error verifying webhook signature:", error);
    return false;
  }
}

// =============================================================================
// EVENT PARSING HELPERS
// =============================================================================

/**
 * Map Polar subscription status to our SubscriptionStatus
 */
export function mapPolarStatusToSubscriptionStatus(
  polarStatus: PolarSubscription["status"]
): "trialing" | "inactive" | "active" | "past_due" | "canceled" {
  switch (polarStatus) {
    case "active":
      return "active";
    case "trialing":
      // IMPORTANT: Trialing is NOT paid "active". Store explicitly as "trialing".
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
    default:
      return "inactive";
  }
}

/**
 * Extract tenantId from metadata
 * 
 * When creating a checkout session, you should include the tenantId in metadata:
 * { metadata: { tenantId: "abc123" } }
 * 
 * This allows us to link the subscription back to the tenant.
 */
export function extractTenantIdFromMetadata(
  metadata: Record<string, string> | undefined
): string | null {
  return metadata?.tenantId ?? null;
}

/**
 * Extract userId from metadata
 * 
 * CRITICAL: When creating a Polar checkout session, you MUST include the userId:
 * { metadata: { userId: "user_abc123" } }
 * 
 * This is the PRIMARY way we know who owns the subscription.
 * The userId should be the Convex Auth subject (identity.subject).
 * 
 * Why this matters:
 * - Polar webhook is the source of truth for tenant creation
 * - We need to know which user to make OWNER
 * - Email matching is a fallback, not the primary mechanism
 */
export function extractUserIdFromMetadata(
  metadata: Record<string, string> | undefined
): string | null {
  return metadata?.userId ?? null;
}

/**
 * Extract customer name from metadata (for tenant placeholder name)
 */
export function extractCustomerNameFromMetadata(
  metadata: Record<string, string> | undefined
): string | null {
  return metadata?.customerName ?? metadata?.tenantName ?? null;
}

/**
 * Map Polar product ID to our plan tier
 * 
 * You need to update this with your actual Polar product IDs.
 * Get these from your Polar dashboard after creating products.
 */
const POLAR_PRODUCT_TO_TIER: Record<string, "BASIC" | "PRO" | "ENTERPRISE"> = {
  // Sandbox Product IDs
  "ef6ac2cb-46e9-45da-a6a1-904b272b4593": "BASIC",
  "6c246b51-981c-4532-8acf-fa7614eae62b": "PRO",
  "6531fabd-c5bc-45fe-ab45-2ac3f77b893d": "ENTERPRISE",
};

export function mapProductIdToTier(
  productId: string
): "BASIC" | "PRO" | "ENTERPRISE" | null {
  return POLAR_PRODUCT_TO_TIER[productId] ?? null;
}

/**
 * Set the product ID to tier mapping at runtime
 * Call this during initialization if you want to configure dynamically
 */
export function setProductTierMapping(
  productId: string,
  tier: "BASIC" | "PRO" | "ENTERPRISE"
): void {
  POLAR_PRODUCT_TO_TIER[productId] = tier;
}

// =============================================================================
// WEBHOOK RESPONSE HELPERS
// =============================================================================

/**
 * Create a successful webhook response
 */
export function webhookSuccess(message: string = "OK"): Response {
  return new Response(JSON.stringify({ success: true, message }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create an error webhook response
 */
export function webhookError(message: string, status: number = 400): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
