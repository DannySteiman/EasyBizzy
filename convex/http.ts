/**
 * HTTP ENDPOINTS
 * ==============
 * 
 * WHERE THIS LIVES: convex/http.ts
 * 
 * This file defines HTTP endpoints for external integrations.
 * The main endpoint is /webhooks/polar for receiving Polar webhook events.
 * 
 * URL: https://[your-deployment].convex.site/webhooks/polar
 * 
 * SETUP:
 * 1. Deploy your Convex app
 * 2. Copy the .convex.site URL
 * 3. Add webhook in Polar dashboard pointing to /webhooks/polar
 * 4. Copy the webhook secret and set POLAR_WEBHOOK_SECRET env var
 * 
 * WEBHOOK-FIRST ARCHITECTURE (CRITICAL)
 * =====================================
 * Polar webhooks are the AUTHORITATIVE SOURCE for:
 * - Tenant creation
 * - Main branch creation
 * - OWNER membership creation
 * 
 * The UI/checkout success page must NEVER create tenants directly.
 * Instead, the UI should poll for "do I have an active tenant as OWNER?"
 * 
 * Flow:
 * 1. User initiates checkout → pass { metadata: { userId: identity.subject } }
 * 2. User completes payment → Polar sends subscription.created
 * 3. Webhook handler creates Tenant + Branch + OWNER membership
 * 4. UI detects the new tenant and redirects to Main App
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { 
  verifyPolarWebhookSignature, 
  webhookSuccess, 
  webhookError,
  type HandledPolarEvent,
} from "./lib/polar";

const http = httpRouter();

// =============================================================================
// POLAR WEBHOOK ENDPOINT
// =============================================================================

/**
 * POST /webhooks/polar
 * 
 * Receives webhook events from Polar and processes them.
 * 
 * Events handled:
 * - subscription.created: New subscription activated
 * - subscription.updated: Subscription changed (plan, status)
 * - subscription.canceled: Subscription was canceled
 * - subscription.revoked: Subscription access removed
 * - checkout.created/updated: Checkout session events
 */
http.route({
  path: "/webhooks/polar",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Get the webhook secret from environment
    const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.error("POLAR_WEBHOOK_SECRET not configured");
      return webhookError("Webhook not configured", 500);
    }
    
    // Get the Standard Webhooks headers that Polar uses
    const webhookId = request.headers.get("webhook-id");
    const webhookTimestamp = request.headers.get("webhook-timestamp");
    const webhookSignature = request.headers.get("webhook-signature");
    
    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.error("Missing webhook headers:", {
        "webhook-id": webhookId,
        "webhook-timestamp": webhookTimestamp,
        "webhook-signature": !!webhookSignature,
      });
      return webhookError("Missing webhook headers", 401);
    }
    
    // Get the raw body for signature verification
    const body = await request.text();
    
    // Verify the signature using Standard Webhooks format
    const isValid = await verifyPolarWebhookSignature(
      body,
      webhookId,
      webhookTimestamp,
      webhookSignature,
      webhookSecret
    );
    
    if (!isValid) {
      console.error("Invalid webhook signature");
      return webhookError("Invalid signature", 401);
    }
    
    // Parse the event
    let event: HandledPolarEvent;
    try {
      event = JSON.parse(body) as HandledPolarEvent;
    } catch (error) {
      console.error("Failed to parse webhook body:", error);
      return webhookError("Invalid JSON", 400);
    }
    
    console.log(`Received Polar webhook: ${event.type}`);
    
    // Handle the event based on type
    try {
      switch (event.type) {
        // ===================
        // SUBSCRIPTION EVENTS
        // ===================
        
        case "subscription.created": {
          // WEBHOOK-FIRST: This is where tenants get created
          // Polar subscription events are the authoritative source
          const { subscription, customer } = event.data;
          await ctx.runMutation(internal.polarWebhooks.handleSubscriptionCreated, {
            subscriptionId: subscription.id,
            customerId: customer.id,
            productId: subscription.product_id,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            customerEmail: customer.email,
            customerName: customer.name ?? undefined,
            metadata: subscription.metadata,
          } as any);
          break;
        }
        
        case "subscription.updated": {
          const { subscription, customer } = event.data;
          await ctx.runMutation(internal.polarWebhooks.handleSubscriptionUpdated, {
            subscriptionId: subscription.id,
            customerId: customer.id,
            productId: subscription.product_id,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            customerEmail: customer.email,
            metadata: subscription.metadata,
          } as any);
          break;
        }
        
        case "subscription.canceled": {
          const { subscription, customer } = event.data;
          await ctx.runMutation(internal.polarWebhooks.handleSubscriptionCanceled, {
            subscriptionId: subscription.id,
            customerId: customer.id,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          });
          break;
        }
        
        case "subscription.revoked": {
          const { subscription, customer } = event.data;
          await ctx.runMutation(internal.polarWebhooks.handleSubscriptionRevoked, {
            subscriptionId: subscription.id,
            customerId: customer.id,
          });
          break;
        }
        
        // ================
        // CHECKOUT EVENTS
        // ================
        
        case "checkout.created":
        case "checkout.updated": {
          // Note: Tenant creation happens in subscription.created, not here
          // This is only for tracking checkout progress
          const { checkout } = event.data;
          await ctx.runMutation(internal.polarWebhooks.handleCheckoutEvent, {
            checkoutId: checkout.id,
            status: checkout.status,
            customerId: checkout.customer_id ?? undefined,
            customerEmail: checkout.customer_email ?? undefined,
            metadata: checkout.metadata,
          });
          break;
        }
        
        default: {
          // Log unhandled events but don't fail
          console.log(`Unhandled Polar event type: ${(event as { type: string }).type}`);
        }
      }
      
      return webhookSuccess(`Processed ${event.type}`);
      
    } catch (error) {
      console.error(`Error processing ${event.type}:`, error);
      // Return 200 to prevent Polar from retrying indefinitely
      // Log the error for debugging
      return webhookSuccess(`Acknowledged ${event.type} (with error)`);
    }
  }),
});

// =============================================================================
// HEALTH CHECK ENDPOINT (optional)
// =============================================================================

/**
 * GET /health
 * 
 * Simple health check endpoint for monitoring
 */
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// =============================================================================
// CORS PREFLIGHT (if needed for browser requests)
// =============================================================================

/**
 * OPTIONS /webhooks/polar
 * 
 * Handle CORS preflight requests (not usually needed for webhooks)
 */
http.route({
  path: "/webhooks/polar",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, webhook-signature",
      },
    });
  }),
});

export default http;
