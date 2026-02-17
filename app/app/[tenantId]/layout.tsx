"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { TrialBanner } from "../../components/TrialBanner";
import { UserButton } from "../../components/UserButton";
import { getDevImpersonation, isDev } from "../../lib/devImpersonation";

/**
 * TENANT APP LAYOUT
 * =================
 *
 * Mobile-first UI contract (Main App): see `docs/ui-contract.md`.
 * 
 * Wraps all /app/[tenantId]/* pages.
 * 
 * Responsibilities:
 * 1. Validate tenantId
 * 2. Check user has access to this tenant
 * 3. Check subscription status (block if inactive)
 * 4. Provide tenant context to children
 */
export default function TenantAppLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as string;
  
  // Query subscription status for this user
  const subscriptionStatus = useQuery(api.tenants.getMySubscriptionStatus);
  const isSaasAdmin = useQuery(api.users.isMeSaasAdmin);
  // Tenant-scoped info (includes real role + branchId)
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId: tenantId as any });

  const [devImpersonationTick, setDevImpersonationTick] = useState(0);

  // Re-read localStorage when dev impersonation changes
  useEffect(() => {
    if (!isDev()) return;
    const handler = () => setDevImpersonationTick((x) => x + 1);
    window.addEventListener("storage", handler);
    window.addEventListener("easybizzy-dev-impersonation-change", handler as any);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("easybizzy-dev-impersonation-change", handler as any);
    };
  }, []);

  // Derived role/branch for UI routing only (DEV impersonation)
  const tenantFromStatus = subscriptionStatus?.tenant ?? null;
  const realRole = useMemo(() => {
    return (
      (tenantInfo?.currentRole as "OWNER" | "MANAGER" | "WORKER" | undefined) ??
      (tenantFromStatus?.role as any) ??
      undefined
    );
  }, [tenantFromStatus?.role, tenantInfo?.currentRole]);

  const realBranchId = useMemo(() => {
    return (tenantInfo?.currentBranchId as string | null | undefined) ?? null;
  }, [tenantInfo?.currentBranchId]);

  const devImp = useMemo(() => {
    // tick forces recompute in dev
    void devImpersonationTick;
    return getDevImpersonation();
  }, [devImpersonationTick]);

  const effectiveRole = useMemo(() => {
    if (isDev() && realRole === "OWNER" && devImp.enabled && devImp.role) {
      return devImp.role;
    }
    return realRole ?? "OWNER";
  }, [devImp.enabled, devImp.role, realRole]);

  const effectiveBranchId = useMemo(() => {
    if (isDev() && realRole === "OWNER" && devImp.enabled) {
      return devImp.branchId || realBranchId || null;
    }
    return realBranchId;
  }, [devImp.branchId, devImp.enabled, realBranchId, realRole]);

  const impersonationActive = useMemo(() => {
    return isDev() && realRole === "OWNER" && devImp.enabled;
  }, [devImp.enabled, realRole]);

  // Check if user has access and subscription is active
  useEffect(() => {
    if (subscriptionStatus === undefined) return;

    // Not authenticated
    if (!subscriptionStatus.authenticated) {
      console.log("[TenantLayout] Not authenticated, redirecting to /");
      router.push("/");
      return;
    }

    // No tenant or not active
    if (!subscriptionStatus.hasActiveTenant) {
      console.log("[TenantLayout] No active tenant, redirecting to /pricing");
      router.push("/pricing");
      return;
    }

    // Verify user belongs to THIS tenant
    if (subscriptionStatus.tenant?.tenantId !== tenantId) {
      console.log("[TenantLayout] User doesn't belong to this tenant, redirecting to /");
      router.push("/");
      return;
    }
  }, [subscriptionStatus, tenantId, router]);

  // Loading
  if (subscriptionStatus === undefined) {
    return (
      <div className="page-center">
        <div className="card">
          <div className="spinner" />
          <p className="subtitle">Loading workspace...</p>
        </div>
      </div>
    );
  }

  // Access denied states are handled by the useEffect redirect
  // If we get here, user has access
  if (!subscriptionStatus.authenticated || !subscriptionStatus.hasActiveTenant) {
    return (
      <div className="page-center">
        <div className="card">
          <div className="spinner" />
          <p className="subtitle">Redirecting...</p>
        </div>
      </div>
    );
  }

  const { tenant } = subscriptionStatus;

  return (
    <div>
      {/* Trial Banner - shows days remaining for trial users */}
      <TrialBanner />
      
      {/* Simple navigation header */}
      <nav className="nav-placeholder" style={{ 
        display: "flex", 
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <div>
          <strong>{tenant?.name || "Workspace"}</strong>
          <span style={{ 
            marginLeft: "0.5rem",
            fontSize: "0.75rem",
            color: "var(--muted)"
          }}>
            ({effectiveRole})
          </span>
          {impersonationActive && (
            <span
              style={{
                marginLeft: "0.5rem",
                fontSize: "0.625rem",
                background: "#fee2e2",
                color: "#991b1b",
                padding: "0.125rem 0.375rem",
                borderRadius: "0.25rem",
              }}
              title={`DEV impersonation active${effectiveBranchId ? ` • Branch: ${effectiveBranchId}` : ""}`}
            >
              DEV: {effectiveRole}
            </span>
          )}
          {tenant?.isTrialing && (
            <span style={{ 
              marginLeft: "0.5rem",
              fontSize: "0.625rem",
              background: "#ecfdf5",
              color: "#065f46",
              padding: "0.125rem 0.375rem",
              borderRadius: "0.25rem",
            }}>
              TRIAL
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "1rem", fontSize: "0.875rem", alignItems: "center" }}>
          {(effectiveRole === "OWNER" || effectiveRole === "MANAGER") && (
            <Link 
              href={`/app/${tenantId}/manager/home`}
              style={{ color: "var(--primary)", textDecoration: "none" }}
            >
              Dashboard
            </Link>
          )}
          {effectiveRole === "WORKER" && (
            <Link 
              href={`/app/${tenantId}/worker/home`}
              style={{ color: "var(--primary)", textDecoration: "none" }}
            >
              Dashboard
            </Link>
          )}
          {isSaasAdmin && (
            <Link
              href="/admin"
              style={{ color: "var(--muted)", textDecoration: "none" }}
            >
              Switch to Admin
            </Link>
          )}
          <UserButton tenantId={tenantId} realRole={realRole ?? "OWNER"} />
        </div>
      </nav>
      
      {/* Page content */}
      {children}
    </div>
  );
}
