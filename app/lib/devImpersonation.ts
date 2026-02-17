export type DevImpersonationRole = "OWNER" | "MANAGER" | "WORKER";

const KEY_ENABLED = "easybizzy.dev.impersonate.enabled";
const KEY_ROLE = "easybizzy.dev.impersonate.role";
const KEY_BRANCH_ID = "easybizzy.dev.impersonate.branchId";

export function isDev(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_ENABLE_DEV_IMPERSONATION === "true"
  );
}

export function getDevImpersonation(): {
  enabled: boolean;
  role?: DevImpersonationRole;
  branchId?: string;
} {
  // Fail closed: never enable outside dev + explicit flag.
  if (!isDev()) {
    return { enabled: false };
  }

  if (typeof window === "undefined") {
    return { enabled: false };
  }

  try {
    const enabled = window.localStorage.getItem(KEY_ENABLED) === "1";
    if (!enabled) return { enabled: false };

    const role = window.localStorage.getItem(KEY_ROLE) as DevImpersonationRole | null;
    const branchIdRaw = window.localStorage.getItem(KEY_BRANCH_ID);

    const roleOk = role === "OWNER" || role === "MANAGER" || role === "WORKER";
    const branchId = branchIdRaw && branchIdRaw.trim().length > 0 ? branchIdRaw.trim() : undefined;

    if (!roleOk) {
      return { enabled: false };
    }

    return { enabled: true, role, branchId };
  } catch {
    return { enabled: false };
  }
}

export function setDevImpersonation(params: {
  enabled: boolean;
  role?: DevImpersonationRole;
  branchId?: string;
}) {
  if (!isDev()) return;
  if (typeof window === "undefined") return;

  try {
    if (!params.enabled) {
      clearDevImpersonation();
      return;
    }

    // Only allow OWNER / MANAGER / WORKER (dev-only UI routing)
    const role = params.role;
    if (role !== "OWNER" && role !== "MANAGER" && role !== "WORKER") {
      // Treat invalid as disabled (fail closed)
      clearDevImpersonation();
      return;
    }

    window.localStorage.setItem(KEY_ENABLED, "1");
    window.localStorage.setItem(KEY_ROLE, role);
    window.localStorage.setItem(KEY_BRANCH_ID, params.branchId?.trim() || "");
  } catch {
    // ignore
  }
}

export function clearDevImpersonation() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_ENABLED, "0");
    window.localStorage.removeItem(KEY_ROLE);
    window.localStorage.removeItem(KEY_BRANCH_ID);
  } catch {
    // ignore
  }
}

