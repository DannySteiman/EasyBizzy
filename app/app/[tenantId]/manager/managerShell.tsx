"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { getDevImpersonation, isDev } from "../../../lib/devImpersonation";

type Role = "OWNER" | "MANAGER" | "WORKER";

export function ManagerShell({ children }: { children: ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const tenantId = params.tenantId as Id<"tenants">;

  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });

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

  // Role gating for manager routes (UI-only)
  useEffect(() => {
    if (!effectiveRole) return;
    if (effectiveRole === "WORKER") {
      router.replace(`/app/${tenantId}/worker/home`);
      return;
    }
    if (effectiveRole !== "OWNER" && effectiveRole !== "MANAGER") {
      router.replace("/");
    }
  }, [effectiveRole, router, tenantId]);

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

  if (effectiveRole !== "OWNER" && effectiveRole !== "MANAGER") {
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
    { href: `/app/${tenantId}/manager/home`, label: "Dashboard", icon: "🏠" },
    { href: `/app/${tenantId}/manager/team`, label: "Team", icon: "👥" },
    { href: `/app/${tenantId}/manager/branches`, label: "Locations", icon: "📍" },
    { href: `/app/${tenantId}/manager/schedule`, label: "Shifts", icon: "📅" },
    { href: `/app/${tenantId}/manager/receipts`, label: "Receipts", icon: "🧾" },
    { href: `/app/${tenantId}/manager/settings`, label: "Settings", icon: "⚙️" },
  ] as const;

  return (
    <div className="dashboard-container" style={{ paddingBottom: 88 }}>
      {children}

      <nav
        aria-label="Manager navigation"
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
            gridTemplateColumns: "repeat(6, 1fr)",
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
                  fontSize: "0.625rem",
                  fontWeight: active ? 800 : 600,
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

