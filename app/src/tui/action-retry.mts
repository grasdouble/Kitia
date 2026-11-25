import type { PendingDashboardAction } from './features/resources/types.js';

type RetryPrompt = {
  confirmation: PendingDashboardAction;
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

export function createForceRetryPrompt(requested: PendingDashboardAction, failure: ActionFailure): RetryPrompt | null {
  const ghForceRetry =
    failure.code === 'GH_FORCE_REQUIRED' && typeof failure.agent === 'string' && failure.agent.length > 0;
  const alreadyForceRetriedDestination = ghForceRetry && requested.ghForceAgents?.includes(failure.agent as string);
  if (
    requested.action !== 'update' ||
    failure.recoverable !== true ||
    (ghForceRetry ? alreadyForceRetriedDestination : requested.forceRetry || failure.code !== 'LOCAL_CONFLICT')
  )
    return null;

  return {
    confirmation: {
      action: 'update',
      resource: requested.resource,
      ...(requested.ref ? { ref: requested.ref } : {}),
      forceRetry: true,
      ...(ghForceRetry
        ? {
            ghForceRetry: true,
            ghForceAgent: failure.agent,
            ghForceAgents: [...(requested.ghForceAgents || []), failure.agent as string],
          }
        : {}),
      conflict: {
        category: failure.category || (ghForceRetry ? 'github-force-required' : 'local-conflict'),
        paths: failure.paths || [],
        ...(failure.userMessage ? { message: failure.userMessage } : {}),
      },
    },
    message: ghForceRetry
      ? 'GitHub CLI requested overwrite; confirm whether to retry with --force.'
      : 'Update blocked by a local conflict; choose whether to force and retry.',
  };
}
