"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getCurrentWeekStartISO, getNextWeekStartISO } from "../../../../lib/weekUtils";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

type Role = "OWNER" | "MANAGER" | "WORKER";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const STORAGE_KEY = "easybizzy.manager.selectedBranchId";

function formatTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.floor(minutes)));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function formatRange(startMin: number, endMin: number): string {
  return `${formatTime(startMin)}–${formatTime(endMin)}`;
}

function shortUserId(userId: string): string {
  if (userId.length <= 10) return userId;
  return "…" + userId.slice(-8);
}

type SlotData = {
  slotTemplateId: Id<"shiftSlotTemplates">;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  label?: string;
  assignedWorkerUserIds: string[];
  availableWorkerUserIds: string[];
};

type SheetState =
  | { type: "pick_branch" }
  | { type: "cutoff_settings" }
  | { type: "manage_slot"; slot: SlotData }
  | null;

export default function ManagerSchedulePage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as Id<"tenants">;

  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.list, { tenantId });

  const devImp = getDevImpersonation();
  const realRole = (tenantInfo?.currentRole as Role | undefined) ?? undefined;
  const currentUserId = (tenantInfo as { currentUserId?: string } | undefined)?.currentUserId ?? null;
  const realBranchId = (tenantInfo?.currentBranchId as string | null | undefined) ?? null;
  const effectiveRole: Role | undefined =
    isDev() && realRole === "OWNER" && devImp.enabled && devImp.role ? (devImp.role as Role) : realRole;
  const effectiveBranchId =
    isDev() && realRole === "OWNER" && devImp.enabled ? devImp.branchId || realBranchId || null : realBranchId;

  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [weekChoice, setWeekChoice] = useState<"this" | "next">("this");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currentWeekStart = useMemo(() => getCurrentWeekStartISO(), []);
  const nextWeekStart = useMemo(() => getNextWeekStartISO(), []);
  const weekStart = weekChoice === "this" ? currentWeekStart : nextWeekStart;

  const mainBranchId = useMemo(() => {
    if (!Array.isArray(branches)) return null;
    return branches.find((b) => b.isMainBranch)?._id ?? null;
  }, [branches]);

  const branchesById = useMemo(() => {
    const map = new Map<string, { _id: Id<"branches">; name: string }>();
    if (Array.isArray(branches)) {
      for (const b of branches) {
        map.set(String(b._id), { _id: b._id as Id<"branches">, name: b.name });
      }
    }
    return map;
  }, [branches]);

  const selectedLocationId = useMemo(() => {
    const fallback = effectiveBranchId || mainBranchId || null;
    if (!selectedBranchId) return fallback;
    if (branchesById.has(String(selectedBranchId))) return selectedBranchId;
    return fallback;
  }, [branchesById, effectiveBranchId, mainBranchId, selectedBranchId]);

  const selectedLocationConvexId = useMemo((): Id<"branches"> | null => {
    if (!selectedLocationId) return null;
    return branchesById.get(String(selectedLocationId))?._id ?? null;
  }, [branchesById, selectedLocationId]);

  useEffect(() => {
    if (!Array.isArray(branches)) return;
    if (selectedBranchId !== null) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw && branchesById.has(raw)) {
        setSelectedBranchId(raw);
      } else {
        setSelectedBranchId("");
      }
    } catch {
      setSelectedBranchId("");
    }
  }, [branches, branchesById, selectedBranchId]);

  useEffect(() => {
    if (!effectiveRole) return;
    if (effectiveRole === "WORKER") {
      router.replace(`/app/${tenantId}/worker/home`);
    }
  }, [effectiveRole, router, tenantId]);

  const weekData = useQuery(
    api.schedule.getWeek,
    selectedLocationConvexId ? { tenantId, branchId: selectedLocationConvexId, weekStart } : "skip"
  );

  const publishStatus = useQuery(
    api.schedule.getPublishStatus,
    selectedLocationConvexId ? { tenantId, branchId: selectedLocationConvexId, weekStart } : "skip"
  );

  const cutoffSettings = useQuery(api.schedule.getCutoffSettings, { tenantId });
  const setAssignments = useMutation(api.schedule.setAssignmentsForSlot);
  const setCutoff = useMutation(api.schedule.setCutoffSettings);
  const publishWeek = useMutation(api.schedule.publishWeek);

  const slotsByDay = useMemo(() => {
    if (!weekData?.slots) return [] as { dayOfWeek: number; dayName: string; slots: SlotData[] }[];
    const byDay = new Map<number, SlotData[]>();
    for (const s of weekData.slots) {
      const list = byDay.get(s.dayOfWeek) ?? [];
      list.push(s);
      byDay.set(s.dayOfWeek, list);
    }
    return DAY_NAMES.map((name, i) => ({
      dayOfWeek: i,
      dayName: name,
      slots: byDay.get(i) ?? [],
    })).filter((g) => g.slots.length > 0);
  }, [weekData?.slots]);

  const manageSlot = sheet?.type === "manage_slot" ? sheet.slot : null;
  const availableWorkers = useQuery(
    api.schedule.listAvailableWorkersForSlot,
    manageSlot && selectedLocationConvexId
      ? {
          tenantId,
          branchId: selectedLocationConvexId,
          weekStart,
          slotTemplateId: manageSlot.slotTemplateId,
        }
      : "skip"
  );

  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!manageSlot) return;
    setLocalSelectedIds(new Set(manageSlot.assignedWorkerUserIds));
  }, [manageSlot?.slotTemplateId]);

  const handleApplyAssignments = useCallback(async () => {
    if (!manageSlot || !selectedLocationConvexId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setAssignments({
        tenantId,
        branchId: selectedLocationConvexId,
        weekStart,
        slotTemplateId: manageSlot.slotTemplateId,
        workerUserIds: Array.from(localSelectedIds),
      });
      setSheet(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  }, [manageSlot, selectedLocationConvexId, localSelectedIds, setAssignments, tenantId, weekStart, busy]);

  const handlePublish = useCallback(async () => {
    if (!selectedLocationConvexId || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await publishWeek({
        tenantId,
        branchId: selectedLocationConvexId,
        weekStart,
      });
      const wasFirstPublish = !publishStatus || publishStatus.status === "DRAFT";
      setSuccess(wasFirstPublish ? "Schedule published to workers." : "Schedule updated.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish.");
    } finally {
      setBusy(false);
    }
  }, [selectedLocationConvexId, publishWeek, tenantId, weekStart, publishStatus, busy]);

  const handleSetCutoff = useCallback(
    async (day: number) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await setCutoff({ tenantId, cutoffDayOfWeek: day });
        setSheet(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      } finally {
        setBusy(false);
      }
    },
    [setCutoff, tenantId, busy]
  );

  if (tenantInfo === undefined || branches === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (effectiveRole === "WORKER") {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Redirecting...</p>
        </div>
      </div>
    );
  }

  const selectedLocationName = branchesById.get(String(selectedLocationId ?? ""))?.name ?? "Select location";

  const isPublished = publishStatus?.status === "PUBLISHED";

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Schedule</h1>
        <p className="dashboard-subtitle">
          Assign workers for the week
          {isPublished && (
            <span
              className="badge badge-success"
              style={{ display: "inline-block", marginLeft: "0.5rem", fontSize: "0.6875rem" }}
            >
              Published
            </span>
          )}
        </p>
      </header>

      {success && (
        <section
          className="metric-card"
          style={{ marginBottom: "0.75rem", borderColor: "rgba(34, 197, 94, 0.35)", background: "rgba(34, 197, 94, 0.08)" }}
        >
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#15803d" }}>{success}</div>
        </section>
      )}

      {error && (
        <section
          className="metric-card"
          style={{ marginBottom: "0.75rem", borderColor: "rgba(220, 38, 38, 0.35)" }}
        >
          <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "#b91c1c" }}>Action failed</div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 4 }}>{error}</div>
          <button
            className="btn btn-secondary"
            style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </section>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <button
          className="btn btn-secondary"
          style={{
            minHeight: 44,
            background: weekChoice === "this" ? "var(--secondary)" : "white",
          }}
          onClick={() => setWeekChoice("this")}
        >
          This week
        </button>
        <button
          className="btn btn-secondary"
          style={{
            minHeight: 44,
            background: weekChoice === "next" ? "var(--secondary)" : "white",
          }}
          onClick={() => setWeekChoice("next")}
        >
          Next week
        </button>
        <button
          className="btn btn-secondary"
          style={{ minHeight: 44 }}
          onClick={() => setSheet({ type: "cutoff_settings" })}
        >
          Availability cutoff
        </button>
      </div>

      {(branches?.length ?? 0) > 1 && (
        <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div>
              <div className="metric-label">Location</div>
              <div style={{ fontSize: "1rem", fontWeight: 700, marginTop: "0.25rem" }}>{selectedLocationName}</div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 44 }}
              onClick={() => setSheet({ type: "pick_branch" })}
            >
              Change
            </button>
          </div>
        </section>
      )}

      {weekData && !weekData.visibility.canSee && weekData.visibility.reason && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "var(--secondary)",
            borderRadius: "0.75rem",
            color: "var(--muted)",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        >
          {weekData.visibility.reason}
        </div>
      )}

      {!selectedLocationConvexId ? (
        <div style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.875rem" }}>
          Select a location to view the schedule.
        </div>
      ) : !weekData ? (
        <div style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.875rem" }}>Loading schedule…</div>
      ) : weekData.slots.length === 0 ? (
        <div
          style={{
            padding: "1.5rem",
            background: "white",
            border: "1px solid var(--border)",
            borderRadius: "0.75rem",
          }}
        >
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            No shift templates for this location.
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginBottom: "1rem" }}>
            Create shift templates first, then workers can submit availability.
          </div>
          <Link
            href={`/app/${tenantId}/manager/shift-templates`}
            className="btn btn-primary"
            style={{ display: "block", width: "100%", minHeight: 44, textAlign: "center", lineHeight: "44px" }}
          >
            Create shift templates
          </Link>
        </div>
      ) : (
        <>
          <button
            className="btn btn-primary"
            style={{ width: "100%", minHeight: 44, marginBottom: "1rem" }}
            onClick={handlePublish}
            disabled={busy}
          >
            {busy ? "Publishing…" : isPublished ? "Republish changes" : "Publish to workers"}
          </button>
          <div style={{ marginBottom: "1rem" }}>
          {slotsByDay.map(({ dayOfWeek, dayName, slots }) => (
            <section
              key={dayOfWeek}
              style={{
                marginBottom: "1rem",
                background: "white",
                border: "1px solid var(--border)",
                borderRadius: "0.75rem",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--secondary)",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                }}
              >
                {dayName}
              </div>
              <div style={{ padding: "0.25rem 0" }}>
                {slots.map((slot) => (
                  <div
                    key={String(slot.slotTemplateId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "1rem",
                      padding: "1rem",
                      minHeight: 64,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                        {formatRange(slot.startMin, slot.endMin)}
                        {slot.label ? (
                          <span
                            className="badge badge-warning"
                            style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}
                          >
                            {slot.label}
                          </span>
                        ) : null}
                      </div>
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.8125rem",
                          color: "var(--muted)",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.25rem",
                        }}
                      >
                        {slot.assignedWorkerUserIds.length === 0 ? (
                          <span>No one assigned</span>
                        ) : (
                          slot.assignedWorkerUserIds.map((uid) => (
                            <span key={uid} className="badge badge-success" style={{ fontSize: "0.6875rem" }}>
                              {shortUserId(uid)}
                              {currentUserId && uid === currentUserId ? " (you)" : ""}
                            </span>
                          ))
                        )}
                        {slot.availableWorkerUserIds.filter((uid) => !slot.assignedWorkerUserIds.includes(uid)).length > 0 && (
                          <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: "0.25rem" }}>
                            Available:{" "}
                            {slot.availableWorkerUserIds
                              .filter((uid) => !slot.assignedWorkerUserIds.includes(uid))
                              .map((uid) => (
                                <span key={uid} className="badge badge-warning" style={{ fontSize: "0.6875rem", marginLeft: 2 }}>
                                  {shortUserId(uid)}
                                  {currentUserId && uid === currentUserId ? " (you)" : ""}
                                </span>
                              ))}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ minHeight: 44, flexShrink: 0 }}
                      onClick={() => setSheet({ type: "manage_slot", slot })}
                    >
                      Manage
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
          </div>
        </>
      )}

      {sheet && (
        <BottomSheet
          title={
            sheet.type === "pick_branch"
              ? "Choose location"
              : sheet.type === "cutoff_settings"
                ? "Availability cutoff"
                : "Manage slot"
          }
          onClose={() => {
            if (!busy) setSheet(null);
          }}
        >
          {sheet.type === "pick_branch" && (
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
                        window.localStorage.setItem(STORAGE_KEY, String(b._id));
                      } catch {
                        /* ignore */
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

          {sheet.type === "cutoff_settings" && (
            <>
              <div style={{ fontSize: "0.875rem", marginBottom: "0.75rem", color: "var(--muted)" }}>
                Workers can edit availability for the current week until this day. After that, the week is locked.
              </div>
              <div className="action-list" style={{ gap: "0.5rem" }}>
              {DAY_NAMES.map((name, i) => {
                const active = (cutoffSettings?.cutoffDayOfWeek ?? 3) === i;
                return (
                  <button
                    key={i}
                    type="button"
                    className="action-item"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                      background: active ? "var(--secondary)" : "white",
                    }}
                    onClick={() => handleSetCutoff(i)}
                    disabled={busy}
                  >
                    <span className="action-icon">📅</span>
                    <span className="action-content">
                      <span className="action-label">{name}</span>
                      <span className="action-description">{active ? "Current cutoff" : "Set as cutoff"}</span>
                    </span>
                    <span className="action-chevron">{active ? "✓" : "›"}</span>
                  </button>
                );
              })}
              </div>
            </>
          )}

          {sheet.type === "manage_slot" && manageSlot && (
            <div>
              <div style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                {formatRange(manageSlot.startMin, manageSlot.endMin)}
                {manageSlot.label ? ` • ${manageSlot.label}` : ""}
              </div>
              {!weekData?.visibility.canSee ? (
                <div
                  style={{
                    padding: "1rem",
                    background: "var(--secondary)",
                    borderRadius: "0.75rem",
                    color: "var(--muted)",
                    fontSize: "0.875rem",
                  }}
                >
                  Next week availability will appear on Sunday.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
                    Workers listed here selected this slot as available.
                  </div>
                  <div style={{ maxHeight: 240, overflowY: "auto", marginBottom: "1rem" }}>
                    {(
                      availableWorkers?.visible
                        ? [
                            ...manageSlot.assignedWorkerUserIds.filter(
                              (id) => !(availableWorkers?.workers ?? []).includes(id)
                            ),
                            ...(availableWorkers?.workers ?? []),
                          ]
                        : manageSlot.assignedWorkerUserIds
                    )
                      .filter((id, i, arr) => arr.indexOf(id) === i)
                      .map((uid) => {
                        const isAvailable = (availableWorkers?.workers ?? []).includes(uid);
                        const checked = localSelectedIds.has(uid);
                        return (
                          <label
                            key={uid}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.75rem",
                              padding: "0.75rem 0",
                              minHeight: 44,
                              cursor: weekData?.visibility.canSee ? "pointer" : "default",
                              borderBottom: "1px solid var(--border)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!weekData?.visibility.canSee}
                              onChange={() => {
                                if (!weekData?.visibility.canSee) return;
                                setLocalSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(uid)) next.delete(uid);
                                  else next.add(uid);
                                  return next;
                                });
                              }}
                              style={{ width: 20, height: 20 }}
                            />
                            <span style={{ fontSize: "0.9375rem" }}>
                              {shortUserId(uid)}
                              {currentUserId && uid === currentUserId ? " (you)" : ""}
                              {!isAvailable && (
                                <span style={{ color: "var(--muted)", fontSize: "0.75rem", marginLeft: 4 }}>
                                  (assigned only)
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    {((availableWorkers?.workers ?? []).length === 0 && manageSlot.assignedWorkerUserIds.length === 0) && (
                      <div style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.875rem" }}>
                        No workers selected this slot as available.
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: "100%", minHeight: 44 }}
                    onClick={handleApplyAssignments}
                    disabled={busy}
                  >
                    {busy ? "Saving…" : "Apply"}
                  </button>
                </>
              )}
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
          maxHeight: "80vh",
          overflowY: "auto",
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
