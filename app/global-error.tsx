"use client";

/**
 * GLOBAL ERROR BOUNDARY
 * =====================
 * Catches uncaught errors in the root layout (ClerkProvider, ConvexClientProvider, etc.)
 * Must include <html> and <body> since it replaces the root layout on error.
 *
 * Common causes:
 * - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set in production env vars
 * - NEXT_PUBLIC_CONVEX_URL not set or wrong
 * - Network failure during Clerk/Convex initialization
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isMissingClerkKey =
    error?.message?.toLowerCase().includes("publishablekey") ||
    error?.message?.toLowerCase().includes("clerk");

  const isMissingConvex =
    error?.message?.toLowerCase().includes("convex") ||
    error?.message?.toLowerCase().includes("next_public_convex_url");

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
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

          {isMissingClerkKey && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "0.5rem",
                padding: "0.75rem",
                marginBottom: "1rem",
                fontSize: "0.875rem",
                color: "#991b1b",
              }}
            >
              <strong>Authentication not configured.</strong>
              <br />
              <code
                style={{ fontSize: "0.8125rem", wordBreak: "break-all" }}
              >
                NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
              </code>{" "}
              is missing from environment variables.
            </div>
          )}

          {isMissingConvex && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "0.5rem",
                padding: "0.75rem",
                marginBottom: "1rem",
                fontSize: "0.875rem",
                color: "#991b1b",
              }}
            >
              <strong>Database not configured.</strong>
              <br />
              <code
                style={{ fontSize: "0.8125rem", wordBreak: "break-all" }}
              >
                NEXT_PUBLIC_CONVEX_URL
              </code>{" "}
              is missing or incorrect.
            </div>
          )}

          {!isMissingClerkKey && !isMissingConvex && (
            <p
              style={{
                fontSize: "0.875rem",
                color: "#6b7280",
                marginBottom: "1rem",
              }}
            >
              {error?.message || "An unexpected error occurred."}
            </p>
          )}

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
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
