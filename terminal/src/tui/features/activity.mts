import { useState } from "react";

export function useDashboardActivity() {
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [lastActionFailed, setLastActionFailed] = useState(false);
  return { actionPending, setActionPending, actionMessage, setActionMessage, lastActionFailed, setLastActionFailed };
}
export type DashboardActivity = ReturnType<typeof useDashboardActivity>;

export function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
