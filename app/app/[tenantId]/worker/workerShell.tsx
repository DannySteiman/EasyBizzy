"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { getDevImpersonation, isDev } from "../../../lib/devImpersonation";

type Role = "OWNER" | "MANAGER" | "WORKER";

export function WorkerShell({ children }: { children: ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const tenantId = params.tenantId as Id<"tenants">;

  // Real membership info (authoritative on server)
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.getBranches, { tenantId });

  const [impTick, setImpTick] = useState(0);

  useEffect(() => {
    if (!isDev()) return;
    const handler = () => setImpTick((x) => x + 1);
    window.addEventListener("storage", handler);
    window.addEventListener("easybizzy-dev-impersonation-change", handler as any);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("easybizzy-dev-impersonation-change", handler as any);
    };
  }, []);

  const realRole = (tenantInfo?.currentRole as Role | undefined) ?? undefined;
  const realBranchId = (tenantInfo?.currentBranchId as string | null | undefined) ?? null;

  const devImp = useMemo(() => {
    void impTick;
    return getDevImpersonation();
  }, [impTick]);

  const effectiveRole: Role | undefined = useMemo(() => {
    if (isDev() && realRole === "OWNER" && devImp.enabled && devImp.role) {
      return devImp.role as Role;
    }
    return realRole;
  }, [devImp.enabled, devImp.role, realRole]);

  const effectiveBranchId = useMemo(() => {
    if (isDev() && realRole === "OWNER" && devImp.enabled) {
      return devImp.branchId || realBranchId || null;
    }
    return realBranchId;
  }, [devImp.branchId, devImp.enabled, realBranchId, realRole]);

  const branchName = useMemo(() => {
    if (!effectiveBranchId || !Array.isArray(branches)) return null;
    return branches.find((b) => String(b._id) === String(effectiveBranchId))?.name ?? null;
  }, [branches, effectiveBranchId]);

  // Role gating for worker routes
  useEffect(() => {
    if (!effectiveRole) return;
    if (effectiveRole !== "WORKER") {
      router.replace(`/app/${tenantId}/manager/home`);
    }
  }, [effectiveRole, router, tenantId]);

  // Loading
  if (tenantInfo === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (effectiveRole !== "WORKER") {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Redirecting...</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { href: `/app/${tenantId}/worker/home`, label: "Home", icon: "🏠" },
    { href: `/app/${tenantId}/worker/tips`, label: "Tips", icon: "💸" },
    { href: `/app/${tenantId}/worker/tasks`, label: "Tasks", icon: "✅" },
    { href: `/app/${tenantId}/worker/products`, label: "Products", icon: "🧾" },
    { href: `/app/${tenantId}/worker/settings`, label: "Settings", icon: "⚙️" },
  ] as const;

  return (
    <div className="dashboard-container" style={{ paddingBottom: 88 }}>
      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>My location</div>
        <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>
          {branchName ?? (effectiveBranchId ? "Assigned location" : "All locations")}
        </div>
      </div>

      {children}

      {/* Bottom tabs (worker only) */}
      <nav
        aria-label="Worker navigation"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "white",
          borderTop: "1px solid var(--border)",
          padding: "0.5rem 0.5rem 0.75rem",
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "0.25rem",
          }}
        >
          {tabs.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                style={{
                  minHeight: 44,
                  borderRadius: 12,
                  textDecoration: "none",
                  color: active ? "white" : "var(--foreground)",
                  background: active ? "var(--primary)" : "transparent",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  padding: "0.25rem 0.25rem",
                  fontSize: "0.6875rem",
                  fontWeight: active ? 700 : 600,
                }}
              >
                <span aria-hidden style={{ fontSize: "1.125rem", lineHeight: 1 }}>
                  {t.icon}
                </span>
                <span style={{ lineHeight: 1 }}>{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

