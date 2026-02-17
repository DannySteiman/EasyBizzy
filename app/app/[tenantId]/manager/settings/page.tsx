"use client";

import { useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";

export default function ManagerSettingsPage() {
  const { isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState<null | "coming_soon">(null);

  const name = user?.fullName || user?.firstName || "—";
  const email = user?.primaryEmailAddress?.emailAddress || "—";

  return (
    <div>
      <header className="dashboard-header">
        <h1 className="dashboard-title">Settings</h1>
        <p className="dashboard-subtitle">Account</p>
      </header>

      <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.75rem" }}>My profile</div>
        <Row label="Name" value={isLoaded ? name : "Loading..."} />
        <Row label="Email" value={isLoaded ? email : "Loading..."} />
      </section>

      <section className="metric-card" style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.25rem" }}>Workspace preferences</div>
        <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
          Coming soon.
        </div>
        <button
          className="btn btn-secondary"
          style={{ width: "100%", minHeight: 44, marginTop: "0.75rem" }}
          onClick={() => setOpen("coming_soon")}
        >
          Learn more
        </button>
      </section>

      <section className="metric-card">
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
      </section>

      {open && (
        <BottomSheet title="Coming soon" onClose={() => setOpen(null)}>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            Settings will include workspace preferences and notifications.
          </div>
        </BottomSheet>
      )}
    </div>
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

