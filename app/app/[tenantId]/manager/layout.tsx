"use client";

import { ReactNode } from "react";
import { ManagerShell } from "./managerShell";

export default function ManagerLayout({ children }: { children: ReactNode }) {
  return <ManagerShell>{children}</ManagerShell>;
}

