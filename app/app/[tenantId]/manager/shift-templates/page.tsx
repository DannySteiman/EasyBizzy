"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

type Role = "OWNER" | "MANAGER" | "WORKER";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const STORAGE_KEY = "easybizzy.manager.selectedBranchId";

type SheetState =
  | { type: "pick_branch" }
  | { type: "add_slot" }
  | { type: "slot_actions"; slotId: Id<"shiftSlotTemplates"> }
  | { type: "edit_slot"; slotId: Id<"shiftSlotTemplates"> }
  | { type: "delete_confirm"; slotId: Id<"shiftSlotTemplates"> }
  | null;

function formatTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.floor(minutes)));
  const h = Math.floor(m / 60);
  const min = m % 60;
  const hh = h.toString().padStart(2, "0");
  const mm = min.toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatRange(startMin: number, endMin: number): string {
  return `${formatTime(startMin)}-${formatTime(endMin)}`;
}

function parseTimeInput(value: string): number | null {
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function toTimeInputValue(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.floor(minutes)));
  return formatTime(clamped);
}

export default function ShiftTemplatesPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as Id<"tenants">;

  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.list, { tenantId });
  const createSlot = useMutation(api.shiftTemplates.create);
  const updateSlot = useMutation(api.shiftTemplates.update);
  const removeSlot = useMutation(api.shiftTemplates.remove);

  const devImp = getDevImpersonation();
  const realRole = (tenantInfo?.currentRole as Role | undefined) ?? undefined;
  const realBranchId = (tenantInfo?.currentBranchId as string | null | undefined) ?? null;
  const effectiveRole: Role | undefined =
    isDev() && realRole === "OWNER" && devImp.enabled && devImp.role ? (devImp.role as Role) : realRole;
  const effectiveBranchId =
    isDev() && realRole === "OWNER" && devImp.enabled ? devImp.branchId || realBranchId || null : realBranchId;

  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state shared by add/edit
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [startTime, setStartTime] = useState<string>("08:00");
  const [endTime, setEndTime] = useState<string>("14:00");
  const [position, setPosition] = useState<string>("");
  const [label, setLabel] = useState<string>("");

  const mainBranchId = useMemo(() => {
    if (!Array.isArray(branches)) return null;
    return branches.find((b) => b.isMainBranch)?._id ?? null;
  }, [branches]);

  const branchesById = useMemo(() => {
    const map = new Map<string, { _id: Id<"branches">; name: string; isMainBranch: boolean }>();
    if (Array.isArray(branches)) {
      for (const b of branches) {
        map.set(String(b._id), { _id: b._id as Id<"branches">, name: b.name, isMainBranch: b.isMainBranch });
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

  const selectedLocationName = useMemo(() => {
    if (!selectedLocationId) return null;
    return branchesById.get(String(selectedLocationId))?.name ?? null;
  }, [branchesById, selectedLocationId]);

  const selectedLocationConvexId = useMemo(() => {
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
        setSelectedBranchId(""); // sentinel: loaded
      }
    } catch {
      setSelectedBranchId(""); // sentinel: loaded
    }
  }, [branches, branchesById, selectedBranchId]);

  useEffect(() => {
    if (!effectiveRole) return;
    if (effectiveRole === "WORKER") {
      router.replace(`/app/${tenantId}/worker/home`);
    }
  }, [effectiveRole, router, tenantId]);

  const slots = useQuery(
    api.shiftTemplates.list,
    selectedLocationConvexId ? { tenantId, branchId: selectedLocationConvexId } : "skip"
  );

  const slotById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof slots>[number]>();
    if (Array.isArray(slots)) {
      for (const slot of slots) {
        map.set(String(slot._id), slot);
      }
    }
    return map;
  }, [slots]);

  const groupedByDay = useMemo(() => {
    const groups = DAY_NAMES.map((day, dayIndex) => ({
      day,
      dayIndex,
      slots: [] as NonNullable<typeof slots>,
    }));
    if (Array.isArray(slots)) {
      for (const slot of slots) {
        if (slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6) {
          groups[slot.dayOfWeek].slots.push(slot);
        }
      }
    }
    return groups;
  }, [slots]);

  if (tenantInfo === undefined || branches === undefined || slots === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading shift templates...</p>
        </div>
      </div>
    );
  }

  const totalSlots = slots.length;
  const selectedActionSlot =
    sheet && "slotId" in sheet ? slotById.get(String(sheet.slotId)) ?? null : null;

  const resetForm = () => {
    setDayOfWeek(0);
    setStartTime("08:00");
    setEndTime("14:00");
    setPosition("");
    setLabel("");
  };

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Shift templates</h1>
        <p className="dashboard-subtitle">Define weekly shift slots for this location</p>
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

      {(branches?.length ?? 0) > 1 && (
        <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div>
              <div className="metric-label">Location</div>
              <div style={{ fontSize: "1rem", fontWeight: 700, marginTop: "0.25rem" }}>
                {selectedLocationName ?? "Select a location"}
              </div>
            </div>
            <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setSheet({ type: "pick_branch" })}>
              Change
            </button>
          </div>
        </section>
      )}

      {totalSlots === 0 ? (
        <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            No shift slots yet. Add your first slot to start collecting availability.
          </div>
        </section>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "0.75rem" }}>
          {groupedByDay
            .filter((group) => group.slots.length > 0)
            .map((group) => (
              <section key={group.day} className="metric-card">
                <div style={{ fontSize: "0.9375rem", fontWeight: 800, marginBottom: "0.25rem" }}>{group.day}</div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {group.slots.map((slot) => (
                    <div
                      key={String(slot._id)}
                      style={{
                        minHeight: 56,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        borderTop: "1px solid var(--border)",
                        padding: "0.625rem 0",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>{formatRange(slot.startMin, slot.endMin)}</div>
                        {(slot.position || slot.label) ? (
                          <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            {slot.position ? <span className="badge badge-success">{slot.position}</span> : null}
                            {slot.label ? <span className="badge badge-warning">{slot.label}</span> : null}
                          </div>
                        ) : null}
                      </div>
                      <button
                        className="btn btn-secondary"
                        style={{ minHeight: 44, flexShrink: 0 }}
                        onClick={() => setSheet({ type: "slot_actions", slotId: slot._id as Id<"shiftSlotTemplates"> })}
                      >
                        Actions
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: "100%", minHeight: 44, marginBottom: "1.5rem" }}
        onClick={() => {
          setError(null);
          resetForm();
          setSheet({ type: "add_slot" });
        }}
      >
        Add shift slot
      </button>

      {sheet && (
        <BottomSheet
          title={
            sheet.type === "pick_branch"
              ? "Choose location"
              : sheet.type === "add_slot"
                ? "Add shift slot"
                : sheet.type === "edit_slot"
                  ? "Edit shift slot"
                  : sheet.type === "delete_confirm"
                    ? "Delete shift slot"
                    : "Shift slot"
          }
          onClose={() => {
            if (busy) return;
            setSheet(null);
          }}
        >
          {sheet.type === "pick_branch" && (
            <div className="action-list" style={{ gap: "0.5rem" }}>
              {(branches ?? []).map((branch) => {
                const active = String(selectedLocationId) === String(branch._id);
                return (
                  <button
                    key={String(branch._id)}
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
                        window.localStorage.setItem(STORAGE_KEY, String(branch._id));
                      } catch {
                        // ignore storage write failures
                      }
                      setSelectedBranchId(String(branch._id));
                      setSheet(null);
                    }}
                  >
                    <span className="action-icon">📍</span>
                    <span className="action-content">
                      <span className="action-label">
                        {branch.name} {branch.isMainBranch ? "(Main)" : ""}
                      </span>
                      <span className="action-description">{active ? "Selected" : "Tap to select"}</span>
                    </span>
                    <span className="action-chevron">{active ? "✓" : "›"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {sheet.type === "slot_actions" && selectedActionSlot && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                {DAY_NAMES[selectedActionSlot.dayOfWeek]} • {formatRange(selectedActionSlot.startMin, selectedActionSlot.endMin)}
              </div>
              {selectedActionSlot.position ? (
                <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>Position: {selectedActionSlot.position}</div>
              ) : null}
              <button
                className="btn btn-secondary"
                style={{ width: "100%", minHeight: 44 }}
                onClick={() => {
                  setDayOfWeek(selectedActionSlot.dayOfWeek);
                  setStartTime(toTimeInputValue(selectedActionSlot.startMin));
                  setEndTime(toTimeInputValue(Math.min(selectedActionSlot.endMin, 1439)));
                  setPosition(selectedActionSlot.position ?? "");
                  setLabel(selectedActionSlot.label ?? "");
                  setSheet({ type: "edit_slot", slotId: selectedActionSlot._id as Id<"shiftSlotTemplates"> });
                }}
              >
                Edit
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: "100%", minHeight: 44, color: "#b91c1c", borderColor: "#fecaca", background: "#fff1f2" }}
                onClick={() => setSheet({ type: "delete_confirm", slotId: selectedActionSlot._id as Id<"shiftSlotTemplates"> })}
              >
                Delete
              </button>
            </div>
          )}

          {(sheet.type === "add_slot" || (sheet.type === "edit_slot" && selectedActionSlot)) && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || !selectedLocationConvexId) return;
                const startMin = parseTimeInput(startTime);
                const endMinRaw = parseTimeInput(endTime);
                if (startMin === null || endMinRaw === null) {
                  setError("Please provide valid start and end times.");
                  return;
                }
                const endMin = endMinRaw;

                setBusy(true);
                setError(null);
                try {
                  if (sheet.type === "add_slot") {
                    await createSlot({
                      tenantId,
                      branchId: selectedLocationConvexId,
                      dayOfWeek,
                      startMin,
                      endMin,
                      position: position.trim() || undefined,
                      label: label.trim() || undefined,
                    });
                  } else {
                    await updateSlot({
                      tenantId,
                      slotId: sheet.slotId,
                      dayOfWeek,
                      startMin,
                      endMin,
                      position: position.trim() || undefined,
                      label: label.trim() || undefined,
                    });
                  }
                  setSheet(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to save shift slot.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.625rem" }}>
                Location: <strong>{selectedLocationName ?? "Current location"}</strong>
              </div>

              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.25rem" }}>Day</label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: "0 0.75rem",
                  fontSize: "1rem",
                  marginBottom: "0.625rem",
                  background: "white",
                }}
                disabled={busy}
              >
                {DAY_NAMES.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>

              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.25rem" }}>Start time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: "0 0.75rem",
                  fontSize: "1rem",
                  marginBottom: "0.625rem",
                }}
                disabled={busy}
              />

              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.25rem" }}>End time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: "0 0.75rem",
                  fontSize: "1rem",
                  marginBottom: "0.625rem",
                }}
                disabled={busy}
              />

              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.25rem" }}>
                Position (optional)
              </label>
              <input
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="e.g. Cashier"
                maxLength={40}
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: "0 0.75rem",
                  fontSize: "1rem",
                  marginBottom: "0.625rem",
                }}
                disabled={busy}
              />

              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.25rem" }}>
                Label (optional)
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Morning"
                maxLength={40}
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: "0 0.75rem",
                  fontSize: "1rem",
                }}
                disabled={busy}
              />

              <button className="btn btn-primary" style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }} disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </button>
            </form>
          )}

          {sheet.type === "delete_confirm" && selectedActionSlot && (
            <div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                Delete <strong>{DAY_NAMES[selectedActionSlot.dayOfWeek]}</strong> slot{" "}
                <strong>{formatRange(selectedActionSlot.startMin, selectedActionSlot.endMin)}</strong>
                {selectedActionSlot.position ? (
                  <>
                    {" "}
                    for <strong>{selectedActionSlot.position}</strong>
                  </>
                ) : (
                  "?"
                )}
              </div>
              <button
                className="btn btn-primary"
                style={{ width: "100%", minHeight: 44, marginTop: "0.75rem", background: "#dc2626", borderColor: "#dc2626" }}
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError(null);
                  try {
                    await removeSlot({ tenantId, slotId: sheet.slotId });
                    setSheet(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to delete shift slot.");
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
