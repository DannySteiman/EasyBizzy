"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

/**
 * WORKER HOME PAGE
 * ================
 * 
 * Default destination for WORKER role.
 * 
 * Placeholder page - in production this would:
 * - Show worker-specific dashboard
 * - Display assigned tasks/orders
 * - Provide operational actions
 */
export default function WorkerHomePage() {
  const params = useParams();
  const tenantId = params.tenantId as Id<"tenants">;
  
  // Get tenant details
  const tenantInfo = useQuery(api.tenants.getTenant, { tenantId });

  return (
    <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        Worker Dashboard
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "2rem" }}>
        Welcome! Here are your tasks and assignments.
      </p>

      {/* Worker info */}
      <div className="card" style={{ textAlign: "left", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "1rem" }}>
          Your Assignment
        </h2>
        <div style={{ fontSize: "0.875rem" }}>
          <p style={{ marginBottom: "0.5rem" }}>
            <strong>Workspace:</strong> {tenantInfo?.tenant?.name || "—"}
          </p>
          <p style={{ marginBottom: "0.5rem" }}>
            <strong>Your Role:</strong> {tenantInfo?.currentRole || "—"}
          </p>
          <p>
            <strong>Branch:</strong>{" "}
            {tenantInfo?.currentBranchId ? "Assigned Branch" : "All Branches"}
          </p>
        </div>
      </div>

      {/* Placeholder actions */}
      <div className="card" style={{ textAlign: "left" }}>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "1rem" }}>
          Quick Actions (Placeholder)
        </h2>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.75rem"
        }}>
          <button className="btn btn-primary" disabled>
            New Order
          </button>
          <button className="btn btn-secondary" disabled>
            View Queue
          </button>
          <button className="btn btn-secondary" disabled>
            My Tasks
          </button>
        </div>
      </div>

      {/* Placeholder task list */}
      <div className="card" style={{ marginTop: "1rem", textAlign: "left" }}>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "1rem" }}>
          Today&apos;s Tasks (Placeholder)
        </h2>
        <div style={{ 
          padding: "2rem", 
          textAlign: "center",
          color: "var(--muted)",
          fontSize: "0.875rem"
        }}>
          No tasks assigned yet. Check back later!
        </div>
      </div>
    </div>
  );
}
