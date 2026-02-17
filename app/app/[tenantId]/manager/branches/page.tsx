"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

type Role = "OWNER" | "MANAGER" | "WORKER";

const MAX_LOCATIONS_BY_PLAN: Record<string, number> = {
  BASIC: 1,
  PRO: 3,
  BUSINESS: Infinity,
  ENTERPRISE: Infinity, // legacy alias
};

function normalizePlanTierForLocations(planTier: string, subscriptionStatus: string): "BASIC" | "PRO" | "BUSINESS" {
  if (subscriptionStatus === "trialing") return "BASIC";
  if (planTier === "PRO") return "PRO";
  if (planTier === "BUSINESS" || planTier === "ENTERPRISE") return "BUSINESS";
  return "BASIC";
}

export default function ManagerBranchesPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as Id<"tenants">;

  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.list, { tenantId });
  const createBranch = useMutation(api.branches.create);
  const renameBranch = useMutation(api.branches.rename);
  const archiveBranch = useMutation(api.branches.archive);
  const deleteBranch = useMutation(api.branches.deleteBranch);

  const devImp = getDevImpersonation();
  const realRole = (tenantInfo?.currentRole as Role | undefined) ?? undefined;
  const effectiveRole: Role | undefined =
    isDev() && realRole === "OWNER" && devImp.enabled && devImp.role ? (devImp.role as Role) : realRole;

  const rawPlanTier = tenantInfo?.tenant?.planTier ?? "BASIC";
  const subscriptionStatus = tenantInfo?.tenant?.subscriptionStatus ?? "inactive";
  const effectivePlanTier = normalizePlanTierForLocations(rawPlanTier, subscriptionStatus);

  const isOwner = effectiveRole === "OWNER";
  const isManager = effectiveRole === "MANAGER";

  const branchCount = Array.isArray(branches) ? branches.length : 0;
  const maxAllowed = MAX_LOCATIONS_BY_PLAN[effectivePlanTier] ?? 1;
  const planAtLimit = branchCount >= maxAllowed && effectivePlanTier !== "BUSINESS";

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<
    | null
    | { type: "add" }
    | { type: "rename"; branchId: Id<"branches">; currentName: string }
    | { type: "archive_confirm"; branchId: Id<"branches">; name: string }
    | { type: "delete_confirm"; branchId: Id<"branches">; name: string }
  >(null);

  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    // Extra safety (ManagerShell already redirects, but keep page fail-closed).
    if (!effectiveRole) return;
    if (effectiveRole === "WORKER") {
      router.replace(`/app/${tenantId}/worker/home`);
    }
  }, [effectiveRole, router, tenantId]);

  const sortedBranches = useMemo(() => {
    if (!Array.isArray(branches)) return [];
    const copy = [...branches];
    copy.sort((a, b) => {
      if (a.isMainBranch && !b.isMainBranch) return -1;
      if (!a.isMainBranch && b.isMainBranch) return 1;
      return a.name.localeCompare(b.name);
    });
    return copy;
  }, [branches]);

  if (tenantInfo === undefined || branches === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading locations...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Locations</h1>
        <p className="dashboard-subtitle">Manage business locations</p>
      </header>

      {error && (
        <section className="metric-card" style={{ marginBottom: "0.75rem", borderColor: "rgba(220, 38, 38, 0.35)" }}>
          <div style={{ fontSize: "0.9375rem", fontWeight: 800, marginBottom: "0.25rem", color: "#b91c1c" }}>
            Action failed
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{error}</div>
          <button
            className="btn btn-secondary"
            style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </section>
      )}

      {/* Locations list */}
      <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.75rem" }}>Locations</div>

        {sortedBranches.length === 0 ? (
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>No locations found.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {sortedBranches.map((b) => (
              <div
                key={String(b._id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  minHeight: 56,
                  padding: "0.75rem 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "0.9375rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {b.name}
                    </div>
                    {b.isMainBranch && <span className="badge badge-success">Main</span>}
                  </div>
                </div>

                {isOwner ? (
                  <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ minHeight: 44 }}
                      onClick={() => {
                        setError(null);
                        setNameInput(b.name);
                        setSheet({ type: "rename", branchId: b._id as Id<"branches">, currentName: b.name });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ minHeight: 44 }}
                      onClick={() => {
                        setError(null);
                        setSheet({ type: "archive_confirm", branchId: b._id as Id<"branches">, name: b.name });
                      }}
                    >
                      Archive
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{
                        minHeight: 44,
                        borderColor: "#fecaca",
                        color: "#b91c1c",
                        background: "#fef2f2",
                      }}
                      onClick={() => {
                        setError(null);
                        setSheet({ type: "delete_confirm", branchId: b._id as Id<"branches">, name: b.name });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{isManager ? "" : ""}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Primary action / plan gate (OWNER only) */}
      {isOwner && (
        <>
          {planAtLimit ? (
            <section className="metric-card" style={{ marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "0.9375rem", fontWeight: 800, marginBottom: "0.25rem" }}>Location limit reached</div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                Your plan supports up to {Number.isFinite(maxAllowed) ? maxAllowed : "unlimited"} locations.
              </div>
              <Link
                href="/pricing"
                className="btn btn-primary"
                style={{
                  width: "100%",
                  minHeight: 44,
                  marginTop: "0.75rem",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                }}
              >
                View plans
              </Link>
            </section>
          ) : (
            <button
              className="btn btn-primary"
              style={{ width: "100%", minHeight: 44, marginBottom: "1.5rem" }}
              onClick={() => {
                setError(null);
                setNameInput("");
                setSheet({ type: "add" });
              }}
            >
              Add location
            </button>
          )}
        </>
      )}

      {sheet && (
        <BottomSheet
          title={
            sheet.type === "add"
              ? "Add location"
              : sheet.type === "rename"
                ? "Rename location"
                : sheet.type === "archive_confirm"
                  ? "Archive location"
                  : "Delete location"
          }
          onClose={() => {
            if (busy) return;
            setSheet(null);
          }}
        >
          {sheet.type === "add" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError(null);
                try {
                  await createBranch({ tenantId, name: nameInput });
                  setSheet(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to add location.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.25rem" }}>
                Location name
              </label>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Downtown"
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: "0 0.75rem",
                  fontSize: "1rem",
                }}
                maxLength={60}
                disabled={busy}
                autoFocus
              />

              <button className="btn btn-primary" style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }} disabled={busy}>
                {busy ? "Adding..." : "Add location"}
              </button>
            </form>
          )}

          {sheet.type === "rename" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError(null);
                try {
                  await renameBranch({ tenantId, branchId: sheet.branchId, name: nameInput });
                  setSheet(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to rename location.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.25rem" }}>
                Location name
              </label>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: "0 0.75rem",
                  fontSize: "1rem",
                }}
                maxLength={60}
                disabled={busy}
                autoFocus
              />

              <button className="btn btn-primary" style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }} disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </button>
            </form>
          )}

          {sheet.type === "archive_confirm" && (
            <div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                Archive <strong>{sheet.name}</strong>? This will hide it from the app.
              </div>
              <button
                className="btn btn-primary"
                style={{
                  width: "100%",
                  minHeight: 44,
                  marginTop: "0.75rem",
                  background: "#dc2626",
                  borderColor: "#dc2626",
                }}
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError(null);
                  try {
                    await archiveBranch({ tenantId, branchId: sheet.branchId });
                    setSheet(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to archive location.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Archiving..." : "Archive"}
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: "100%", minHeight: 44, marginTop: "0.5rem" }}
                disabled={busy}
                onClick={() => setSheet(null)}
              >
                Cancel
              </button>
            </div>
          )}

          {sheet.type === "delete_confirm" && (
            <div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                Delete <strong>{sheet.name}</strong>? This permanently removes this location.
              </div>
              <button
                className="btn btn-primary"
                style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError(null);
                  try {
                    await deleteBranch({ tenantId, branchId: sheet.branchId });
                    setSheet(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to delete location.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Deleting..." : "Delete"}
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: "100%", minHeight: 44, marginTop: "0.5rem" }}
                disabled={busy}
                onClick={() => setSheet(null)}
              >
                Cancel
              </button>
            </div>
          )}
        </BottomSheet>
      )}
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
            Close
          </button>
        </div>
        <div style={{ marginTop: "0.75rem" }}>{children}</div>
      </div>
    </div>
  );
}

