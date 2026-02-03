"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuthUser } from "../ConvexClientProvider";
import { UserButton } from "../components/UserButton";
import Link from "next/link";

// Fallback plans data (used when Convex isn't connected)
const FALLBACK_PLANS = [
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
  },
  {
    tier: "ENTERPRISE" as const,
    name: "Enterprise Plan",
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
  },
];

/**
 * PRICING PAGE - Checkout-First Flow
 * ===================================
 * 
 * Supports BOTH authenticated and anonymous checkout:
 * 
 * A) Authenticated users → startNewSubscriptionCheckout
 *    - userId included in metadata
 *    - Tenant created as "claimed"
 * 
 * B) Anonymous users → startAnonymousCheckout  
 *    - No auth required
 *    - Polar collects email during checkout
 *    - Tenant created as "unclaimed"
 *    - After checkout, user prompted to create account
 *    - Tenant claimed when account created with matching email
 */
function PricingPageInner() {
  const searchParams = useSearchParams();
  const trialExpired = searchParams.get("trial_expired") === "true";
  
  const { isAuthenticated } = useAuthUser();
  const convexPlans = useQuery(api.checkout.getAvailablePlans);
  const startCheckout = useAction(api.checkout.startNewSubscriptionCheckout);
  const startAnonymousCheckout = useAction(api.checkout.startAnonymousCheckout);
  
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);

  // Use fallback after 3 seconds if Convex doesn't respond
  useEffect(() => {
    const timer = setTimeout(() => {
      if (convexPlans === undefined) {
        console.log("[Pricing] Using fallback plans (Convex timeout)");
        setUseFallback(true);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [convexPlans]);

  // Use Convex plans if available, otherwise fallback
  const plans = convexPlans ?? (useFallback ? FALLBACK_PLANS : undefined);

  const handleSelectPlan = async (tier: "BASIC" | "PRO" | "ENTERPRISE") => {
    setLoading(tier);
    setError(null);

    try {
      let checkoutUrl: string;
      
      if (isAuthenticated) {
        // Authenticated checkout - userId will be in metadata
        console.log(`[Pricing] Starting authenticated checkout for ${tier}`);
        checkoutUrl = await startCheckout({ planTier: tier });
      } else {
        // Anonymous checkout - Polar will collect email
        console.log(`[Pricing] Starting anonymous checkout for ${tier}`);
        checkoutUrl = await startAnonymousCheckout({ planTier: tier });
      }
      
      console.log(`[Pricing] Redirecting to: ${checkoutUrl}`);
      window.location.href = checkoutUrl;
    } catch (err) {
      console.error("[Pricing] Checkout error:", err);
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setLoading(null);
    }
  };

  if (plans === undefined) {
    return (
      <div className="page-center">
        <div className="card">
          <div className="spinner" />
          <p className="subtitle">Loading plans...</p>
          <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "1rem" }}>
            Connecting to server...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-center" style={{ alignItems: "stretch" }}>
      {/* Header with User Button */}
      {isAuthenticated && (
        <div style={{ 
          position: "fixed", 
          top: "1rem", 
          right: "1rem", 
          zIndex: 100 
        }}>
          <UserButton />
        </div>
      )}
      
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem" }}>
        {/* Trial Expired Message */}
        {trialExpired && (
          <div style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1.5rem",
            textAlign: "center",
          }}>
            <p style={{ color: "#991b1b", fontWeight: "600", marginBottom: "0.25rem" }}>
              Your free trial has expired
            </p>
            <p style={{ color: "#b91c1c", fontSize: "0.875rem" }}>
              Choose a plan below to continue using your workspace with all your data intact.
            </p>
          </div>
        )}
        
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1 className="title" style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
            Choose Your Plan
          </h1>
          <p className="subtitle">
            Start with a plan that works for you. Upgrade anytime.
          </p>
          {error && (
            <p style={{ 
              color: "var(--error)", 
              fontSize: "0.875rem",
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              background: "#fee2e2",
              borderRadius: "0.5rem"
            }}>
              {error}
            </p>
          )}
        </div>

        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "1.5rem"
        }}>
          {plans.map((plan) => (
            <div 
              key={plan.tier}
              className="card"
              style={{ 
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                border: plan.tier === "PRO" ? "2px solid var(--primary)" : undefined,
              }}
            >
              {plan.tier === "PRO" && (
                <span 
                  className="badge badge-success"
                  style={{ 
                    alignSelf: "flex-start",
                    marginBottom: "0.5rem"
                  }}
                >
                  Most Popular
                </span>
              )}
              
              <h2 style={{ fontSize: "1.25rem", fontWeight: "600" }}>
                {plan.name}
              </h2>
              
              <div style={{ margin: "1rem 0" }}>
                <span style={{ fontSize: "2rem", fontWeight: "700" }}>
                  ${plan.price}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  /{plan.interval}
                </span>
              </div>

              <ul style={{ 
                listStyle: "none", 
                padding: 0, 
                margin: "1rem 0",
                flex: 1
              }}>
                {plan.features.map((feature, i) => (
                  <li 
                    key={i}
                    style={{ 
                      padding: "0.5rem 0",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.875rem"
                    }}
                  >
                    <span style={{ color: "var(--success)" }}>✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                className={`btn ${plan.tier === "PRO" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => handleSelectPlan(plan.tier)}
                disabled={loading !== null}
                style={{ width: "100%", marginTop: "auto" }}
              >
                {loading === plan.tier ? (
                  <>
                    <span className="spinner" style={{ 
                      width: "1rem", 
                      height: "1rem", 
                      marginRight: "0.5rem" 
                    }} />
                    Loading...
                  </>
                ) : (
                  `Get ${plan.tier}`
                )}
              </button>
            </div>
          ))}
        </div>

        <p style={{ 
          textAlign: "center", 
          marginTop: "2rem",
          fontSize: "0.75rem",
          color: "var(--muted)"
        }}>
          All plans include a 14-day free trial. Cancel anytime.
        </p>

        <div style={{ textAlign: "center", marginTop: "1rem" }}>
          <Link 
            href="/" 
            style={{ 
              fontSize: "0.875rem", 
              color: "var(--primary)",
              textDecoration: "none"
            }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense
      fallback={
        <div className="page-center">
          <div className="card">
            <div className="spinner" />
            <p className="subtitle">Loading pricing...</p>
          </div>
        </div>
      }
    >
      <PricingPageInner />
    </Suspense>
  );
}
