"use client";

import { useState } from "react";

export default function ManagerReceiptsPage() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Receipts</h1>
        <p className="dashboard-subtitle">Transactions</p>
      </header>

      <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.25rem" }}>Coming soon</div>
        <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
          Receipts and reporting are not available yet.
        </div>
        <button
          className="btn btn-primary"
          style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
          onClick={() => setOpen(true)}
        >
          Learn more
        </button>
      </section>

      {open && (
        <BottomSheet title="Coming soon" onClose={() => setOpen(false)}>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            This page will show receipts and filters (date range, location) in a mobile-friendly list.
          </div>
        </BottomSheet>
      )}
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
            OK
          </button>
        </div>
        <div style={{ marginTop: "0.75rem" }}>{children}</div>
      </div>
    </div>
  );
}

