"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

/**
 * ONBOARDING PAGE
 * ===============
 * 
 * Shown to OWNER after checkout success for new tenants.
 * 
 * Placeholder page - in production this would:
 * - Collect business info
 * - Set up initial configuration
 * - Create first branch details
 * - Add team members
 */
export default function OnboardingPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as Id<"tenants">;
  
  // Get tenant details
  const tenantData = useQuery(api.tenants.getMyActiveTenantAsOwner);

  const handleCompleteOnboarding = () => {
    // In production, this would mark onboarding as complete
    // For now, just redirect to manager dashboard
    router.push(`/app/${tenantId}/manager/home`);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <div className="card">
        <h1 className="title">Welcome to your workspace!</h1>
        <p className="subtitle">
          Let&apos;s get you set up. This is where you&apos;ll configure your business.
        </p>

        {tenantData && (
          <div style={{ 
            background: "#f9fafb", 
            padding: "1rem", 
            borderRadius: "0.5rem",
            marginBottom: "1.5rem",
            textAlign: "left"
          }}>
            <p style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              <strong>Workspace:</strong> {tenantData.tenantName}
            </p>
            <p style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
              <strong>Plan:</strong> {tenantData.planTier}
            </p>
            <p style={{ fontSize: "0.875rem" }}>
              <strong>Status:</strong>{" "}
              <span className="badge badge-success">
                {tenantData.subscriptionStatus}
              </span>
            </p>
          </div>
        )}

        <div style={{ 
          textAlign: "left", 
          marginBottom: "1.5rem",
          padding: "1rem",
          border: "1px dashed var(--border)",
          borderRadius: "0.5rem"
        }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>
            Onboarding Checklist (Placeholder)
          </h3>
          <ul style={{ 
            listStyle: "none", 
            padding: 0,
            fontSize: "0.875rem",
            color: "var(--muted)"
          }}>
            <li style={{ padding: "0.5rem 0" }}>
              ☐ Add business details
            </li>
            <li style={{ padding: "0.5rem 0" }}>
              ☐ Configure your main branch
            </li>
            <li style={{ padding: "0.5rem 0" }}>
              ☐ Invite team members
            </li>
            <li style={{ padding: "0.5rem 0" }}>
              ☐ Set up your menu/products
            </li>
          </ul>
        </div>

        <button 
          className="btn btn-primary"
          onClick={handleCompleteOnboarding}
          style={{ width: "100%" }}
        >
          Skip for Now - Go to Dashboard
        </button>

        <p style={{ 
          marginTop: "1rem", 
          fontSize: "0.75rem", 
          color: "var(--muted)" 
        }}>
          You can complete these steps anytime from your settings.
        </p>
      </div>
    </div>
  );
}
