"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuthUser } from "../../ConvexClientProvider";
import Link from "next/link";

/**
 * CHECKOUT SUCCESS PAGE - Checkout-First Flow
 * ============================================
 * 
 * Handles BOTH authenticated and anonymous checkouts:
 * 
 * A) Authenticated checkout:
 *    - User was logged in during checkout
 *    - Tenant created with userId, already claimed
 *    - Poll until ready, then redirect
 * 
 * B) Anonymous checkout (checkout-first):
 *    - User was NOT logged in during checkout
 *    - Polar collected email during payment
 *    - Tenant created with email, NOT claimed
 *    - Show "Create account" prompt
 *    - After sign-up, claim the tenant
 * 
 * URL params:
 * - anonymous=true: Indicates anonymous checkout
 * - plan=BASIC|PRO|ENTERPRISE: Selected plan tier
 */

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_TIME_MS = 60000;

type PageState = 
  | "loading"
  | "anonymous_create_account"  // Anonymous checkout - need to create account
  | "polling"                   // Waiting for webhook
  | "claiming"                  // Claiming unclaimed tenant
  | "ready"                     // Tenant ready, redirecting
  | "timeout"
  | "error";

function CheckoutSuccessPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoading: authLoading, isAuthenticated } = useAuthUser();
  
  const isAnonymousCheckout = searchParams.get("anonymous") === "true";
  const planTier = searchParams.get("plan");
  
  const [pageState, setPageState] = useState<PageState>("loading");
  const [pollStartTime, setPollStartTime] = useState<number | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Queries
  const tenantStatus = useQuery(
    api.tenants.isMyTenantReady,
    isAuthenticated ? undefined : "skip"
  );
  const unclaimedTenant = useQuery(
    api.tenants.getUnclaimedTenantForMyEmail,
    isAuthenticated ? undefined : "skip"
  );
  const activeTenant = useQuery(
    api.tenants.getMyActiveTenantAsOwner,
    isAuthenticated ? undefined : "skip"
  );
  
  // Mutations
  const claimTenant = useMutation(api.tenants.claimTenantByEmail);

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[CheckoutSuccess] ${message}`);
    setDebugLog((prev) => [...prev.slice(-20), `${timestamp} - ${message}`]);
  };

  const startPolling = useCallback(() => {
    addLog("Starting polling for tenant setup...");
    setPollStartTime(Date.now());
    setPollCount(0);
    setPageState("polling");
  }, []);

  const handleRetry = useCallback(() => {
    addLog("Retry requested");
    setClaimError(null);
    startPolling();
  }, [startPolling]);

  // Handle claiming an unclaimed tenant
  const handleClaimTenant = useCallback(async () => {
    addLog("Attempting to claim tenant...");
    setPageState("claiming");
    setClaimError(null);
    
    try {
      const result = await claimTenant();
      addLog(`Tenant claimed successfully: ${result.tenantId}`);
      
      // Redirect to onboarding
      router.push(`/app/${result.tenantId}/onboarding`);
    } catch (error) {
      console.error("Claim error:", error);
      addLog(`Claim failed: ${error}`);
      setClaimError(error instanceof Error ? error.message : "Failed to claim workspace");
      setPageState("error");
    }
  }, [claimTenant, router]);

  // Main state management effect
  useEffect(() => {
    // Wait for auth to load
    if (authLoading) {
      addLog("Waiting for auth...");
      return;
    }

    // =========================================
    // ANONYMOUS CHECKOUT - Not authenticated
    // =========================================
    if (!isAuthenticated) {
      if (isAnonymousCheckout) {
        addLog("Anonymous checkout - prompting account creation");
        setPageState("anonymous_create_account");
      } else {
        // Regular checkout but not authenticated - redirect to sign in
        addLog("Not authenticated, redirecting to sign-in");
        router.push("/sign-in?redirect=/checkout/success");
      }
      return;
    }

    // =========================================
    // AUTHENTICATED - Check tenant status
    // =========================================
    
    // Start polling if not already started
    if (pollStartTime === null) {
      startPolling();
      return;
    }

    // Check for timeout
    const elapsed = Date.now() - pollStartTime;
    if (elapsed > MAX_POLL_TIME_MS) {
      addLog(`Timeout after ${elapsed}ms`);
      setPageState("timeout");
      return;
    }

    // Wait for queries to load
    if (tenantStatus === undefined) {
      return;
    }

    addLog(`Poll #${pollCount + 1}: status=${JSON.stringify(tenantStatus)}`);
    setPollCount((c) => c + 1);

    // Check if tenant is ready
    if (tenantStatus.ready) {
      // Check if tenant needs claiming (anonymous checkout flow)
      if (tenantStatus.needsClaiming) {
        addLog("Tenant ready but needs claiming - auto-claiming...");
        handleClaimTenant();
        return;
      }
      
      // Tenant is ready and claimed
      addLog("Tenant ready! Getting details...");
      
      if (activeTenant === undefined) {
        return; // Still loading
      }
      
      if (activeTenant) {
        addLog(`Tenant found: ${activeTenant.tenantId}, isNew=${activeTenant.isNewTenant}`);
        setPageState("ready");
        
        if (activeTenant.isNewTenant) {
          addLog(`Redirecting to onboarding: /app/${activeTenant.tenantId}/onboarding`);
          router.push(`/app/${activeTenant.tenantId}/onboarding`);
        } else {
          addLog(`Redirecting to manager home: /app/${activeTenant.tenantId}/manager/home`);
          router.push(`/app/${activeTenant.tenantId}/manager/home`);
        }
      } else {
        addLog("WARNING: tenantStatus.ready=true but no activeTenant data");
        setPageState("error");
      }
    } else {
      // Not ready yet - check for unclaimed tenant
      if (unclaimedTenant) {
        addLog(`Found unclaimed tenant: ${unclaimedTenant.tenantId} - claiming...`);
        handleClaimTenant();
        return;
      }
      
      // Continue polling
      const timeoutId = setTimeout(() => {
        setPollCount((c) => c);
      }, POLL_INTERVAL_MS);
      
      return () => clearTimeout(timeoutId);
    }
  }, [
    authLoading,
    isAuthenticated,
    isAnonymousCheckout,
    pollStartTime,
    tenantStatus,
    activeTenant,
    unclaimedTenant,
    pollCount,
    router,
    startPolling,
    handleClaimTenant,
  ]);

  const elapsedSeconds = pollStartTime 
    ? Math.floor((Date.now() - pollStartTime) / 1000) 
    : 0;

  // =========================================
  // RENDER STATES
  // =========================================

  // Loading
  if (pageState === "loading") {
    return (
      <div className="page-center">
        <div className="card">
          <div className="spinner" />
          <p className="subtitle">Loading...</p>
        </div>
      </div>
    );
  }

  // Anonymous checkout - Create account prompt
  if (pageState === "anonymous_create_account") {
    return (
      <div className="page-center">
        <div className="card">
          <div style={{ 
            fontSize: "3rem", 
            marginBottom: "1rem",
            color: "#22c55e" 
          }}>
            ✓
          </div>
          <h1 className="title">Payment Successful!</h1>
          <p className="subtitle">
            Your {planTier || "subscription"} plan is ready. 
            Create your account to access your workspace.
          </p>
          
          <div className="btn-group" style={{ marginTop: "1.5rem" }}>
            <Link 
              href="/sign-up?redirect=/checkout/success" 
              className="btn btn-primary"
            >
              Create Account
            </Link>
          </div>
          
          <p style={{ 
            fontSize: "0.875rem", 
            color: "var(--muted)", 
            marginTop: "1.5rem" 
          }}>
            Already have an account?{" "}
            <Link 
              href="/sign-in?redirect=/checkout/success" 
              style={{ color: "var(--primary)" }}
            >
              Sign in
            </Link>
          </p>
          
          <div className="debug-info">
            <strong>Debug Log:</strong>
            <pre>{debugLog.join("\n")}</pre>
          </div>
        </div>
      </div>
    );
  }

  // Claiming tenant
  if (pageState === "claiming") {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="title">Setting up your workspace...</h1>
          <div className="spinner" />
          <p className="subtitle">
            Linking your account to your new subscription.
          </p>
          <div className="debug-info">
            <strong>Debug Log:</strong>
            <pre>{debugLog.join("\n")}</pre>
          </div>
        </div>
      </div>
    );
  }

  // Polling
  if (pageState === "polling") {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="title">Finishing setup...</h1>
          <div className="spinner" />
          <p className="subtitle">
            This can take a few seconds while we confirm your payment.
          </p>
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: "1rem" }}>
            Waiting... {elapsedSeconds}s
          </p>
          <div className="debug-info">
            <strong>Debug Log:</strong>
            <pre>{debugLog.join("\n")}</pre>
          </div>
        </div>
      </div>
    );
  }

  // Ready - redirecting
  if (pageState === "ready") {
    return (
      <div className="page-center">
        <div className="card">
          <div style={{ 
            fontSize: "3rem", 
            marginBottom: "1rem",
            color: "#22c55e" 
          }}>
            ✓
          </div>
          <h1 className="title">Setup complete!</h1>
          <div className="spinner" />
          <p className="subtitle">Redirecting to your workspace...</p>
          <div className="debug-info">
            <strong>Debug Log:</strong>
            <pre>{debugLog.join("\n")}</pre>
          </div>
        </div>
      </div>
    );
  }

  // Timeout
  if (pageState === "timeout") {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="title">Setup incomplete</h1>
          <p className="subtitle">
            We couldn&apos;t finish setup automatically. 
            This can happen if there&apos;s a delay processing your payment.
          </p>
          <div className="btn-group">
            <button className="btn btn-primary" onClick={handleRetry}>
              Try Again
            </button>
            <Link href="/pricing" className="btn btn-secondary">
              Back to Pricing
            </Link>
          </div>
          <p style={{ 
            fontSize: "0.75rem", 
            color: "var(--muted)", 
            marginTop: "1.5rem" 
          }}>
            If this keeps happening, please contact support with your order details.
          </p>
          <div className="debug-info">
            <strong>Debug Log:</strong>
            <pre>{debugLog.join("\n")}</pre>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="page-center">
      <div className="card">
        <h1 className="title">Something went wrong</h1>
        <p className="subtitle">
          {claimError || "We encountered an unexpected error during setup."}
        </p>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={handleRetry}>
            Try Again
          </button>
          <Link href="/pricing" className="btn btn-secondary">
            Back to Pricing
          </Link>
        </div>
        <div className="debug-info">
          <strong>Debug Log:</strong>
          <pre>{debugLog.join("\n")}</pre>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="page-center">
          <div className="card">
            <div className="spinner" />
            <p className="subtitle">Loading...</p>
          </div>
        </div>
      }
    >
      <CheckoutSuccessPageInner />
    </Suspense>
  );
}
