"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import {
  clearDevImpersonation,
  getDevImpersonation,
  isDev,
  setDevImpersonation,
  type DevImpersonationRole,
} from "../lib/devImpersonation";

/**
 * User Button Component
 * Compact avatar button with dropdown menu for sign out and navigation
 */
export function UserButton(props?: { tenantId?: string; realRole?: "OWNER" | "MANAGER" | "WORKER" }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDevSheetOpen, setIsDevSheetOpen] = useState(false);
  const [devRole, setDevRole] = useState<DevImpersonationRole>("WORKER");
  const [devBranchId, setDevBranchId] = useState<string>("");

  const tenantId = props?.tenantId;
  const realRole = props?.realRole;

  const branches = useQuery(
    api.branches.getBranches,
    tenantId ? ({ tenantId: tenantId as Id<"tenants"> } as any) : "skip"
  );

  const devImp = useMemo(() => getDevImpersonation(), [isDevSheetOpen, isOpen]);
  const canShowDevControl = isDev() && realRole === "OWNER" && !!tenantId;
  const devStateLabel = useMemo(() => {
    if (!canShowDevControl) return null;
    if (!devImp.enabled || !devImp.role) return "Dev: View as";
    const branchName =
      devImp.branchId &&
      Array.isArray(branches) &&
      branches.find((b) => String(b._id) === String(devImp.branchId))?.name;
    return `Dev: ${devImp.role}${branchName ? ` (${branchName})` : ""}`;
  }, [branches, canShowDevControl, devImp.enabled, devImp.branchId, devImp.role]);

  useEffect(() => {
    if (isDevSheetOpen && devRole === "WORKER" && !devBranchId && Array.isArray(branches) && branches.length > 0) {
      const main = branches.find((b) => b.isMainBranch) ?? branches[0];
      setDevBranchId(String(main._id));
    }
  }, [isDevSheetOpen, devRole, devBranchId, branches]);

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn) {
    return null;
  }

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      // Clear UI-only dev overrides and one-session sync flags to avoid cross-user bleed.
      try {
        clearDevImpersonation();
        window.sessionStorage.removeItem("easybizzy_access_sync_done");
      } catch {
        // ignore
      }

      // IMPORTANT:
      // Use Clerk's redirect-based signOut. This avoids router race conditions where
      // Clerk can get stuck "not loaded" and the app shows an infinite Loading screen.
      await signOut({ redirectUrl: "/" });

      // Fallback: if Clerk doesn't redirect for any reason, force a hard navigation.
      window.location.href = "/";
    } catch (error) {
      console.error("Sign out error:", error);
      setIsSigningOut(false);
    }
  };

  const handleGoHome = () => {
    router.push("/");
  };

  const openDevSheet = () => {
    const current = getDevImpersonation();
    setDevRole(current.role ?? "WORKER");
    setDevBranchId(current.branchId ?? "");
    setIsDevSheetOpen(true);
    setIsOpen(false);
  };

  const applyDevSheet = () => {
    // When impersonating as WORKER, auto-select main branch if none chosen (required for availability/schedule)
    let branchToUse = devBranchId;
    if (devRole === "WORKER" && !branchToUse && Array.isArray(branches) && branches.length > 0) {
      const main = branches.find((b) => b.isMainBranch) ?? branches[0];
      branchToUse = String(main._id);
    }
    setDevImpersonation({
      enabled: true,
      role: devRole,
      branchId: branchToUse,
    });
    setIsDevSheetOpen(false);
    try {
      window.dispatchEvent(new Event("easybizzy-dev-impersonation-change"));
    } catch {
      // ignore
    }

    // Auto-navigate to role home (UI-only impersonation)
    if (tenantId) {
      if (devRole === "WORKER") {
        router.push(`/app/${tenantId}/worker/home`);
      } else {
        router.push(`/app/${tenantId}/manager/home`);
      }
    }

    router.refresh();
  };

  const clearDevSheet = () => {
    clearDevImpersonation();
    setIsDevSheetOpen(false);
    try {
      window.dispatchEvent(new Event("easybizzy-dev-impersonation-change"));
    } catch {
      // ignore
    }

    // After clearing, return to manager/owner home.
    if (tenantId) {
      router.push(`/app/${tenantId}/manager/home`);
    }

    router.refresh();
  };

  const initial = user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "U";

  return (
    <div style={{ position: "relative" }}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "2.5rem",
          height: "2.5rem",
          borderRadius: "50%",
          background: "#3b82f6",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: "600",
          fontSize: "1rem",
          border: "2px solid transparent",
          cursor: "pointer",
          transition: "border-color 0.15s"
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = "#93c5fd"}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = "transparent"}
      >
        {initial}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop to close menu */}
          <div 
            onClick={() => setIsOpen(false)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99
            }}
          />
          
          {/* Menu */}
          <div style={{
            position: "absolute",
            top: "calc(100% + 0.5rem)",
            right: 0,
            background: "white",
            borderRadius: "0.5rem",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            minWidth: "200px",
            zIndex: 100,
            overflow: "hidden"
          }}>
            {/* User Info */}
            <div style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid #e5e7eb",
              fontSize: "0.875rem"
            }}>
              <div style={{ fontWeight: "500" }}>
                {user?.firstName || "User"}
              </div>
              <div style={{ color: "#6b7280", fontSize: "0.75rem" }}>
                {user?.emailAddresses?.[0]?.emailAddress}
              </div>
            </div>

            {/* Menu Items */}
            <div style={{ padding: "0.25rem 0" }}>
              <button
                onClick={handleGoHome}
                style={{
                  width: "100%",
                  padding: "0.5rem 1rem",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  color: "#374151"
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                Go to Home
              </button>

              {canShowDevControl && (
                <button
                  onClick={openDevSheet}
                  style={{
                    width: "100%",
                    padding: "0.5rem 1rem",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    color: "#111827",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  title="DEV-only. UI routing/rendering only."
                >
                  {devStateLabel}
                </button>
              )}
              
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                style={{
                  width: "100%",
                  padding: "0.5rem 1rem",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: isSigningOut ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  color: "#dc2626",
                  opacity: isSigningOut ? 0.7 : 1
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                {isSigningOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* DEV Sheet: View as... */}
      {canShowDevControl && isDevSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            zIndex: 1000,
          }}
          onClick={() => setIsDevSheetOpen(false)}
        >
          <div
            style={{
              background: "white",
              borderTopLeftRadius: "1rem",
              borderTopRightRadius: "1rem",
              padding: "1rem",
              maxWidth: 480,
              width: "100%",
              margin: "0 auto",
              border: "1px solid #e5e7eb",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "1rem", fontWeight: 600 }}>Dev: View as</div>
                <div style={{ fontSize: "0.8125rem", color: "#6b7280", marginTop: "0.25rem" }}>
                  UI-only. Server guards still enforce real permissions.
                </div>
              </div>
              <button
                onClick={() => setIsDevSheetOpen(false)}
                style={{
                  minHeight: 44,
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #e5e7eb",
                  background: "#f3f4f6",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Role</span>
                <select
                  value={devRole}
                  onChange={(e) => setDevRole(e.target.value as DevImpersonationRole)}
                  style={{
                    minHeight: 44,
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "0 0.75rem",
                    fontSize: "0.875rem",
                    background: "white",
                  }}
                >
                  <option value="OWNER">OWNER</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="WORKER">WORKER</option>
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                  Location (optional)
                </span>
                <select
                  value={devBranchId}
                  onChange={(e) => setDevBranchId(e.target.value)}
                  style={{
                    minHeight: 44,
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "0 0.75rem",
                    fontSize: "0.875rem",
                    background: "white",
                  }}
                >
                  <option value="">None</option>
                  {Array.isArray(branches) &&
                    branches.map((b) => (
                      <option key={String(b._id)} value={String(b._id)}>
                        {b.name}
                      </option>
                    ))}
                </select>
                {Array.isArray(branches) && branches.length > 1 && devBranchId === "" && (
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    Tip: for multi-location testing, choose a location.
                  </span>
                )}
              </label>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                <button
                  onClick={applyDevSheet}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: "0.5rem",
                    border: "none",
                    background: "#2563eb",
                    color: "white",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Apply
                </button>
                <button
                  onClick={clearDevSheet}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: "0.5rem",
                    border: "1px solid #e5e7eb",
                    background: "#f3f4f6",
                    color: "#111827",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
