"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getCurrentWeekStartISO } from "../../../../lib/weekUtils";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
 * WORKER HOME PAGE
 * ================
 * 
 * Default destination for WORKER role.
 */
export default function WorkerHomePage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;
  
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.getBranches, { tenantId });
  const currentWeekStart = useMemo(() => getCurrentWeekStartISO(), []);
  const devImp = getDevImpersonation();
  const realRole = (tenantInfo?.currentRole as "OWNER" | "MANAGER" | "WORKER" | undefined) ?? undefined;
  const realBranchId = (tenantInfo?.currentBranchId as string | null | undefined) ?? null;
  const effectiveBranchId =
    isDev() && realRole === "OWNER" && devImp.enabled ? devImp.branchId || realBranchId || null : realBranchId;

  const isImpersonating = isDev() && realRole === "OWNER" && devImp.enabled && devImp.branchId != null;

  const weekShiftsArgs = useMemo(
    () => ({
      tenantId,
      weekStart: currentWeekStart,
      ...(isImpersonating && effectiveBranchId ? { branchId: effectiveBranchId as Id<"branches"> } : {}),
    }),
    [tenantId, currentWeekStart, isImpersonating, effectiveBranchId]
  );
  const weekShifts = useQuery(api.schedule.workerGetWeek, weekShiftsArgs);

  const branchName = useMemo(() => {
    if (!effectiveBranchId || !Array.isArray(branches)) return null;
    return branches.find((b) => String(b._id) === String(effectiveBranchId))?.name ?? null;
  }, [branches, effectiveBranchId]);

  const [sheet, setSheet] = useState<null | "week" | "daily" | "update" | "chat">(null);
  const [dayChoice, setDayChoice] = useState<"today" | "tomorrow">("today");

  const mySlotCount = weekShifts?.published && weekShifts.mySlots ? weekShifts.mySlots.length : 0;
  const shiftsByDay = useMemo(() => {
    if (!weekShifts?.published || !weekShifts.mySlots) return new Map<number, number>();
    const map = new Map<number, number>();
    for (const s of weekShifts.mySlots) {
      map.set(s.dayOfWeek, (map.get(s.dayOfWeek) ?? 0) + 1);
    }
    return map;
  }, [weekShifts?.published, weekShifts?.mySlots]);

  const upcomingSlots = useMemo(() => {
    if (!weekShifts?.published || !weekShifts.mySlots) return [];
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const slots = weekShifts.mySlots
      .map((s) => ({
        dayOfWeek: s.dayOfWeek,
        dayName: DAY_NAMES[s.dayOfWeek] ?? "",
        startMin: s.startMin,
        endMin: s.endMin,
        label: s.label,
      }))
      .filter((s) => s.dayOfWeek > todayDow || (s.dayOfWeek === todayDow && s.endMin > currentMin))
      .sort((a, b) => {
        if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
        return a.startMin - b.startMin;
      });
    return slots.slice(0, 2);
  }, [weekShifts?.published, weekShifts?.mySlots]);

  const announcements = [
    { id: "a1", title: "New procedure: closing checklist", date: "Feb 4" },
    { id: "a2", title: "Reminder: update availability by Friday", date: "Feb 3" },
  ];

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Home</h1>
        <p className="dashboard-subtitle">Your day at a glance</p>
      </header>

      {/* A) This week */}
      <WorkerCard>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 600 }}>This week</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: 2 }}>
              {!weekShifts?.published
                ? "Schedule not published yet"
                : `Your shifts: ${mySlotCount}`}
            </div>
          </div>
          <Link
            href={`/app/${tenantId}/worker/shifts`}
            className="btn btn-secondary"
            style={{ minHeight: 44, padding: "0.25rem 0.75rem", textDecoration: "none", lineHeight: "44px" }}
          >
            View
          </Link>
        </div>

        <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.25rem" }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
            const count = shiftsByDay.get(i) ?? 0;
            return (
              <div
                key={d}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "0.5rem 0.25rem",
                  textAlign: "center",
                  fontSize: "0.75rem",
                  color: count > 0 ? "var(--foreground)" : "var(--muted)",
                }}
              >
                <div style={{ fontWeight: 700, color: "var(--foreground)" }}>{d}</div>
                <div style={{ marginTop: 2 }}>{count > 0 ? count : "—"}</div>
              </div>
            );
          })}
        </div>
      </WorkerCard>

      {/* B) Upcoming shifts */}
      <WorkerCard>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.5rem" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600 }}>My upcoming shifts</div>
          <Link
            href={`/app/${tenantId}/worker/shifts`}
            className="btn btn-secondary"
            style={{ minHeight: 44, padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}
          >
            View all shifts
          </Link>
        </div>
        <div className="action-list" style={{ gap: "0.5rem" }}>
          {!weekShifts?.published ? (
            <div className="action-item" style={{ justifyContent: "center", color: "var(--muted)" }}>
              Schedule not published yet.
            </div>
          ) : upcomingSlots.length === 0 ? (
            <div className="action-item" style={{ justifyContent: "center", color: "var(--muted)" }}>
              No shifts assigned yet.
            </div>
          ) : (
            upcomingSlots.map((s, i) => (
              <div key={i} className="action-item" style={{ padding: "0.75rem 1rem" }}>
                <span className="action-icon">🗓️</span>
                <span className="action-content">
                  <span className="action-label">
                    {s.dayName} • {formatRange(s.startMin, s.endMin)}
                  </span>
                  <span className="action-description">
                    {s.label ?? (branchName ?? (effectiveBranchId ? "Assigned location" : ""))}
                  </span>
                </span>
                <span className="action-chevron">›</span>
              </div>
            ))
          )}
        </div>
      </WorkerCard>

      {/* C) Availability */}
      <WorkerCard>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 600 }}>Availability</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: 2 }}>
              Set your availability for next week.
            </div>
          </div>
        </div>
        <Link
          href={`/app/${tenantId}/worker/availability`}
          className="btn btn-primary"
          style={{ display: "block", width: "100%", minHeight: 44, marginTop: "0.75rem", textAlign: "center", lineHeight: "44px" }}
        >
          Update availability
        </Link>
      </WorkerCard>

      {/* D) Today selector */}
      <WorkerCard>
        <div style={{ fontSize: "1rem", fontWeight: 600 }}>Today</div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, minHeight: 44, background: dayChoice === "today" ? "var(--secondary)" : "white" }}
            onClick={() => setDayChoice("today")}
          >
            Today
          </button>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, minHeight: 44, background: dayChoice === "tomorrow" ? "var(--secondary)" : "white" }}
            onClick={() => setDayChoice("tomorrow")}
          >
            Tomorrow
          </button>
        </div>
        <button
          className="btn btn-primary"
          style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
          onClick={() => setSheet("daily")}
        >
          View daily shifts
        </button>
      </WorkerCard>

      {/* E) Updates */}
      <WorkerCard>
        <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Updates</div>
        <div className="action-list" style={{ gap: "0.5rem" }}>
          {announcements.map((a) => (
            <button
              key={a.id}
              className="action-item"
              style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => setSheet("update")}
            >
              <span className="action-icon">📣</span>
              <span className="action-content">
                <span className="action-label">{a.title}</span>
                <span className="action-description">{a.date}</span>
              </span>
              <span className="action-chevron">›</span>
            </button>
          ))}
        </div>
      </WorkerCard>

      {/* F) Ask EasyBizzy */}
      <WorkerCard>
        <div style={{ fontSize: "1rem", fontWeight: 600 }}>Ask EasyBizzy</div>
        <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: 2 }}>
          Company info, procedures, products, and help.
        </div>
        <button
          className="btn btn-primary"
          style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
          onClick={() => setSheet("chat")}
        >
          Open chat
        </button>
      </WorkerCard>

      {sheet && (
        <BottomSheet title="Placeholder" onClose={() => setSheet(null)}>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            {sheet === "week" && "Week details will appear here."}
            {sheet === "daily" && `Daily shifts for ${dayChoice === "today" ? "today" : "tomorrow"} will appear here.`}
            {sheet === "update" && "Announcement details will appear here."}
            {sheet === "chat" && "Chat will appear here."}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function WorkerCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid var(--border)",
        borderRadius: "0.75rem",
        padding: "1rem",
        marginBottom: "0.75rem",
      }}
    >
      {children}
    </section>
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
