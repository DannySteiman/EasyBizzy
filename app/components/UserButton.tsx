"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useState } from "react";

/**
 * User Button Component
 * Compact avatar button with dropdown menu for sign out and navigation
 */
export function UserButton() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn) {
    return null;
  }

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      window.location.href = "/";
    } catch (error) {
      console.error("Sign out error:", error);
      setIsSigningOut(false);
    }
  };

  const handleGoHome = () => {
    window.location.href = "/";
  };

  const initial = user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "U";

  return (
    <div style={{ position: "relative" }}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "2.5rem",
          height: "2.5rem",
          borderRadius: "50%",
          background: "#3b82f6",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: "600",
          fontSize: "1rem",
          border: "2px solid transparent",
          cursor: "pointer",
          transition: "border-color 0.15s"
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = "#93c5fd"}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = "transparent"}
      >
        {initial}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop to close menu */}
          <div 
            onClick={() => setIsOpen(false)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99
            }}
          />
          
          {/* Menu */}
          <div style={{
            position: "absolute",
            top: "calc(100% + 0.5rem)",
            right: 0,
            background: "white",
            borderRadius: "0.5rem",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            minWidth: "200px",
            zIndex: 100,
            overflow: "hidden"
          }}>
            {/* User Info */}
            <div style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid #e5e7eb",
              fontSize: "0.875rem"
            }}>
              <div style={{ fontWeight: "500" }}>
                {user?.firstName || "User"}
              </div>
              <div style={{ color: "#6b7280", fontSize: "0.75rem" }}>
                {user?.emailAddresses?.[0]?.emailAddress}
              </div>
            </div>

            {/* Menu Items */}
            <div style={{ padding: "0.25rem 0" }}>
              <button
                onClick={handleGoHome}
                style={{
                  width: "100%",
                  padding: "0.5rem 1rem",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  color: "#374151"
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                Go to Home
              </button>
              
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                style={{
                  width: "100%",
                  padding: "0.5rem 1rem",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: isSigningOut ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  color: "#dc2626",
                  opacity: isSigningOut ? 0.7 : 1
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                {isSigningOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
