"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

export default function WorkerTipsPage() {
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

  const [sheet, setSheet] = useState<null | "system" | "report" | "distribution">(null);

  // Placeholder toggle (future capability)
  const tipsEnabled = false;

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Tips</h1>
        <p className="dashboard-subtitle">Your earnings summary</p>
      </header>

      {!tipsEnabled && (
        <WorkerCard>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>Tips are not enabled</div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 6 }}>
            Tips are not enabled for this business.
          </div>
        </WorkerCard>
      )}

      <WorkerCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700 }}>Tip system</div>
            <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 6 }}>
              Tips are shared based on hours worked. (Placeholder)
            </div>
          </div>
          <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setSheet("system")}>
            Details
          </button>
        </div>
      </WorkerCard>

      <WorkerCard>
        <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>My tips</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
          <Metric label="Today" value="$—" />
          <Metric label="This week" value="$—" />
          <Metric label="This month" value="$—" />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
          onClick={() => setSheet("report")}
          disabled={!tipsEnabled}
        >
          Generate my report
        </button>

        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.5rem" }}>
          Location: {branchName ?? (effectiveBranchId ? "Assigned location" : "All locations")}
        </div>
      </WorkerCard>

      <WorkerCard>
        <button
          className="btn btn-secondary"
          style={{ width: "100%", minHeight: 44 }}
          onClick={() => setSheet("distribution")}
          disabled={!tipsEnabled}
        >
          View distribution
        </button>
      </WorkerCard>

      {sheet && (
        <BottomSheet title="Placeholder" onClose={() => setSheet(null)}>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            {sheet === "system" && "Tip system details will appear here."}
            {sheet === "report" && "Report filters (date range, branch) will appear here."}
            {sheet === "distribution" && "Distribution breakdown will appear here."}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "0.75rem" }}>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.125rem", fontWeight: 800, marginTop: 2 }}>{value}</div>
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

