import type { CatalogResource } from "../catalog/entries.js";

type RetryAction = {
  action: "install" | "update" | "uninstall" | "remove-unmanaged" | "preview" | "audit";
  resource: CatalogResource;
  scope?: string;
  tool?: string;
  ref?: string;
  forceRetry?: boolean;
  ghForceRetry?: boolean;
  ghForceAgent?: string;
  ghForceAgents?: string[];
  conflict?: { category: string; paths: string[]; message?: string };
};

type RetryPrompt = {
  confirmation: RetryAction;
  message: string;
};
type ActionFailure = {
  code?: string;
  category?: string;
  paths?: string[];
  recoverable?: boolean;
  userMessage?: string;
  agent?: string;
};


export function createForceRetryPrompt(
  requested: RetryAction,
  failure: ActionFailure,
): RetryPrompt | null {
  const ghForceRetry = failure.code === "GH_FORCE_REQUIRED" &&
    typeof failure.agent === "string" && failure.agent.length > 0;
  const alreadyForceRetriedAgent = ghForceRetry && requested.ghForceAgents?.includes(failure.agent as string);
  if (requested.action !== "update" || failure.recoverable !== true ||
      (ghForceRetry
        ? alreadyForceRetriedAgent
        : requested.forceRetry || failure.code !== "LOCAL_CONFLICT")) return null;

  return {
    confirmation: {
      action: "update",
      resource: requested.resource,
      ...(requested.ref ? { ref: requested.ref } : {}),
      forceRetry: true,
      ...(ghForceRetry ? {
        ghForceRetry: true,
        ghForceAgent: failure.agent,
        ghForceAgents: [...(requested.ghForceAgents || []), failure.agent as string],
      } : {}),
      conflict: {
        category: failure.category || (ghForceRetry ? "github-force-required" : "local-conflict"),
        paths: failure.paths || [],
        ...(failure.userMessage ? { message: failure.userMessage } : {}),
      },
    },
    message: ghForceRetry
      ? "GitHub CLI requested overwrite; confirm whether to retry with --force."
      : "Update blocked by a local conflict; choose whether to force and retry.",
  };
}
