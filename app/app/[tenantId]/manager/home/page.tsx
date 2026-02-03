"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import Link from "next/link";

/**
 * OWNER DASHBOARD (Mobile-First MVP)
 * ===================================
 * 
 * Primary landing page for OWNER and MANAGER roles after:
 * - Trial creation
 * - Successful paid subscription
 * - Successful onboarding
 * 
 * Mobile-first design following the UI Contract:
 * - 360px minimum width
 * - 44px minimum tap targets
 * - Cards and vertical lists only
 * - No tables, no hover interactions
 * 
 * @see docs/ui-contract.md
 */
export default function OwnerDashboardPage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;
  
  // Fetch tenant and subscription data
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });
  const branches = useQuery(api.branches.getBranches, { tenantId });
  const members = useQuery(api.tenants.getTenantMembers, { tenantId });

  // Loading state
  if (tenantInfo === undefined) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const tenant = tenantInfo?.tenant;
  const branchCount = branches?.length ?? 0;
  const memberCount = members?.length ?? 0;
  
  // Determine subscription display
  const planTier = tenant?.planTier ?? "BASIC";
  const subscriptionStatus = tenant?.subscriptionStatus ?? "inactive";
  const isTrialing = subscriptionStatus === "trialing";
  const isActive = subscriptionStatus === "active" || isTrialing;

  // Format subscription status for display
  const getStatusLabel = () => {
    switch (subscriptionStatus) {
      case "active": return "Active";
      case "trialing": return "Trial";
      case "past_due": return "Past Due";
      case "canceled": return "Canceled";
      default: return "Inactive";
    }
  };

  const getStatusBadgeClass = () => {
    switch (subscriptionStatus) {
      case "active": return "badge-success";
      case "trialing": return "badge-warning";
      case "past_due": return "badge-error";
      default: return "badge-warning";
    }
  };

  return (
    <div className="dashboard-container">
      {/* ========== HEADER ========== */}
      <header className="dashboard-header">
        <h1 className="dashboard-title">{tenant?.name ?? "My Workspace"}</h1>
        <p className="dashboard-subtitle">Overview</p>
      </header>

      {/* ========== METRIC CARDS ========== */}
      <section className="dashboard-metrics">
        {/* Branches */}
        <div className="metric-card">
          <span className="metric-label">Branches</span>
          <span className="metric-value">{branchCount}</span>
          {branchCount === 0 && (
            <span className="metric-hint">No branches yet</span>
          )}
        </div>

        {/* Team Members */}
        <div className="metric-card">
          <span className="metric-label">Team members</span>
          <span className="metric-value">{memberCount}</span>
          {memberCount <= 1 && (
            <span className="metric-hint">Just you for now</span>
          )}
        </div>

        {/* Active Plan */}
        <div className="metric-card">
          <span className="metric-label">Active plan</span>
          <span className="metric-value">{planTier}</span>
        </div>

        {/* Subscription Status */}
        <div className="metric-card">
          <span className="metric-label">Subscription</span>
          <span className={`badge ${getStatusBadgeClass()}`}>
            {getStatusLabel()}
          </span>
        </div>
      </section>

      {/* ========== QUICK ACTIONS ========== */}
      <section className="dashboard-actions">
        <h2 className="section-title">Quick actions</h2>
        
        <nav className="action-list">
          {/* Manage Team */}
          <Link 
            href={`/app/${tenantId}/manager/team`} 
            className="action-item"
          >
            <span className="action-icon">👥</span>
            <span className="action-content">
              <span className="action-label">Manage team</span>
              <span className="action-description">
                {memberCount <= 1 
                  ? "Add your first team member" 
                  : `${memberCount} member${memberCount !== 1 ? "s" : ""}`
                }
              </span>
            </span>
            <span className="action-chevron">›</span>
          </Link>

          {/* View Shifts */}
          <Link 
            href={`/app/${tenantId}/manager/shifts`} 
            className="action-item"
          >
            <span className="action-icon">📅</span>
            <span className="action-content">
              <span className="action-label">View shifts</span>
              <span className="action-description">Schedule and manage shifts</span>
            </span>
            <span className="action-chevron">›</span>
          </Link>

          {/* View Receipts */}
          <Link 
            href={`/app/${tenantId}/manager/receipts`} 
            className="action-item"
          >
            <span className="action-icon">🧾</span>
            <span className="action-content">
              <span className="action-label">View receipts</span>
              <span className="action-description">Transaction history</span>
            </span>
            <span className="action-chevron">›</span>
          </Link>

          {/* Settings */}
          <Link 
            href={`/app/${tenantId}/manager/settings`} 
            className="action-item"
          >
            <span className="action-icon">⚙️</span>
            <span className="action-content">
              <span className="action-label">Settings</span>
              <span className="action-description">Workspace preferences</span>
            </span>
            <span className="action-chevron">›</span>
          </Link>
        </nav>
      </section>

      {/* ========== EARLY-STAGE HINT (for new tenants) ========== */}
      {memberCount <= 1 && branchCount <= 1 && (
        <section className="dashboard-hint">
          <p className="hint-text">
            🚀 <strong>Getting started?</strong> Add team members to begin collaborating.
          </p>
          <Link 
            href={`/app/${tenantId}/manager/team`}
            className="btn btn-primary hint-cta"
          >
            Add team member
          </Link>
        </section>
      )}

      {/* ========== SUBSCRIPTION ALERT (if needed) ========== */}
      {!isActive && (
        <section className="dashboard-alert">
          <p className="alert-text">
            Your subscription is {subscriptionStatus}. Some features may be limited.
          </p>
          <Link href="/pricing" className="btn btn-primary alert-cta">
            View plans
          </Link>
        </section>
      )}
    </div>
  );
}
