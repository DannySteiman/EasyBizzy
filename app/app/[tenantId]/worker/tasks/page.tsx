"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

type Status = "TODO" | "DONE";

export default function WorkerTasksPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.getBranches, { tenantId });

  const devImp = getDevImpersonation();
  const realRole = (tenantInfo?.currentRole as "OWNER" | "MANAGER" | "WORKER" | undefined) ?? undefined;
  const realBranchId = (tenantInfo?.currentBranchId as string | null | undefined) ?? null;
  const effectiveBranchId =
    isDev() && realRole === "OWNER" && devImp.enabled ? devImp.branchId || realBranchId || null : realBranchId;

  const branchName = useMemo(() => {
    if (!effectiveBranchId || !Array.isArray(branches)) return null;
    return branches.find((b) => String(b._id) === String(effectiveBranchId))?.name ?? null;
  }, [branches, effectiveBranchId]);

  const [todayDone, setTodayDone] = useState(false);

  const weekly = [
    { day: "Monday", items: [{ title: "Restock front station", status: "TODO" as Status }] },
    { day: "Tuesday", items: [{ title: "Sanitize equipment", status: "DONE" as Status }] },
  ];

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Tasks</h1>
        <p className="dashboard-subtitle">Stay on top of your week</p>
      </header>

      <WorkerCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700 }}>Today</div>
            <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 6 }}>
              Main task (placeholder)
            </div>
          </div>
          <StatusChip status={todayDone ? "DONE" : "TODO"} />
        </div>

        <div
          style={{
            marginTop: "0.75rem",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "0.75rem",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "center",
            minHeight: 64,
          }}
        >
          <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
            Clean and reset your station
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500, marginTop: 2 }}>
              Location: {branchName ?? (effectiveBranchId ? "Assigned location" : "All locations")}
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ minHeight: 44, whiteSpace: "nowrap" }}
            onClick={() => setTodayDone(true)}
            disabled={todayDone}
          >
            Mark as done
          </button>
        </div>
      </WorkerCard>

      <WorkerCard>
        <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>This week</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {weekly.map((g) => (
            <div key={g.day}>
              <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.5rem" }}>{g.day}</div>
              <div className="action-list" style={{ gap: "0.5rem" }}>
                {g.items.map((it) => (
                  <div key={it.title} className="action-item" style={{ padding: "0.75rem 1rem" }}>
                    <span className="action-icon">🧩</span>
                    <span className="action-content">
                      <span className="action-label">{it.title}</span>
                      <span className="action-description">Placeholder</span>
                    </span>
                    <StatusChip status={it.status} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </WorkerCard>
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

function StatusChip({ status }: { status: Status }) {
  const isDone = status === "DONE";
  return (
    <span
      className="badge"
      style={{
        background: isDone ? "#dcfce7" : "#fef3c7",
        color: isDone ? "#166534" : "#92400e",
        alignSelf: "center",
        whiteSpace: "nowrap",
      }}
    >
      {isDone ? "Done" : "To do"}
    </span>
  );
}

