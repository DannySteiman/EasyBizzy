"use client";

import { ReactNode } from "react";
import { WorkerShell } from "./workerShell";

export default function WorkerLayout({ children }: { children: ReactNode }) {
  return <WorkerShell>{children}</WorkerShell>;
}

