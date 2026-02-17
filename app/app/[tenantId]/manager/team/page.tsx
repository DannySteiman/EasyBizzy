"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

type Role = "OWNER" | "MANAGER" | "WORKER";
type AccessRole = "MANAGER" | "WORKER";

type SheetState =
  | { kind: "none" }
  | { kind: "add_access" }
  | { kind: "edit_access"; accessId: Id<"tenantAccessEmails"> }
  | { kind: "change_member_branch"; membershipId: Id<"userTenants"> };

export default function TeamPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;

  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const teamData = useQuery(api.team.listTeamAccess, { tenantId });

  const addAccessEmail = useMutation(api.team.addAccessEmail);
  const updateAccessEmail = useMutation(api.team.updateAccessEmail);
  const removeAccessEmail = useMutation(api.team.removeAccessEmail);
  const removeMember = useMutation(api.team.removeMember);
  const updateMemberBranch = useMutation(api.team.updateMemberBranch);

  const [sheet, setSheet] = useState<SheetState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const realRole = (tenantInfo?.currentRole as Role | undefined) ?? undefined;
  const devImp = getDevImpersonation();
  const effectiveRole: Role | undefined =
    isDev() && realRole === "OWNER" && devImp.enabled && devImp.role
      ? (devImp.role as Role)
      : realRole;
  const isOwner = effectiveRole === "OWNER";
  const isImpersonating = isDev() && realRole === "OWNER" && devImp.enabled;

  const branches = teamData?.branches ?? [];
  const members = teamData?.members ?? [];
  const accessEmails = teamData?.accessEmails ?? [];

  const branchById = useMemo(() => {
    const m = new Map<string, { name: string; isMainBranch: boolean }>();
    for (const b of branches) {
      m.set(String(b._id), { name: b.name, isMainBranch: b.isMainBranch });
    }
    return m;
  }, [branches]);

  const mainBranchId = useMemo(() => {
    const main = branches.find((b) => b.isMainBranch);
    return main?._id ?? null;
  }, [branches]);

  const formatBranchLabel = (role: Role, branchId: string | null) => {
    if (role === "OWNER") return "All locations";
    if (!branchId) return "All locations";
    const b = branchById.get(String(branchId));
    return b?.name ?? "Assigned location";
  };

  // Loading
  if (tenantInfo === undefined || teamData === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading team...</p>
        </div>
      </div>
    );
  }

  const openAddAccess = () => {
    setActionError(null);
    setSheet({ kind: "add_access" });
  };

  const openEditAccess = (accessId: Id<"tenantAccessEmails">) => {
    setActionError(null);
    setSheet({ kind: "edit_access", accessId });
  };

  const openChangeMemberBranch = (membershipId: Id<"userTenants">) => {
    setActionError(null);
    setSheet({ kind: "change_member_branch", membershipId });
  };

  const closeSheet = () => setSheet({ kind: "none" });

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <h1 className="dashboard-title">Team</h1>
        <p className="dashboard-subtitle">Manage staff access</p>
      </header>

      {/* Members */}
      <section style={{ marginBottom: "1.25rem" }}>
        <h2 className="section-title">Members</h2>
        <div className="action-list">
          {members.length === 0 ? (
            <div className="action-item" style={{ justifyContent: "center", color: "var(--muted)" }}>
              No members yet.
            </div>
          ) : (
            members.map((m) => {
              const role = m.role as Role;
              const branchId = (m.branchId as string | null) ?? null;
              const canEditMember = isOwner && role !== "OWNER";

              return (
                <div
                  key={String(m.membershipId)}
                  className="action-item"
                  style={{ flexDirection: "column", alignItems: "stretch", gap: "0.75rem" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span className="action-icon">👤</span>
                    <span className="action-content">
                      <span className="action-label" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{m.userId}</span>
                        <span
                          className={`badge ${
                            role === "OWNER" ? "badge-success" : role === "MANAGER" ? "badge-warning" : "badge-warning"
                          }`}
                        >
                          {role}
                        </span>
                      </span>
                      <span className="action-description">
                        Location: {formatBranchLabel(role, branchId)}
                      </span>
                    </span>
                  </div>

                  {canEditMember && (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        className="btn btn-secondary"
                        style={{ flex: 1, minHeight: 44 }}
                        onClick={() => openChangeMemberBranch(m.membershipId)}
                      >
                        Change branch
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ flex: 1, minHeight: 44, color: "var(--error)" }}
                        onClick={async () => {
                          setIsSaving(true);
                          setActionError(null);
                          try {
                            await removeMember({ tenantId, membershipId: m.membershipId });
                          } catch (e) {
                            setActionError(e instanceof Error ? e.message : "Failed to remove member");
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                        disabled={isSaving}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Access Emails */}
      <section style={{ marginBottom: "1.25rem" }}>
        <h2 className="section-title">Access emails</h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
          Anyone who logs in with this email will automatically get access.
        </p>

        <div className="action-list">
          {accessEmails.length === 0 ? (
            <div className="action-item" style={{ justifyContent: "center", color: "var(--muted)" }}>
              No access emails configured.
            </div>
          ) : (
            accessEmails.map((a) => {
              const role = a.role as AccessRole;
              const branchId = (a.branchId as string | null) ?? null;
              const branchName =
                branchId && branchById.get(String(branchId)) ? branchById.get(String(branchId))!.name : "—";

              return (
                <div
                  key={String(a.accessId)}
                  className="action-item"
                  style={{ flexDirection: "column", alignItems: "stretch", gap: "0.75rem" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span className="action-icon">📧</span>
                    <span className="action-content">
                      <span className="action-label" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {a.email}
                      </span>
                      <span className="action-description">
                        Role: {role} • Location: {branches.length > 1 ? branchName : "Main location"}
                      </span>
                    </span>
                  </div>

                  {isOwner && (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        className="btn btn-secondary"
                        style={{ flex: 1, minHeight: 44 }}
                        onClick={() => openEditAccess(a.accessId)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ flex: 1, minHeight: 44, color: "var(--error)" }}
                        onClick={async () => {
                          setIsSaving(true);
                          setActionError(null);
                          try {
                            await removeAccessEmail({ tenantId, accessId: a.accessId });
                          } catch (e) {
                            setActionError(e instanceof Error ? e.message : "Failed to remove access email");
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                        disabled={isSaving}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Primary CTA */}
      {isOwner && (
        <section>
          <button
            className="btn btn-primary"
            style={{ width: "100%", minHeight: 44 }}
            onClick={openAddAccess}
          >
            Add worker/manager
          </button>
        </section>
      )}

      {/* Error */}
      {actionError && (
        <section style={{ marginTop: "1rem" }}>
          <div
            className="card"
            style={{
              padding: "1rem",
              textAlign: "left",
              borderColor: "#fecaca",
              background: "#fff1f2",
              maxWidth: "unset",
            }}
          >
            <strong style={{ color: "#991b1b" }}>Action failed</strong>
            <p style={{ marginTop: "0.25rem", color: "#991b1b", fontSize: "0.875rem" }}>{actionError}</p>
            {isImpersonating && (
              <p style={{ marginTop: "0.5rem", color: "#991b1b", fontSize: "0.8125rem" }}>
                DEV impersonation is UI-only. Some actions may be blocked by server guards.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Sheets */}
      {sheet.kind !== "none" && (
        <Sheet
          title={
            sheet.kind === "add_access"
              ? "Add access email"
              : sheet.kind === "edit_access"
                ? "Edit access email"
                : "Change branch"
          }
          onClose={closeSheet}
        >
          {sheet.kind === "add_access" && (
            <AccessEmailForm
              mode="add"
              branches={branches}
              mainBranchId={mainBranchId}
              isSaving={isSaving}
              onSubmit={async (values) => {
                setIsSaving(true);
                setActionError(null);
                try {
                  await addAccessEmail({
                    tenantId,
                    email: values.email,
                    role: values.role,
                    branchId: values.branchId ?? undefined,
                  });
                  closeSheet();
                } catch (e) {
                  setActionError(e instanceof Error ? e.message : "Failed to add access email");
                } finally {
                  setIsSaving(false);
                }
              }}
            />
          )}

          {sheet.kind === "edit_access" && (
            <AccessEmailForm
              mode="edit"
              branches={branches}
              mainBranchId={mainBranchId}
              isSaving={isSaving}
              initial={() => {
                const a = accessEmails.find((x) => String(x.accessId) === String(sheet.accessId));
                return a
                  ? {
                      email: a.email,
                      role: a.role as AccessRole,
                      branchId: (a.branchId as Id<"branches"> | null) ?? null,
                    }
                  : null;
              }}
              onSubmit={async (values) => {
                setIsSaving(true);
                setActionError(null);
                try {
                  await updateAccessEmail({
                    tenantId,
                    accessId: sheet.accessId,
                    role: values.role,
                    branchId: values.branchId ?? undefined,
                  });
                  closeSheet();
                } catch (e) {
                  setActionError(e instanceof Error ? e.message : "Failed to update access email");
                } finally {
                  setIsSaving(false);
                }
              }}
            />
          )}

          {sheet.kind === "change_member_branch" && (
            <MemberBranchForm
              branches={branches}
              isSaving={isSaving}
              initialBranchId={() => {
                const m = members.find((x) => String(x.membershipId) === String(sheet.membershipId));
                return (m?.branchId as Id<"branches"> | null) ?? null;
              }}
              onSubmit={async (branchId) => {
                setIsSaving(true);
                setActionError(null);
                try {
                  await updateMemberBranch({
                    tenantId,
                    membershipId: sheet.membershipId,
                    branchId,
                  });
                  closeSheet();
                } catch (e) {
                  setActionError(e instanceof Error ? e.message : "Failed to update branch");
                } finally {
                  setIsSaving(false);
                }
              }}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}

function Sheet({
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
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
              Tap outside to close
            </div>
          </div>
          <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ marginTop: "1rem" }}>{children}</div>
      </div>
    </div>
  );
}

function AccessEmailForm({
  mode,
  branches,
  mainBranchId,
  isSaving,
  onSubmit,
  initial,
}: {
  mode: "add" | "edit";
  branches: Array<{ _id: Id<"branches">; name: string; isMainBranch: boolean }>;
  mainBranchId: Id<"branches"> | null;
  isSaving: boolean;
  onSubmit: (values: { email: string; role: AccessRole; branchId: Id<"branches"> | null }) => Promise<void>;
  initial?: () => { email: string; role: AccessRole; branchId: Id<"branches"> | null } | null;
}) {
  const init = initial ? initial() : null;
  const [email, setEmail] = useState(init?.email ?? "");
  const [role, setRole] = useState<AccessRole>(init?.role ?? "WORKER");
  const [branchId, setBranchId] = useState<Id<"branches"> | null>(init?.branchId ?? null);
  const [localError, setLocalError] = useState<string | null>(null);

  const multi = branches.length > 1;
  const effectiveBranchId = multi ? branchId : (mainBranchId as Id<"branches"> | null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {mode === "add" ? (
        <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="worker@example.com"
            style={{
              minHeight: 44,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0 0.75rem",
              fontSize: "0.875rem",
            }}
          />
        </label>
      ) : (
        <div className="card" style={{ padding: "1rem", textAlign: "left", maxWidth: "unset" }}>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>Email</div>
          <div style={{ fontSize: "1rem", fontWeight: 600, wordBreak: "break-word" }}>{email}</div>
        </div>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AccessRole)}
          style={{
            minHeight: 44,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0 0.75rem",
            fontSize: "0.875rem",
            background: "white",
          }}
        >
          <option value="MANAGER">MANAGER</option>
          <option value="WORKER">WORKER</option>
        </select>
      </label>

      {multi && (
        <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Location (required)</span>
          <select
            value={branchId ? String(branchId) : ""}
            onChange={(e) => setBranchId((e.target.value as Id<"branches">) || null)}
            style={{
              minHeight: 44,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0 0.75rem",
              fontSize: "0.875rem",
              background: "white",
            }}
          >
            <option value="">Select a location</option>
            {branches.map((b) => (
              <option key={String(b._id)} value={String(b._id)}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {localError && (
        <p style={{ color: "var(--error)", fontSize: "0.875rem" }}>{localError}</p>
      )}

      <button
        className="btn btn-primary"
        style={{ width: "100%", minHeight: 44 }}
        disabled={isSaving}
        onClick={async () => {
          setLocalError(null);
          const e = email.trim();
          if (mode === "add" && e.length === 0) {
            setLocalError("Email is required");
            return;
          }
          if (multi && !effectiveBranchId) {
            setLocalError("Location is required");
            return;
          }
          await onSubmit({
            email: mode === "add" ? e : email,
            role,
            branchId: effectiveBranchId,
          });
        }}
      >
        {mode === "add" ? "Add access" : "Save changes"}
      </button>
    </div>
  );
}

function MemberBranchForm({
  branches,
  isSaving,
  initialBranchId,
  onSubmit,
}: {
  branches: Array<{ _id: Id<"branches">; name: string; isMainBranch: boolean }>;
  isSaving: boolean;
  initialBranchId: () => Id<"branches"> | null;
  onSubmit: (branchId: Id<"branches">) => Promise<void>;
}) {
  const init = initialBranchId();
  const [branchId, setBranchId] = useState<Id<"branches"> | null>(init);
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Location</span>
        <select
          value={branchId ? String(branchId) : ""}
          onChange={(e) => setBranchId((e.target.value as Id<"branches">) || null)}
          style={{
            minHeight: 44,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0 0.75rem",
            fontSize: "0.875rem",
            background: "white",
          }}
        >
          <option value="">Select a location</option>
          {branches.map((b) => (
            <option key={String(b._id)} value={String(b._id)}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      {localError && (
        <p style={{ color: "var(--error)", fontSize: "0.875rem" }}>{localError}</p>
      )}

      <button
        className="btn btn-primary"
        style={{ width: "100%", minHeight: 44 }}
        disabled={isSaving}
        onClick={async () => {
          setLocalError(null);
          if (!branchId) {
            setLocalError("Location is required");
            return;
          }
          await onSubmit(branchId);
        }}
      >
        Save branch
      </button>
    </div>
  );
}

