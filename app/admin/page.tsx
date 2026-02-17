"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { UserButton } from "../components/UserButton";
import Link from "next/link";
import { Id } from "../../convex/_generated/dataModel";

/**
 * ADMIN PAGE (Mother App)
 * =======================
 * 
 * SAAS_ADMIN dashboard for managing all tenants.
 */
export default function AdminPage() {
  const router = useRouter();
  const userInfo = useQuery(api.users.getMyUserInfo);
  const allTenants = useQuery(api.tenants.listAllTenants);
  
  // Mutations and Actions
  const updateTenant = useMutation(api.tenants.adminUpdateTenant);
  const updateTenantSubscription = useMutation(api.tenants.updateTenantSubscription);
  const extendTrial = useMutation(api.tenants.adminExtendTrial);
  const deleteTenant = useAction(api.tenants.adminDeleteTenant); // Action - also deletes Clerk users
  
  // Edit modal state
  const [editingTenant, setEditingTenant] = useState<{
    id: Id<"tenants">;
    name: string;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  
  // Delete confirmation state
  const [deletingTenant, setDeletingTenant] = useState<{
    id: Id<"tenants">;
    name: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Plan/status modal state
  const [billingTenant, setBillingTenant] = useState<{
    id: Id<"tenants">;
    name: string;
    planTier: "BASIC" | "PRO" | "BUSINESS";
    subscriptionStatus: string;
    trialEndsAt?: number;
  } | null>(null);
  const [billingPlan, setBillingPlan] = useState<"BASIC" | "PRO" | "BUSINESS">("BASIC");
  const [billingStatus, setBillingStatus] = useState<string>("inactive");
  const [billingLoading, setBillingLoading] = useState(false);
  const [trialDays, setTrialDays] = useState(7);

  // Redirect non-SAAS_ADMIN users
  useEffect(() => {
    if (userInfo !== undefined && !userInfo?.isSaasAdmin) {
      console.log("[Admin] User is not SAAS_ADMIN, redirecting to /");
      router.push("/");
    }
  }, [userInfo, router]);

  // Handlers
  const handleEditClick = (tenant: { _id: Id<"tenants">; name: string }) => {
    setEditingTenant({ id: tenant._id, name: tenant.name });
    setEditName(tenant.name);
  };

  const handleEditSave = async () => {
    if (!editingTenant || !editName.trim()) return;
    
    setEditLoading(true);
    try {
      await updateTenant({
        tenantId: editingTenant.id,
        name: editName.trim(),
      });
      setEditingTenant(null);
    } catch (error) {
      console.error("Failed to update tenant:", error);
      alert("Failed to update tenant");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteClick = (tenant: { _id: Id<"tenants">; name: string }) => {
    setDeletingTenant({ id: tenant._id, name: tenant.name });
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTenant) return;
    
    setDeleteLoading(true);
    try {
      await deleteTenant({ tenantId: deletingTenant.id });
      setDeletingTenant(null);
    } catch (error) {
      console.error("Failed to delete tenant:", error);
      const message =
        (error as any)?.message ||
        (typeof error === "string" ? error : "") ||
        "Failed to delete tenant";
      alert(message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleBillingClick = (tenant: any) => {
    const rawTier = String(tenant.planTier ?? "BASIC");
    const normalizedTier = (rawTier === "ENTERPRISE" ? "BUSINESS" : rawTier) as "BASIC" | "PRO" | "BUSINESS";
    setBillingTenant({
      id: tenant._id,
      name: tenant.name,
      planTier: normalizedTier,
      subscriptionStatus: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
    });
    setBillingPlan(normalizedTier);
    setBillingStatus(tenant.subscriptionStatus);
    setTrialDays(7);
  };

  const handleBillingSave = async () => {
    if (!billingTenant) return;
    setBillingLoading(true);
    try {
      // Manual "upgrade" from trial should become active immediately.
      const nextStatus =
        billingStatus === "trialing" && (billingPlan === "PRO" || billingPlan === "BUSINESS")
          ? "active"
          : billingStatus;

      await updateTenantSubscription({
        tenantId: billingTenant.id,
        planTier: billingPlan,
        subscriptionStatus: nextStatus as any,
      });
      setBillingTenant(null);
    } catch (error) {
      console.error("Failed to update billing:", error);
      alert("Failed to update billing");
    } finally {
      setBillingLoading(false);
    }
  };

  const handleExtendTrial = async () => {
    if (!billingTenant) return;
    setBillingLoading(true);
    try {
      await extendTrial({ tenantId: billingTenant.id, days: trialDays });
      setBillingTenant(null);
    } catch (error) {
      console.error("Failed to extend trial:", error);
      alert("Failed to extend trial");
    } finally {
      setBillingLoading(false);
    }
  };

  // Loading state
  if (userInfo === undefined) {
    return (
      <div className="page-center">
        <div className="card">
          <div className="spinner" />
          <p className="subtitle">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  // Not authenticated or not SAAS_ADMIN
  if (!userInfo || !userInfo.isSaasAdmin) {
    return (
      <div className="page-center">
        <div className="card">
          <h1 className="title">Access Denied</h1>
          <p className="subtitle">
            This page is only accessible to system administrators.
          </p>
          <Link href="/" className="btn btn-primary">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        <Link
          href="/"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          Switch to Workspace
        </Link>
      </div>
      {/* Billing Modal */}
      {billingTenant && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
        >
          <div className="card" style={{ maxWidth: "520px", width: "90%", textAlign: "left" }}>
            <h2 style={{ marginBottom: "0.25rem", fontWeight: "700" }}>Billing & Support</h2>
            <p style={{ marginBottom: "1rem", color: "var(--muted)", fontSize: "0.875rem" }}>
              {billingTenant.name}
            </p>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <label style={{ display: "grid", gap: "0.375rem" }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Plan</span>
                <select
                  value={billingPlan}
                  onChange={(e) => {
                    const nextPlan = e.target.value as "BASIC" | "PRO" | "BUSINESS";
                    setBillingPlan(nextPlan);
                    // UX: if upgrading paid tier while currently trialing, default to active.
                    if (billingStatus === "trialing" && (nextPlan === "PRO" || nextPlan === "BUSINESS")) {
                      setBillingStatus("active");
                    }
                  }}
                  style={{
                    width: "100%",
                    minHeight: 44,
                    padding: "0 0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "0.5rem",
                    background: "white",
                  }}
                >
                  <option value="BASIC">BASIC</option>
                  <option value="PRO">PRO</option>
                  <option value="BUSINESS">BUSINESS</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: "0.375rem" }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Subscription status</span>
                <select
                  value={billingStatus}
                  onChange={(e) => setBillingStatus(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 44,
                    padding: "0 0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "0.5rem",
                    background: "white",
                  }}
                >
                  <option value="trialing">trialing</option>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                  <option value="past_due">past_due</option>
                  <option value="canceled">canceled</option>
                </select>
              </label>

              {billingTenant.subscriptionStatus === "trialing" && (
                <div style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", borderRadius: "0.75rem", padding: "0.75rem" }}>
                  <div style={{ fontWeight: 700, color: "#065f46" }}>Extend trial</div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={trialDays}
                      onChange={(e) => setTrialDays(Number(e.target.value))}
                      style={{
                        width: 120,
                        minHeight: 44,
                        padding: "0 0.75rem",
                        border: "1px solid #d1d5db",
                        borderRadius: "0.5rem",
                      }}
                    />
                    <span style={{ color: "#065f46", fontSize: "0.875rem" }}>days</span>
                    <button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={handleExtendTrial} disabled={billingLoading}>
                      Extend
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-secondary" onClick={() => setBillingTenant(null)} disabled={billingLoading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleBillingSave} disabled={billingLoading}>
                {billingLoading ? "Saving..." : "Save"}
              </button>
            </div>

            <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--muted)" }}>
              Note: passwords are managed by Clerk and cannot be viewed.
            </p>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingTenant && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div className="card" style={{ 
            maxWidth: "400px", 
            width: "90%",
            textAlign: "left"
          }}>
            <h2 style={{ marginBottom: "1rem", fontWeight: "600" }}>Edit Tenant</h2>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ 
                display: "block", 
                marginBottom: "0.5rem",
                fontSize: "0.875rem",
                fontWeight: "500"
              }}>
                Tenant Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                }}
                placeholder="Enter tenant name"
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setEditingTenant(null)}
                disabled={editLoading}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleEditSave}
                disabled={editLoading || !editName.trim()}
              >
                {editLoading ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingTenant && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div className="card" style={{ 
            maxWidth: "400px", 
            width: "90%",
            textAlign: "left"
          }}>
            <h2 style={{ marginBottom: "1rem", fontWeight: "600", color: "#dc2626" }}>
              Delete Tenant
            </h2>
            <p style={{ marginBottom: "1rem" }}>
              Are you sure you want to delete <strong>{deletingTenant.name}</strong>?
            </p>
            <p style={{ 
              marginBottom: "1rem", 
              fontSize: "0.875rem", 
              color: "#dc2626",
              padding: "0.75rem",
              background: "#fef2f2",
              borderRadius: "0.375rem"
            }}>
              This will permanently delete the tenant, all branches, and all user memberships.
              This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setDeletingTenant(null)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#dc2626",
                  color: "white",
                  border: "none",
                  borderRadius: "0.375rem",
                  cursor: deleteLoading ? "not-allowed" : "pointer",
                  opacity: deleteLoading ? 0.7 : 1,
                }}
              >
                {deleteLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="nav-placeholder" style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center" 
      }}>
        <div>
          <strong>Mother App</strong> - SAAS Admin Dashboard
          <span style={{ 
            marginLeft: "1rem", 
            fontSize: "0.75rem", 
            color: "var(--muted)" 
          }}>
            Signed in as {userInfo.email}
          </span>
        </div>
        <UserButton />
      </div>

      <div style={{ maxWidth: "1200px", margin: "2rem auto" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1.5rem" }}>
          All Tenants
        </h1>

        {allTenants === undefined ? (
          <div className="card">
            <div className="spinner" />
            <p className="subtitle">Loading tenants...</p>
          </div>
        ) : allTenants.length === 0 ? (
          <div className="card">
            <h2 className="title">No Tenants Yet</h2>
            <p className="subtitle">
              No customers have signed up yet. Tenants are created when users 
              complete checkout via Polar.
            </p>
          </div>
        ) : (
          <div style={{ 
            display: "grid", 
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))"
          }}>
            {allTenants.map((tenant) => (
              <div key={tenant._id} className="card" style={{ textAlign: "left" }}>
                <div style={{ 
                  display: "flex", 
                  justifyContent: "space-between",
                  alignItems: "start",
                  marginBottom: "0.5rem"
                }}>
                  <h3 style={{ fontWeight: "600" }}>{tenant.name}</h3>
                  <span className={`badge ${
                    tenant.subscriptionStatus === "active" 
                      ? "badge-success" 
                      : tenant.subscriptionStatus === "past_due"
                      ? "badge-warning"
                      : "badge-error"
                  }`}>
                    {tenant.subscriptionStatus}
                  </span>
                </div>
                
                <p style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                  Plan: <strong>{tenant.planTier}</strong>
                </p>
                <p style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                  Members: {tenant.memberCount}
                </p>
                <p style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                  Locations: {(tenant as any).branchCount ?? "—"} • Access emails: {(tenant as any).accessEmailCount ?? "—"}
                </p>
                {tenant.ownerEmail && (
                  <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    Owner email: <span style={{ fontFamily: "monospace" }}>{tenant.ownerEmail}</span>
                  </p>
                )}
                <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  Created: {new Date(tenant.createdAt).toLocaleDateString()}
                </p>
                {tenant.subscriptionStatus === "trialing" && tenant.trialEndsAt && (
                  <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    Trial ends: {new Date(tenant.trialEndsAt).toLocaleDateString()}
                  </p>
                )}
                
                {tenant.polarSubscriptionId && (
                  <p style={{ 
                    fontSize: "0.625rem", 
                    color: "var(--muted)",
                    marginTop: "0.5rem",
                    fontFamily: "monospace"
                  }}>
                    Polar Sub: {tenant.polarSubscriptionId.slice(0, 8)}...
                  </p>
                )}
                
                {/* Action Buttons */}
                <div style={{ 
                  display: "flex", 
                  gap: "0.5rem", 
                  marginTop: "1rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid #e5e7eb"
                }}>
                  <Link
                    href={`/admin/tenants/${tenant._id}`}
                    style={{
                      flex: 1,
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.75rem",
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      border: "1px solid #bfdbfe",
                      borderRadius: "0.375rem",
                      cursor: "pointer",
                      textDecoration: "none",
                      textAlign: "center",
                      lineHeight: "1.5rem",
                    }}
                  >
                    Details
                  </Link>
                  <button
                    onClick={() => handleEditClick(tenant)}
                    style={{
                      flex: 1,
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.75rem",
                      background: "#f3f4f6",
                      color: "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.375rem",
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleBillingClick(tenant)}
                    style={{
                      flex: 1,
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.75rem",
                      background: "#fff7ed",
                      color: "#9a3412",
                      border: "1px solid #fed7aa",
                      borderRadius: "0.375rem",
                      cursor: "pointer",
                    }}
                  >
                    Billing
                  </button>
                  <button
                    onClick={() => handleDeleteClick(tenant)}
                    style={{
                      flex: 1,
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.75rem",
                      background: "#fef2f2",
                      color: "#dc2626",
                      border: "1px solid #fecaca",
                      borderRadius: "0.375rem",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
