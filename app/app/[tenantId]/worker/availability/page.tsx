"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getCurrentWeekStartISO, getNextWeekStartISO } from "../../../../lib/weekUtils";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function formatTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.floor(minutes)));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function formatRange(startMin: number, endMin: number): string {
  return `${formatTime(startMin)}–${formatTime(endMin)}`;
}

type Slot = {
  slotTemplateId: Id<"shiftSlotTemplates">;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  label?: string;
  isSelected: boolean;
};

export default function WorkerAvailabilityPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;

  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const devImp = getDevImpersonation();
  const effectiveBranchId = useMemo(() => {
    if (!tenantInfo) return null;
    const realRole = tenantInfo.currentRole;
    const realBranchId = tenantInfo.currentBranchId ?? null;
    if (isDev() && realRole === "OWNER" && devImp.enabled && devImp.branchId) {
      return devImp.branchId;
    }
    return realBranchId;
  }, [tenantInfo?.currentRole, tenantInfo?.currentBranchId, devImp.enabled, devImp.branchId]);

  const canFetchAvailability = effectiveBranchId != null;
  const isImpersonating =
    isDev() &&
    tenantInfo?.currentRole === "OWNER" &&
    devImp.enabled &&
    devImp.branchId != null;

  const currentWeekStart = useMemo(() => getCurrentWeekStartISO(), []);
  const nextWeekStart = useMemo(() => getNextWeekStartISO(), []);

  const [weekChoice, setWeekChoice] = useState<"this" | "next">("this");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const weekStart = weekChoice === "this" ? currentWeekStart : nextWeekStart;

  const getMyWeekArgs = useMemo(
    () =>
      canFetchAvailability
        ? {
            tenantId,
            weekStart,
            ...(isImpersonating && effectiveBranchId
              ? { branchId: effectiveBranchId as Id<"branches"> }
              : {}),
          }
        : "skip",
    [canFetchAvailability, tenantId, weekStart, isImpersonating, effectiveBranchId]
  );

  const data = useQuery(api.availability.getMyWeek, getMyWeekArgs);
  const setSelections = useMutation(api.availability.setMySelections);

  const [initializedForWeek, setInitializedForWeek] = useState<string | null>(null);

  useEffect(() => {
    setSelection(new Set());
    setInitializedForWeek(null);
  }, [weekStart]);

  useEffect(() => {
    if (!data?.slots || initializedForWeek === weekStart) return;
    const ids = new Set(data.slots.filter((s) => s.isSelected).map((s) => String(s.slotTemplateId)));
    setSelection(ids);
    setInitializedForWeek(weekStart);
  }, [data?.slots, initializedForWeek, weekStart]);

  const toggleSlot = useCallback(
    (slotTemplateId: Id<"shiftSlotTemplates">) => {
      if (!data?.isEditable) return;
      const key = String(slotTemplateId);
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [data?.isEditable]
  );

  const handleSave = useCallback(async () => {
    if (!data?.isEditable || busy) return;
    const ids = data.slots.filter((s) => selection.has(String(s.slotTemplateId))).map((s) => s.slotTemplateId);
    setBusy(true);
    try {
      await setSelections({
        tenantId,
        weekStart,
        selectedSlotTemplateIds: ids,
        ...(isImpersonating && effectiveBranchId
          ? { branchId: effectiveBranchId as Id<"branches"> }
          : {}),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [data, busy, selection, setSelections, tenantId, weekStart, isImpersonating, effectiveBranchId]);

  const slotsByDay = useMemo(() => {
    if (!data?.slots) return [] as { dayOfWeek: number; dayName: string; slots: Slot[] }[];
    const byDay = new Map<number, Slot[]>();
    for (const s of data.slots) {
      const list = byDay.get(s.dayOfWeek) ?? [];
      list.push(s);
      byDay.set(s.dayOfWeek, list);
    }
    return DAY_NAMES.map((name, i) => ({
      dayOfWeek: i,
      dayName: name,
      slots: byDay.get(i) ?? [],
    })).filter((g) => g.slots.length > 0);
  }, [data?.slots]);

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Availability</h1>
        <p className="dashboard-subtitle">Choose the shifts you can work</p>
      </header>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        <button
          className="btn btn-secondary"
          style={{
            flex: 1,
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
            flex: 1,
            minHeight: 44,
            background: weekChoice === "next" ? "var(--secondary)" : "white",
          }}
          onClick={() => setWeekChoice("next")}
        >
          Next week
        </button>
      </div>

      {data?.branch && (
        <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
          Location: {data.branch.name}
        </div>
      )}

      {!canFetchAvailability && tenantInfo !== undefined ? (
        <div
          style={{
            padding: "1.5rem",
            background: "white",
            border: "1px solid var(--border)",
            borderRadius: "0.75rem",
            color: "var(--muted)",
            fontSize: "0.875rem",
          }}
        >
          You must be assigned to a location to set availability. Contact your manager.
        </div>
      ) : !data ? (
        <div style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.875rem" }}>Loading…</div>
      ) : !data.isEditable && weekChoice === "this" ? (
        <div
          style={{
            padding: "1rem",
            background: "var(--secondary)",
            borderRadius: "0.75rem",
            color: "var(--muted)",
            fontSize: "0.875rem",
          }}
        >
          Availability for this week is closed.
        </div>
      ) : data.slots.length === 0 ? (
        <div
          style={{
            padding: "1.5rem",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "0.875rem",
            background: "white",
            border: "1px solid var(--border)",
            borderRadius: "0.75rem",
          }}
        >
          No shift templates are set for this location. Ask your manager to create shift templates.
        </div>
      ) : (
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
                {slots.map((slot) => {
                  const key = String(slot.slotTemplateId);
                  const isSelected = selection.has(key);
                  const disabled = !data.isEditable;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSlot(slot.slotTemplateId)}
                      disabled={disabled}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "1rem",
                        padding: "1rem",
                        minHeight: 64,
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.7 : 1,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                          {formatRange(slot.startMin, slot.endMin)}
                        </div>
                        {slot.label ? (
                          <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: 2 }}>
                            {slot.label}
                          </div>
                        ) : null}
                      </div>
                      <div
                        style={{
                          flexShrink: 0,
                          width: 44,
                          height: 28,
                          borderRadius: 14,
                          background: isSelected ? "var(--primary)" : "var(--border)",
                          position: "relative",
                          transition: "background 0.15s",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: 2,
                            left: isSelected ? 22 : 2,
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            background: "white",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                            transition: "left 0.15s",
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {data && data.slots.length > 0 && data.isEditable && (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "1rem 0",
            background: "white",
            borderTop: "1px solid var(--border)",
            marginTop: "1rem",
          }}
        >
          {saveSuccess && (
            <div
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.875rem",
                color: "var(--primary)",
                fontWeight: 600,
              }}
            >
              Saved!
            </div>
          )}
          <button
            className="btn btn-primary"
            style={{ width: "100%", minHeight: 44 }}
            onClick={handleSave}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save availability"}
          </button>
        </div>
      )}
    </div>
  );
}
