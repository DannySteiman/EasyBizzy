"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { useAuthUser } from "./ConvexClientProvider";
import { UserButton } from "./components/UserButton";
import Link from "next/link";

/**
 * ROOT PAGE - Entry Gate Router (with 14-day Free Trial)
 * ======================================================
 * 
 * Flow for new users:
 * 1. Sign up → automatically create trial tenant → redirect to onboarding
 * 2. Trial active → redirect to dashboard
 * 3. Trial expired → redirect to pricing
 * 
 * Flow for existing users:
 * 1. SAAS_ADMIN → /admin
 * 2. Active subscription → dashboard
 * 3. Inactive → pricing
 */
export default function EntryGatePage() {
  const router = useRouter();
  const { isLoading: authLoading, isAuthenticated } = useAuthUser();
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [isCreatingTrial, setIsCreatingTrial] = useState(false);
  const [trialCreated, setTrialCreated] = useState(false);
  const [accessSyncDone, setAccessSyncDone] = useState(false);
  const [accessSyncFoundTenants, setAccessSyncFoundTenants] = useState(false);
  const [accessSyncCompletedAt, setAccessSyncCompletedAt] = useState<number | null>(null);

  // Only query Convex if authenticated
  const userInfo = useQuery(
    api.users.getMyUserInfo,
    isAuthenticated ? undefined : "skip"
  );
  
  const subscriptionStatus = useQuery(
    api.tenants.getMySubscriptionStatus,
    isAuthenticated ? undefined : "skip"
  );
  
  const trialStatus = useQuery(
    api.tenants.getTrialStatus,
    isAuthenticated ? undefined : "skip"
  );
  
  // Mutation to create trial tenant
  const createTrialTenant = useMutation(api.tenants.createTrialTenant);
  const syncMyAccessFromEmail = useMutation(api.team.syncMyAccessFromEmail);

  const addLog = (message: string) => {
    console.log(`[EntryGate] ${message}`);
    setDebugLog((prev) => [...prev.slice(-10), `${new Date().toISOString().slice(11, 19)} - ${message}`]);
  };

  // Failsafe: if Clerk never finishes loading (adblock/network/race), don't trap the user forever.
  useEffect(() => {
    if (!authLoading) {
      setAuthTimedOut(false);
      return;
    }
    const t = window.setTimeout(() => setAuthTimedOut(true), 8000);
    return () => window.clearTimeout(t);
  }, [authLoading]);

  // Auto-create trial for new users
  const handleCreateTrial = async () => {
    if (isCreatingTrial || trialCreated) return;
    
    setIsCreatingTrial(true);
    addLog("Creating trial tenant...");
    
    try {
      const result = await createTrialTenant({});
      addLog(`Trial created! Tenant: ${result.tenantId}`);
      setTrialCreated(true);
      // Redirect to onboarding
      router.push(`/app/${result.tenantId}/onboarding`);
    } catch (error) {
      console.error("Failed to create trial:", error);
      addLog(`Trial creation failed: ${error}`);
      setIsCreatingTrial(false);
    }
  };

  // Auto-sync memberships from allowlisted email once per browser session
  useEffect(() => {
    if (authLoading) return;

    // Not authenticated: nothing to sync
    if (!isAuthenticated) {
      setAccessSyncDone(true);
      return;
    }

    // Already done this session
    const storageKey = "easybizzy_access_sync_done";
    if (typeof window !== "undefined" && window.sessionStorage.getItem(storageKey) === "1") {
      setAccessSyncDone(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        addLog("Syncing team access from email...");
        const result = await syncMyAccessFromEmail();
        setAccessSyncFoundTenants(!!result?.synced);
        setAccessSyncCompletedAt(Date.now());

        if (result?.synced) {
          addLog(
            `Access synced for ${result.tenantIds.length} workspace(s)` +
              (result.tenantIds.length > 1 ? " (TODO: tenant switcher)" : "")
          );
        } else {
          addLog("No allowlisted access found for this email");
        }
      } catch (error) {
        console.error("Access sync failed:", error);
        addLog(`Access sync failed: ${error}`);
      } finally {
        if (cancelled) return;
        try {
          window.sessionStorage.setItem(storageKey, "1");
        } catch {
          // ignore (e.g., storage blocked)
        }
        setAccessSyncDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, syncMyAccessFromEmail]);

  useEffect(() => {
    // Wait for auth to load
    if (authLoading) {
      addLog("Waiting for auth...");
      return;
    }

    // Not authenticated -> show welcome page
    if (!isAuthenticated) {
      addLog("Not authenticated, showing welcome page");
      return;
    }

    // Ensure allowlist sync runs before routing decisions (prevents creating trial incorrectly)
    if (!accessSyncDone) {
      return;
    }

    // Authenticated - wait for Convex queries
    if (userInfo === undefined || subscriptionStatus === undefined || trialStatus === undefined) {
      addLog("Waiting for user data...");
      return;
    }

    addLog(`User info loaded: isSaasAdmin=${userInfo?.isSaasAdmin}`);
    addLog(`Subscription: ${JSON.stringify(subscriptionStatus)}`);
    addLog(`Trial: ${JSON.stringify(trialStatus)}`);

    // ROUTING LOGIC
    
    // SAAS_ADMIN users can also use the app as tenant owners/managers.
    // Do not short-circuit to /admin here; let normal tenant/trial routing run.
    if (userInfo?.isSaasAdmin) {
      addLog("SAAS_ADMIN detected, continuing through tenant/trial routing");
    }

    // If we just synced access and found tenants, give subscription status a moment to refresh
    if (
      accessSyncFoundTenants &&
      !subscriptionStatus.hasTenant &&
      accessSyncCompletedAt !== null &&
      Date.now() - accessSyncCompletedAt < 3000
    ) {
      return;
    }

    // 2. No tenant -> Create trial automatically
    if (!subscriptionStatus.hasTenant && !isCreatingTrial && !trialCreated) {
      addLog("No tenant found, creating trial...");
      handleCreateTrial();
      return;
    }

    // 3. Has trialing tenant - check if expired
    if (trialStatus?.isTrialing) {
      if (trialStatus.isExpired) {
        addLog("Trial expired, redirecting to /pricing");
        router.push("/pricing?trial_expired=true");
        return;
      }
      
      // Trial active -> go to dashboard
      addLog(`Trial active (${trialStatus.daysRemaining} days left), redirecting to dashboard`);
      router.push(`/app/${trialStatus.tenantId}/manager/home`);
      return;
    }

    // 4. Has active paid subscription
    if (subscriptionStatus.hasActiveTenant && subscriptionStatus.tenant) {
      const { tenantId, role } = subscriptionStatus.tenant;
      
      if (role === "WORKER") {
        addLog(`Worker detected, redirecting to /app/${tenantId}/worker/home`);
        router.push(`/app/${tenantId}/worker/home`);
      } else {
        addLog(`${role} detected, redirecting to /app/${tenantId}/manager/home`);
        router.push(`/app/${tenantId}/manager/home`);
      }
      return;
    }

    // 5. Has tenant but not active
    if (subscriptionStatus.hasTenant && !subscriptionStatus.hasActiveTenant) {
      addLog("Tenant inactive, redirecting to /pricing");
      router.push("/pricing");
      return;
    }

    addLog("Reached end of routing logic");
  }, [
    authLoading,
    isAuthenticated,
    accessSyncDone,
    accessSyncFoundTenants,
    accessSyncCompletedAt,
    userInfo,
    subscriptionStatus,
    trialStatus,
    router,
    isCreatingTrial,
    trialCreated,
  ]);

  // Loading state
  if (authLoading) {
    return (
      <div className="page-center">
        <div className="card">
          {!authTimedOut ? (
            <>
              <div className="spinner" />
              <p className="subtitle">Loading...</p>
            </>
          ) : (
            <>
              <h1 className="title">Still loading</h1>
              <p className="subtitle" style={{ marginTop: "0.5rem" }}>
                Authentication didn&apos;t finish loading. This is usually caused by an ad blocker, a blocked third-party
                script, or a transient network issue.
              </p>
              <button
                className="btn btn-primary"
                style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
                <Link href="/sign-in" className="btn btn-secondary" style={{ flex: 1 }}>
                  Sign in
                </Link>
                <Link href="/sign-up" className="btn btn-secondary" style={{ flex: 1 }}>
                  Sign up
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Not authenticated - show welcome page
  if (!isAuthenticated) {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="title">Welcome to EasyBizzy</h1>
          <p className="subtitle">
            The complete solution for managing your business.
          </p>
          
          {/* Free trial highlight */}
          <div style={{
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginTop: "1.5rem",
            marginBottom: "1.5rem",
          }}>
            <p style={{ 
              color: "#065f46", 
              fontWeight: "600",
              marginBottom: "0.25rem"
            }}>
              🎉 Start your 14-day free trial
            </p>
            <p style={{ 
              color: "#047857", 
              fontSize: "0.875rem" 
            }}>
              No credit card required. Full access to all features.
            </p>
          </div>
          
          <div className="btn-group">
            <Link href="/sign-up" className="btn btn-primary">
              Start Free Trial
            </Link>
            <Link href="/sign-in" className="btn btn-secondary">
              Sign In
            </Link>
          </div>
          <div style={{ marginTop: "1.5rem" }}>
            <Link 
              href="/pricing" 
              style={{ 
                fontSize: "0.875rem", 
                color: "var(--primary)",
                textDecoration: "none"
              }}
            >
              View Plans & Pricing →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Creating trial
  if (isCreatingTrial) {
    return (
      <div className="page-center">
        <div style={{ position: "fixed", top: "1rem", right: "1rem", zIndex: 100 }}>
          <UserButton />
        </div>
        <div className="card">
          <div className="spinner" />
          <h1 className="title">Setting up your workspace...</h1>
          <p className="subtitle">
            Creating your 14-day free trial. This will only take a moment.
          </p>
        </div>
      </div>
    );
  }

  // Authenticated but waiting for data
  if (userInfo === undefined || subscriptionStatus === undefined) {
    return (
      <div className="page-center">
        <div style={{ position: "fixed", top: "1rem", right: "1rem", zIndex: 100 }}>
          <UserButton />
        </div>
        <div className="card">
          <div className="spinner" />
          <p className="subtitle">Loading your workspace...</p>
          <div className="debug-info">
            <strong>Debug Log:</strong>
            <pre>{debugLog.join("\n") || "Starting..."}</pre>
          </div>
        </div>
      </div>
    );
  }

  // Default: still routing
  return (
    <div className="page-center">
      <div style={{ position: "fixed", top: "1rem", right: "1rem", zIndex: 100 }}>
        <UserButton />
      </div>
      <div className="card">
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
