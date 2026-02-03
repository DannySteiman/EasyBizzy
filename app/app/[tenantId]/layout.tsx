"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { ReactNode, useEffect } from "react";
import { TrialBanner } from "../../components/TrialBanner";
import { UserButton } from "../../components/UserButton";

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
            ({tenant?.role})
          </span>
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
          {(tenant?.role === "OWNER" || tenant?.role === "MANAGER") && (
            <Link 
              href={`/app/${tenantId}/manager/home`}
              style={{ color: "var(--primary)", textDecoration: "none" }}
            >
              Dashboard
            </Link>
          )}
          {tenant?.role === "WORKER" && (
            <Link 
              href={`/app/${tenantId}/worker/home`}
              style={{ color: "var(--primary)", textDecoration: "none" }}
            >
              Dashboard
            </Link>
          )}
          <Link 
            href="/"
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            Switch
          </Link>
          <UserButton />
        </div>
      </nav>
      
      {/* Page content */}
      {children}
    </div>
  );
}
