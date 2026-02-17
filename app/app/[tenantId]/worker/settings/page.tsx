"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useClerk, useUser } from "@clerk/nextjs";
import { getDevImpersonation, isDev } from "../../../../lib/devImpersonation";

export default function WorkerSettingsPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;

  const { isLoaded, user } = useUser();
  const { signOut } = useClerk();

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

  const displayName = user?.fullName || user?.firstName || "—";
  const email = user?.primaryEmailAddress?.emailAddress || "—";

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Settings</h1>
        <p className="dashboard-subtitle">Your account</p>
      </header>

      <WorkerCard>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.75rem" }}>My profile</div>
        <Row label="Name" value={isLoaded ? displayName : "Loading..."} />
        <Row label="Email" value={isLoaded ? email : "Loading..."} />
      </WorkerCard>

      <WorkerCard>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.75rem" }}>My branch</div>
        <Row
          label="Location"
          value={branchName ?? (effectiveBranchId ? "Assigned location" : "All locations")}
        />
      </WorkerCard>

      <WorkerCard>
        <button
          className="btn btn-secondary"
          style={{ width: "100%", minHeight: 44, color: "var(--error)" }}
          onClick={async () => {
            await signOut();
            window.location.href = "/";
          }}
        >
          Log out
        </button>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.75rem 0",
        borderTop: "1px solid var(--border)",
        minHeight: 44,
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: "0.875rem", fontWeight: 700, textAlign: "right" }}>{value}</div>
    </div>
  );
}

