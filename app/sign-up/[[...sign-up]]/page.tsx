import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f9fafb",
      flexDirection: "column",
      gap: "0.75rem",
    }}>
      <div
        style={{
          width: "min(92vw, 420px)",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 12,
          padding: "0.75rem",
          fontSize: "0.875rem",
          color: "#1e3a8a",
        }}
      >
        Already used this email before?{" "}
        <Link href="/sign-in" style={{ color: "#1d4ed8", fontWeight: 700, textDecoration: "none" }}>
          Sign in
        </Link>{" "}
        instead of creating a new account.
      </div>
      <SignUp 
        appearance={{
          elements: {
            rootBox: {
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              borderRadius: "0.75rem",
            }
          }
        }}
        afterSignUpUrl="/"
        signInUrl="/sign-in"
      />
    </div>
  );
}
