import type { InstallationDestination } from '../../../core/installations/destinations.js';
import type { InstallationScope } from '../../../core/installations/model.js';
import type { CatalogResource } from '../../../core/resources/model.js';

export interface PendingDashboardAction {
  action: 'install' | 'update' | 'uninstall' | 'remove-unmanaged' | 'preview';
  resource: CatalogResource;
  scope?: InstallationScope;
  destinations?: readonly InstallationDestination[];
  ref?: string;
  forceRetry?: boolean;
  ghForceRetry?: boolean;
  ghForceAgent?: string;
  ghForceAgents?: string[];
  conflict?: { category: string; paths: string[]; message?: string };
}
