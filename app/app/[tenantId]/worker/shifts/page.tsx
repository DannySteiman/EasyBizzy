"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getCurrentWeekStartISO, getNextWeekStartISO } from "../../../../lib/weekUtils";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function formatTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.floor(minutes)));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function formatRange(startMin: number, endMin: number): string {
  return `${formatTime(startMin)}–${formatTime(endMin)}`;
}

/**
 * WORKER SHIFTS PAGE
 * ==================
 * Mobile-first view of published schedule. Workers see assigned shifts only when published.
 */
export default function WorkerShiftsPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;

  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const devImp = getDevImpersonation();
  const realRole = tenantInfo?.currentRole as "OWNER" | "MANAGER" | "WORKER" | undefined;
  const realBranchId = tenantInfo?.currentBranchId ?? null;
  const effectiveBranchId =
    isDev() && realRole === "OWNER" && devImp.enabled ? devImp.branchId || realBranchId || null : realBranchId;
  const isImpersonating = isDev() && realRole === "OWNER" && devImp.enabled && devImp.branchId != null;

  const currentWeekStart = useMemo(() => getCurrentWeekStartISO(), []);
  const nextWeekStart = useMemo(() => getNextWeekStartISO(), []);

  const [weekChoice, setWeekChoice] = useState<"this" | "next">("this");
  const weekStart = weekChoice === "this" ? currentWeekStart : nextWeekStart;

  const weekShiftsArgs = useMemo(
    () => ({
      tenantId,
      weekStart,
      ...(isImpersonating && effectiveBranchId ? { branchId: effectiveBranchId as Id<"branches"> } : {}),
    }),
    [tenantId, weekStart, isImpersonating, effectiveBranchId]
  );
  const weekData = useQuery(api.schedule.workerGetWeek, weekShiftsArgs);

  const slotsByDay = useMemo(() => {
    if (!weekData || !weekData.published || !weekData.mySlots) return [] as { dayOfWeek: number; dayName: string; slots: { dayOfWeek: number; startMin: number; endMin: number; label?: string }[] }[];
    const mySlots = weekData.mySlots;
    const byDay = new Map<number, (typeof mySlots)[number][]>();
    for (const s of mySlots) {
      const list = byDay.get(s.dayOfWeek) ?? [];
      list.push(s);
      byDay.set(s.dayOfWeek, list);
    }
    return DAY_NAMES.map((name, i) => ({
      dayOfWeek: i,
      dayName: name,
      slots: byDay.get(i) ?? ([] as (typeof mySlots)[number][]),
    })).filter((g) => g.slots.length > 0);
  }, [weekData]);

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">My shifts</h1>
        <p className="dashboard-subtitle">View your assigned shifts for the week</p>
      </header>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
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
      </div>

      {weekData === undefined ? (
        <section
          style={{
            padding: "1.5rem",
            background: "white",
            border: "1px solid var(--border)",
            borderRadius: "0.75rem",
          }}
        >
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>Loading…</div>
        </section>
      ) : !weekData.published ? (
        <section
          style={{
            padding: "1.5rem",
            background: "white",
            border: "1px solid var(--border)",
            borderRadius: "0.75rem",
          }}
        >
          <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Schedule not published
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            Your manager will publish the schedule when it&apos;s ready.
          </div>
        </section>
      ) : slotsByDay.length === 0 ? (
        <section
          style={{
            padding: "1.5rem",
            background: "white",
            border: "1px solid var(--border)",
            borderRadius: "0.75rem",
          }}
        >
          <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            No shifts assigned yet.
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            Check back when your manager has assigned shifts.
          </div>
        </section>
      ) : (
        <div>
          {weekData.branch && (
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              {weekData.branch.name}
            </div>
          )}
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
                {slots.map((slot, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "1rem",
                      padding: "1rem",
                      minHeight: 44,
                      borderBottom: i < slots.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: "1rem", fontWeight: 600 }}>
                        {formatRange(slot.startMin, slot.endMin)}
                      </span>
                      {slot.label && (
                        <span
                          className="badge badge-warning"
                          style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}
                        >
                          {slot.label}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
