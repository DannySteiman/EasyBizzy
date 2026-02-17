"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

/**
 * OWNER DASHBOARD (Mobile-First MVP)
 * ===================================
 * 
 * Primary landing page for OWNER and MANAGER roles after:
 * - Trial creation
 * - Successful paid subscription
 * - Successful onboarding
 * 
 * Mobile-first design following the UI Contract:
 * - 360px minimum width
 * - 44px minimum tap targets
 * - Cards and vertical lists only
 * - No tables, no hover interactions
 * 
 * @see docs/ui-contract.md
 */
export default function OwnerDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as Id<"tenants">;
  
  // Fetch tenant and subscription data
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.getBranches, { tenantId });
  const members = useQuery(api.tenants.getTenantMembers, { tenantId });
  const teamData = useQuery(api.team.listTeamAccess, { tenantId });

  const devImp = getDevImpersonation();
  const realRole = (tenantInfo?.currentRole as "OWNER" | "MANAGER" | "WORKER" | undefined) ?? undefined;
  const realBranchId = (tenantInfo?.currentBranchId as string | null | undefined) ?? null;
  const effectiveRole =
    isDev() && realRole === "OWNER" && devImp.enabled && devImp.role ? (devImp.role as typeof realRole) : realRole;
  const effectiveBranchId =
    isDev() && realRole === "OWNER" && devImp.enabled ? devImp.branchId || realBranchId || null : realBranchId;

  const [sheet, setSheet] = useState<
    | null
    | { type: "location_picker" }
    | { type: "coming_soon"; feature: string }
    | { type: "learn_more_other_locations" }
    | { type: "learn_more_notes" }
  >(null);

  // Location selector (UI-only)
  const storageKey = "easybizzy.manager.selectedBranchId";
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  const mainBranchId = useMemo(() => {
    if (!Array.isArray(branches)) return null;
    return branches.find((b) => b.isMainBranch)?._id ?? null;
  }, [branches]);

  const branchesById = useMemo(() => {
    const m = new Map<string, { name: string; isMainBranch: boolean }>();
    if (Array.isArray(branches)) {
      for (const b of branches) {
        m.set(String(b._id), { name: b.name, isMainBranch: b.isMainBranch });
      }
    }
    return m;
  }, [branches]);

  const selectedLocationId = useMemo(() => {
    // Compute a stable default
    const fallback = effectiveBranchId || mainBranchId || null;
    if (!selectedBranchId) return fallback;
    // Ensure still exists
    if (branchesById.has(String(selectedBranchId))) return selectedBranchId;
    return fallback;
  }, [branchesById, effectiveBranchId, mainBranchId, selectedBranchId]);

  const selectedLocationName = useMemo(() => {
    if (!selectedLocationId) return null;
    return branchesById.get(String(selectedLocationId))?.name ?? null;
  }, [branchesById, selectedLocationId]);

  // Load persisted selection once branches are available
  useEffect(() => {
    if (!Array.isArray(branches)) return;
    if (selectedBranchId !== null) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw && branchesById.has(raw)) {
        setSelectedBranchId(raw);
      } else {
        setSelectedBranchId(""); // sentinel: loaded
      }
    } catch {
      setSelectedBranchId(""); // sentinel: loaded
    }
  }, [branches, branchesById, selectedBranchId]);

  // Loading state
  if (tenantInfo === undefined || teamData === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const tenant = tenantInfo?.tenant;
  const branchCount = branches?.length ?? 0;
  const memberCount = members?.length ?? 0;
  const accessEmailCount = teamData?.accessEmails?.length ?? 0;
  const teamConfigured = memberCount > 1 || accessEmailCount > 0;
  
  // Determine subscription display
  const planTier = tenant?.planTier ?? "BASIC";
  const subscriptionStatus = tenant?.subscriptionStatus ?? "inactive";
  const isTrialing = subscriptionStatus === "trialing";
  const isActive = subscriptionStatus === "active" || isTrialing;

  // Format subscription status for display
  const getStatusLabel = () => {
    switch (subscriptionStatus) {
      case "active": return "Active";
      case "trialing": return "Trial";
      case "past_due": return "Past Due";
      case "canceled": return "Canceled";
      default: return "Inactive";
    }
  };

  const getStatusBadgeClass = () => {
    switch (subscriptionStatus) {
      case "active": return "badge-success";
      case "trialing": return "badge-warning";
      case "past_due": return "badge-error";
      default: return "badge-warning";
    }
  };

  return (
    <div>
      {/* ========== HEADER ========== */}
      <header className="dashboard-header">
        <h1 className="dashboard-title">{tenant?.name ?? "My Workspace"}</h1>
        <p className="dashboard-subtitle">Overview</p>
      </header>

      {/* ========== LOCATION SELECTOR (multi-branch only) ========== */}
      {branchCount > 1 && (
        <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div>
              <div className="metric-label">Location</div>
              <div style={{ fontSize: "1rem", fontWeight: 700, marginTop: "0.25rem" }}>
                {selectedLocationName ?? "Select a location"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                Selection is UI-only for now.
              </div>
            </div>
            <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setSheet({ type: "location_picker" })}>
              Change
            </button>
          </div>
        </section>
      )}

      {/* ========== GETTING STARTED (Onboarding warnings) ========== */}
      <section className="metric-card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.75rem" }}>Getting started</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <ChecklistRow
            label="Team members"
            status={teamConfigured ? "done" : "todo"}
            hint={teamConfigured ? "Team configured" : "Add your first team member"}
          />
          <ChecklistRow label="Receipts" status="soon" hint="Coming soon" />
          <ChecklistRow label="Products" status="soon" hint="Coming soon" />
          <ChecklistRow label="Tip rules" status="soon" hint="Coming soon" />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
          onClick={() => router.push(`/app/${tenantId}/manager/team`)}
        >
          {teamConfigured ? "Manage team" : "Add team member"}
        </button>
      </section>

      {/* ========== METRIC CARDS ========== */}
      <section className="dashboard-metrics">
        {/* Locations */}
        <div className="metric-card">
          <span className="metric-label">Locations</span>
          <span className="metric-value">{branchCount}</span>
          {branchCount === 0 && (
            <span className="metric-hint">No branches yet</span>
          )}
        </div>

        {/* Team Members */}
        <div className="metric-card">
          <span className="metric-label">Team members</span>
          <span className="metric-value">{memberCount}</span>
          {memberCount <= 1 && (
            <span className="metric-hint">Just you for now</span>
          )}
        </div>

        {/* Active Plan */}
        <div className="metric-card">
          <span className="metric-label">Active plan</span>
          <span className="metric-value">{planTier}</span>
        </div>

        {/* Subscription Status */}
        <div className="metric-card">
          <span className="metric-label">Subscription</span>
          <span className={`badge ${getStatusBadgeClass()}`}>
            {getStatusLabel()}
          </span>
        </div>
      </section>

      {/* ========== MULTI-BRANCH PLACEHOLDERS (Excel sections) ========== */}
      {branchCount > 1 && effectiveRole === "OWNER" && (
        <>
          {/* Other locations report */}
          <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <div>
                <div style={{ fontSize: "1rem", fontWeight: 800 }}>Other locations</div>
                <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 4 }}>
                  Orders reporting is coming soon.
                </div>
              </div>
              <button
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                onClick={() => setSheet({ type: "learn_more_other_locations" })}
              >
                Learn more
              </button>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
              <span className="badge badge-warning">Locations reporting today: —</span>
              <span className="badge badge-warning">Needs attention: —</span>
            </div>

            <div
              style={{
                marginTop: "0.75rem",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "0.75rem",
                color: "var(--muted)",
                fontSize: "0.875rem",
              }}
            >
              Orders reporting is coming soon.
            </div>
          </section>

          {/* Manager notes placeholder */}
          <section className="metric-card" style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <div>
                <div style={{ fontSize: "1rem", fontWeight: 800 }}>Manager notes</div>
                <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 4 }}>
                  Notes will appear here when orders reporting is enabled.
                </div>
              </div>
            </div>

            <button
              className="btn btn-secondary"
              style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
              onClick={() => setSheet({ type: "learn_more_notes" })}
            >
              Coming soon
            </button>
          </section>
        </>
      )}

      {/* ========== QUICK ACTIONS ========== */}
      <section className="dashboard-actions">
        <h2 className="section-title">Quick actions</h2>
        
        <nav className="action-list">
          {/* Manage Team */}
          <Link 
            href={`/app/${tenantId}/manager/team`} 
            className="action-item"
          >
            <span className="action-icon">👥</span>
            <span className="action-content">
              <span className="action-label">Manage team</span>
              <span className="action-description">
                {memberCount <= 1 
                  ? "Add your first team member" 
                  : `${memberCount} member${memberCount !== 1 ? "s" : ""}`
                }
              </span>
            </span>
            <span className="action-chevron">›</span>
          </Link>

          {/* Manage Locations */}
          <Link href={`/app/${tenantId}/manager/branches`} className="action-item">
            <span className="action-icon">📍</span>
            <span className="action-content">
              <span className="action-label">Manage locations</span>
              <span className="action-description">
                {branchCount === 1 ? "1 location" : `${branchCount} locations`}
              </span>
            </span>
            <span className="action-chevron">›</span>
          </Link>

          {/* Shift Templates */}
          <Link href={`/app/${tenantId}/manager/shift-templates`} className="action-item">
            <span className="action-icon">🗓️</span>
            <span className="action-content">
              <span className="action-label">Shift templates</span>
              <span className="action-description">Define weekly shift slots</span>
            </span>
            <span className="action-chevron">›</span>
          </Link>

          {/* View Receipts */}
          <button
            type="button"
            className="action-item"
            style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
            onClick={() => setSheet({ type: "coming_soon", feature: "Receipts" })}
          >
            <span className="action-icon">🧾</span>
            <span className="action-content">
              <span className="action-label">View receipts</span>
              <span className="action-description">Coming soon</span>
            </span>
            <span className="action-chevron">›</span>
          </button>

          {/* Settings */}
          <Link href={`/app/${tenantId}/manager/settings`} className="action-item">
            <span className="action-icon">⚙️</span>
            <span className="action-content">
              <span className="action-label">Settings</span>
              <span className="action-description">Account & preferences</span>
            </span>
            <span className="action-chevron">›</span>
          </Link>
        </nav>
      </section>

      {/* ========== SUBSCRIPTION ALERT (if needed) ========== */}
      {!isActive && (
        <section className="dashboard-alert">
          <p className="alert-text">
            Your subscription is {subscriptionStatus}. Some features may be limited.
          </p>
          <Link href="/pricing" className="btn btn-primary alert-cta">
            View plans
          </Link>
        </section>
      )}

      {sheet && (
        <BottomSheet
          title={
            sheet.type === "coming_soon"
              ? "Coming soon"
              : sheet.type === "location_picker"
                ? "Choose a location"
                : "Info"
          }
          onClose={() => setSheet(null)}
        >
          {sheet.type === "coming_soon" && (
            <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
              <strong>{sheet.feature}</strong> is not available yet.
            </div>
          )}

          {sheet.type === "learn_more_other_locations" && (
            <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
              This section will show reporting status across locations (orders, trends, and attention needed).
            </div>
          )}

          {sheet.type === "learn_more_notes" && (
            <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
              Manager notes will appear here when orders reporting is enabled.
            </div>
          )}

          {sheet.type === "location_picker" && (
            <div className="action-list" style={{ gap: "0.5rem" }}>
              {(branches ?? []).map((b) => {
                const active = String(selectedLocationId) === String(b._id);
                return (
                  <button
                    key={String(b._id)}
                    type="button"
                    className="action-item"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                      background: active ? "var(--secondary)" : "white",
                    }}
                    onClick={() => {
                      try {
                        window.localStorage.setItem(storageKey, String(b._id));
                      } catch {
                        // ignore
                      }
                      setSelectedBranchId(String(b._id));
                      setSheet(null);
                    }}
                  >
                    <span className="action-icon">📍</span>
                    <span className="action-content">
                      <span className="action-label">
                        {b.name} {b.isMainBranch ? "(Main)" : ""}
                      </span>
                      <span className="action-description">{active ? "Selected" : "Tap to select"}</span>
                    </span>
                    <span className="action-chevron">{active ? "✓" : "›"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </BottomSheet>
      )}
    </div>
  );
}

function ChecklistRow({
  label,
  status,
  hint,
}: {
  label: string;
  status: "done" | "todo" | "soon";
  hint: string;
}) {
  const icon = status === "done" ? "✅" : status === "todo" ? "⬜" : "⏳";
  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        alignItems: "center",
        minHeight: 44,
        padding: "0.5rem 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: "1.25rem", lineHeight: 1 }} aria-hidden>
        {icon}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>{hint}</div>
      </div>
      {status === "soon" && <span className="badge badge-warning">Coming soon</span>}
    </div>
  );
}

function BottomSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
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
      onClick={onClose}
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
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>{title}</div>
          <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={onClose}>
            OK
          </button>
        </div>
        <div style={{ marginTop: "0.75rem" }}>{children}</div>
      </div>
    </div>
  );
}
