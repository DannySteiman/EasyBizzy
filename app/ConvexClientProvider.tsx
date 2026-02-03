"use client";

import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import { useAuth, useUser } from "@clerk/nextjs";
import { ReactNode } from "react";

// Get the Convex URL from environment
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Log for debugging
if (typeof window !== "undefined") {
  if (!convexUrl) {
    console.warn(
      "[Convex] NEXT_PUBLIC_CONVEX_URL is not set!\n" +
      "Create a .env.local file with:\n" +
      "NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud"
    );
  } else {
    console.log("[Convex] Connecting to:", convexUrl);
  }
}

// Create the Convex client
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

/**
 * Convex Client Provider with Clerk Authentication
 * 
 * This provider integrates Clerk authentication with Convex.
 * When a user signs in with Clerk, their JWT is automatically
 * passed to Convex for authentication.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Show error if Convex URL is not configured
  if (!convex) {
    return (
      <div style={{ 
        padding: "2rem", 
        textAlign: "center",
        fontFamily: "system-ui, sans-serif" 
      }}>
        <h1 style={{ color: "#dc2626", marginBottom: "1rem" }}>
          Convex Not Configured
        </h1>
        <p style={{ marginBottom: "1rem" }}>
          Please create a <code>.env.local</code> file in your project root with:
        </p>
        <pre style={{ 
          background: "#f3f4f6", 
          padding: "1rem", 
          borderRadius: "0.5rem",
          display: "inline-block",
          textAlign: "left"
        }}>
          NEXT_PUBLIC_CONVEX_URL=https://posh-lark-832.convex.cloud
        </pre>
        <p style={{ marginTop: "1rem", color: "#6b7280", fontSize: "0.875rem" }}>
          Then restart the Next.js dev server (npm run dev:frontend)
        </p>
      </div>
    );
  }
  
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

// =============================================================================
// AUTH HOOKS (now using Clerk)
// =============================================================================

/**
 * Hook to get current user authentication state
 * Uses Clerk's useUser hook
 */
export function useAuthUser(): {
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string | null;
} {
  const { isLoaded, isSignedIn, user } = useUser();
  
  return {
    isLoading: !isLoaded,
    isAuthenticated: !!isSignedIn,
    userId: user?.id ?? null,
  };
}

/**
 * Hook for sign-in functionality
 * In Clerk, we redirect to the sign-in page
 */
export function useSignIn() {
  return {
    signIn: () => {
      window.location.href = "/sign-in";
    },
  };
}
