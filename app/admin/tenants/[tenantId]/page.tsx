"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useState } from "react";

export default function AdminTenantDetailsPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;

  const userInfo = useQuery(api.users.getMyUserInfo);
  const allTenants = useQuery(api.tenants.listAllTenants);
  const updateSub = useMutation(api.tenants.updateTenantSubscription);
  const extendTrial = useMutation(api.tenants.adminExtendTrial);

  const [sheet, setSheet] = useState<null | "password">(null);

  if (userInfo === undefined || allTenants === undefined) {
    return (
      <div className="page-center">
        <div className="card">
          <div className="spinner" />
          <p className="subtitle">Loading tenant…</p>
        </div>
      </div>
    );
  }

  if (!userInfo?.isSaasAdmin) {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="title">Access Denied</h1>
          <p className="subtitle">This page is only accessible to system administrators.</p>
          <Link href="/" className="btn btn-primary">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  const tenant = allTenants.find((t) => String(t._id) === String(tenantId));

  if (!tenant) {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="title">Tenant not found</h1>
          <p className="subtitle">This tenant may have been deleted.</p>
          <Link href="/admin" className="btn btn-primary">
            Back to Admin
          </Link>
        </div>
      </div>
    );
  }

  const isTrialing = tenant.subscriptionStatus === "trialing";
  const trialEndsAt = tenant.trialEndsAt ?? null;
  const daysRemaining =
    isTrialing && trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000))) : null;

  return (
    <div style={{ padding: "2rem" }}>
      <div className="nav-placeholder" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>Mother App</strong> - Tenant Details
        </div>
        <Link href="/admin" style={{ color: "var(--primary)", textDecoration: "none" }}>
          Back
        </Link>
      </div>

      <div style={{ maxWidth: 900, margin: "2rem auto" }}>
        <div className="card" style={{ textAlign: "left", maxWidth: "unset" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div>
              <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>{tenant.name}</h1>
              <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: 4 }}>
                TenantId: <code>{String(tenant._id)}</code>
              </div>
            </div>
            <span className={`badge ${tenant.subscriptionStatus === "active" ? "badge-success" : tenant.subscriptionStatus === "past_due" ? "badge-warning" : "badge-error"}`}>
              {tenant.subscriptionStatus}
            </span>
          </div>

          <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
            <Info label="Plan" value={tenant.planTier} />
            <Info label="Members" value={String(tenant.memberCount)} />
            <Info label="Locations" value={String((tenant as any).branchCount ?? "—")} />
            <Info label="Access emails" value={String((tenant as any).accessEmailCount ?? "—")} />
            <Info label="Owner email" value={tenant.ownerEmail ?? "—"} />
            <Info label="Created" value={new Date(tenant.createdAt).toLocaleString()} />
          </div>

          {isTrialing && (
            <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 12 }}>
              <strong>Trial</strong>
              <div style={{ fontSize: "0.875rem", color: "#065f46", marginTop: 4 }}>
                Ends in {daysRemaining ?? "—"} day(s)
              </div>
              <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  style={{ minHeight: 44 }}
                  onClick={async () => {
                    await extendTrial({ tenantId, days: 7 });
                  }}
                >
                  Extend trial +7 days
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 44 }}
              onClick={() => {
                navigator.clipboard.writeText(String(tenant._id));
              }}
            >
              Copy tenantId
            </button>
            <button
              className="btn btn-secondary"
              style={{ minHeight: 44 }}
              onClick={() => setSheet("password")}
            >
              Password (info)
            </button>
            <a
              className="btn btn-secondary"
              style={{ minHeight: 44 }}
              href={`/app/${tenant._id}/manager/home`}
              target="_blank"
              rel="noreferrer"
              title="This may require membership; admin access does not bypass tenant membership."
            >
              Open app
            </a>
          </div>

          <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.5rem" }}>Billing actions</div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <button
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                onClick={async () => {
                  await updateSub({ tenantId, subscriptionStatus: "inactive" });
                }}
              >
                Suspend (inactive)
              </button>
              <button
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                onClick={async () => {
                  await updateSub({ tenantId, subscriptionStatus: "active" });
                }}
              >
                Reactivate (active)
              </button>
              <button
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                onClick={async () => {
                  await updateSub({ tenantId, planTier: "BASIC" });
                }}
              >
                Set plan BASIC
              </button>
              <button
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                onClick={async () => {
                  await updateSub({ tenantId, planTier: "PRO", subscriptionStatus: "active" });
                }}
              >
                Set plan PRO
              </button>
              <button
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                onClick={async () => {
                  await updateSub({ tenantId, planTier: "BUSINESS", subscriptionStatus: "active" });
                }}
              >
                Set plan BUSINESS
              </button>
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: "0.5rem" }}>
              Tip: manual plan/status overrides may be overwritten by Polar webhooks later.
            </div>
          </div>
        </div>
      </div>

      {sheet === "password" && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "1rem",
            zIndex: 2000,
          }}
          onClick={() => setSheet(null)}
        >
          <div className="card" style={{ textAlign: "left", maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: "0.5rem" }}>About passwords</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
              Passwords are managed by Clerk and are not stored in Convex. For security reasons, passwords cannot be
              viewed. Use Clerk to reset a user’s password or send a login link.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => setSheet(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "0.75rem" }}>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.9375rem", fontWeight: 800, marginTop: 2, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

