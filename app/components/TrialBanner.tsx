"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import Link from "next/link";

/**
 * Trial Banner Component
 * Shows trial status and days remaining for trialing users
 */
export function TrialBanner() {
  const trialStatus = useQuery(api.tenants.getTrialStatus);

  // Don't show if not trialing or still loading
  if (!trialStatus || !trialStatus.isTrialing) {
    return null;
  }

  // Trial expired
  if (trialStatus.isExpired) {
    return (
      <div style={{
        background: "#fef2f2",
        borderBottom: "1px solid #fecaca",
        padding: "0.75rem 1rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "0.875rem",
      }}>
        <div style={{ color: "#991b1b" }}>
          <strong>Your free trial has expired.</strong>
          {" "}Upgrade now to continue using all features.
        </div>
        <Link 
          href="/pricing" 
          style={{
            background: "#dc2626",
            color: "white",
            padding: "0.375rem 0.75rem",
            borderRadius: "0.375rem",
            textDecoration: "none",
            fontSize: "0.75rem",
            fontWeight: "500",
          }}
        >
          Upgrade Now
        </Link>
      </div>
    );
  }

  // Trial active
  const daysRemaining = trialStatus.daysRemaining ?? 0;
  const urgentColor = daysRemaining <= 3;
  
  return (
    <div style={{
      background: urgentColor ? "#fef3c7" : "#ecfdf5",
      borderBottom: `1px solid ${urgentColor ? "#fcd34d" : "#a7f3d0"}`,
      padding: "0.75rem 1rem",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: "0.875rem",
    }}>
      <div style={{ color: urgentColor ? "#92400e" : "#065f46" }}>
        <strong>Free Trial:</strong>
        {" "}{daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining
        {urgentColor && " - Upgrade soon to keep your workspace!"}
      </div>
      <Link 
        href="/pricing" 
        style={{
          background: urgentColor ? "#f59e0b" : "#10b981",
          color: "white",
          padding: "0.375rem 0.75rem",
          borderRadius: "0.375rem",
          textDecoration: "none",
          fontSize: "0.75rem",
          fontWeight: "500",
        }}
      >
        View Plans
      </Link>
    </div>
  );
}
