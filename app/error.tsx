"use client";

/**
 * PAGE-LEVEL ERROR BOUNDARY
 * =========================
 * Catches uncaught errors in any page under the root layout.
 * Shows a recovery UI instead of a blank crash screen.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#f9fafb",
        padding: "1rem",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "1rem",
          padding: "2rem",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⚠️</div>
        <h1
          style={{
            fontSize: "1.25rem",
            fontWeight: 800,
            marginBottom: "0.5rem",
            color: "#111827",
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            fontSize: "0.875rem",
            color: "#6b7280",
            marginBottom: "1.5rem",
          }}
        >
          {error?.message || "An unexpected error occurred. Please try again."}
        </p>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={reset}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 8,
              border: "none",
              background: "#111827",
              color: "white",
              fontWeight: 700,
              fontSize: "0.9375rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => (window.location.href = "/")}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "white",
              color: "#111827",
              fontWeight: 600,
              fontSize: "0.9375rem",
              cursor: "pointer",
            }}
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}
