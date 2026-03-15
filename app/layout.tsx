import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "EasyBizzy",
  description: "Multi-tenant SaaS foundation for businesses and workspaces",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // Guard: if Clerk key is missing, show a clear config error instead of crashing
  if (!clerkKey) {
    return (
      <html lang="en">
        <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0, background: "#f9fafb", padding: "1rem" }}>
          <div style={{ background: "white", borderRadius: "1rem", padding: "2rem", maxWidth: 420, width: "100%", border: "1px solid #e5e7eb", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⚙️</div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 800, marginBottom: "0.5rem" }}>App not configured</h1>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "1rem" }}>
              The <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> environment variable is missing.
              Add it to your deployment environment variables and redeploy.
            </p>
          </div>
        </body>
      </html>
    );
  }

  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
