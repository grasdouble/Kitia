import type { Key } from 'ink';
import { useState } from 'react';

import {
  availableInstallationDestinations,
  installationPath,
  installationScopes,
  resolveInstallationDestinations,
  type InstallationDestination,
} from '../../../core/installations/destinations.js';
import type { InstallationScope } from '../../../core/installations/model.js';
import type { ScanError } from '../../../core/inventory/checks.js';
import type { CatalogResource } from '../../../core/resources/model.js';
import type { DashboardActionResult } from '../../action-result.js';
import { createForceRetryPrompt } from '../../action-retry.mjs';
import type { DashboardActions, SourceVersionOption } from '../../contracts.js';
import { cycleIndex } from '../../helpers.mjs';
import { yieldToRenderer, type DashboardActivity } from '../activity.mjs';
import { optionsModal, confirmationModal, actionFailureModal, sourceVersionsModal } from './modals.mjs';
import type { PendingDashboardAction } from './types.js';

export function useResourceWorkflow(
  actions: DashboardActions,
  resources: CatalogResource[],
  errors: ScanError[],
  activity: DashboardActivity,
  navigate: (screen: string) => void,
  inspect: (resource: CatalogResource, result: DashboardActionResult) => void,
  { columns, rows }: { columns: number; rows: number },
) {
  const { actionPending, setActionPending, setActionMessage, setLastActionFailed } = activity;
  const setScreenMode = navigate;
  const [installedResources, setInstalledResources] = useState(() => [...resources]);
  const [scanErrors, setScanErrors] = useState(() => [...errors]);
  const [installResource, setInstallResource] = useState<CatalogResource | null>(null);
  const [installScope, setInstallScope] = useState<InstallationScope>('user');
  const [destinationSelections, setDestinationSelections] = useState<
    Partial<Record<InstallationScope, readonly InstallationDestination[]>>
  >({});
  const [installFocus, setInstallFocus] = useState<'scope' | 'destinations' | 'review' | 'cancel'>('scope');
  const [installMenu, setInstallMenu] = useState<{ group: 'scope' | 'destination'; index: number } | null>(null);
  const [confirmation, setConfirmation] = useState<PendingDashboardAction | null>(null);
  const [confirmationChoice, setConfirmationChoice] = useState(0);
  const [confirmationStage, setConfirmationStage] = useState(1);
  const [actionFailure, setActionFailure] = useState<{
    action: string;
    message: string;
    auditLines?: readonly string[];
  } | null>(null);
  const [failurePage, setFailurePage] = useState(0);
  const [sourceVersionPicker, setSourceVersionPicker] = useState<{
    resource: CatalogResource;
    versions: SourceVersionOption[];
    selectedIndex: number;
    action: 'install' | 'update';
  } | null>(null);
  const [installRef, setInstallRef] = useState<string | null>(null);

  const scopeChoices = installResource
    ? installationScopes.filter((scope) => availableInstallationDestinations(installResource.kind, scope).length)
    : [];
  const installed = installResource
    ? installedResources.find(
        (resource) =>
          resource.managed !== false &&
          resource.scope === installScope &&
          resource.catalog === installResource.catalog &&
          resource.kind === installResource.kind &&
          resource.id === installResource.id,
      )
    : undefined;
  const replacing = Boolean(installed && installRef);
  const scopeError = scanErrors.find((error) => error.scope === installScope);
  const selection = installResource
    ? (destinationSelections[installScope] ??
      resolveInstallationDestinations(installResource.kind, installScope).map(({ id }) => id))
    : [];
  const destinationChoices =
    installResource && !replacing
      ? availableInstallationDestinations(installResource.kind, installScope).map((layout) => {
          const path = installationPath(layout, installResource.id);
          const tracked = installed?.paths?.includes(path) ?? false;
          return {
            id: layout.id,
            label: layout.label,
            directory: layout.directory,
            tracked,
            selected: !tracked && selection.includes(layout.id),
          };
        })
      : [];
  const selectedDestinations = destinationChoices.filter(({ selected }) => selected).map(({ id }) => id);
  const canReview = !scopeError && (replacing || selectedDestinations.length > 0);

  const queueForceRetry = (
    requested: PendingDashboardAction,
    failure: {
      code?: string;
      category?: string;
      paths?: string[];
      recoverable?: boolean;
      userMessage?: string;
      agent?: string;
    },
  ): boolean => {
    const prompt = createForceRetryPrompt(requested, failure);
    if (!prompt) return false;
    setConfirmation(prompt.confirmation);
    setConfirmationChoice(0);
    setActionMessage(prompt.message);
    return true;
  };

  const openSourceVersions = async (resource: CatalogResource, action: 'install' | 'update' = 'install') => {
    if (!actions.listSourceVersions || actionPending) return;
    setActionPending(true);
    setActionMessage(`Loading commit history for ${resource.id}...`);
    setActionFailure(null);
    try {
      const versions = await actions.listSourceVersions(resource);
      if (!versions.length) {
        setActionFailure({
          action: 'versions',
          message: `No commits found for ${resource.catalog}:${resource.kind}:${resource.id}.`,
        });
        return;
      }
      setSourceVersionPicker({ resource, versions, selectedIndex: 0, action });
    } catch (error) {
      setActionFailure({
        action: 'versions',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setActionPending(false);
      setActionMessage('');
    }
  };
  const runConfirmedAction = async (requested: PendingDashboardAction) => {
    setActionPending(true);
    setLastActionFailed(false);
    setActionFailure(null);
    setFailurePage(0);
    const inspectionAction = requested.action === 'preview';
    const progressLabel =
      requested.action === 'install'
        ? 'Installing'
        : requested.action === 'update'
          ? 'Updating'
          : requested.action === 'remove-unmanaged'
            ? 'Removing'
            : requested.action === 'uninstall'
              ? 'Uninstalling'
              : 'Previewing';
    const completedLabel =
      requested.action === 'install'
        ? 'Installed'
        : requested.action === 'update'
          ? 'Updated'
          : requested.action === 'remove-unmanaged'
            ? 'Removed'
            : requested.action === 'uninstall'
              ? 'Uninstalled'
              : 'Previewed';
    setActionMessage(`${progressLabel} ${requested.resource.kind}:${requested.resource.id}...`);
    await yieldToRenderer();
    try {
      if (!actions.execute) throw new Error('Dashboard action handler is unavailable.');
      const result = await actions.execute(requested.action, requested.resource, {
        scope: requested.scope,
        destinations: requested.destinations,
        ...(requested.ref ? { ref: requested.ref } : {}),
        ...(requested.forceRetry && !requested.ghForceRetry ? { force: true } : {}),
        ...(requested.ghForceRetry ? { ghForce: true, ghForceAgent: requested.ghForceAgent } : {}),
        onProgress: (message) => setActionMessage(message),
      });
      if (Array.isArray(result.resources)) setInstalledResources([...result.resources]);
      if (Array.isArray(result.errors)) setScanErrors([...result.errors]);
      const outcome = result.messages?.filter(Boolean).join('\n');
      const failed = result.code !== 0;
      setLastActionFailed(failed);
      if (failed) {
        const failure = result.failure;
        if (!failure || !queueForceRetry(requested, failure)) {
          const errorText =
            failure?.userMessage ||
            (requested.action === 'update'
              ? `Update failed (exit ${result.code}); no safe cause details were provided by the action handler.`
              : `Action failed (exit ${result.code}).`);
          setActionFailure({
            action: requested.action,
            message: errorText,
            auditLines: failure?.auditLines,
          });
          setActionMessage(`Action failed${result.code ? ` (exit ${result.code})` : ''}: ${errorText}`);
        }
      } else if (inspectionAction) {
        inspect(requested.resource, result);
      } else {
        setActionMessage(outcome || `${completedLabel} ${requested.resource.kind}:${requested.resource.id}.`);
      }
    } catch (error) {
      const typed = error as Error & {
        code?: string;
        category?: string;
        paths?: string[];
        recoverable?: boolean;
        userMessage?: string;
        agent?: string;
      };
      setLastActionFailed(true);
      if (!queueForceRetry(requested, typed)) {
        const message = typed.userMessage || (error instanceof Error ? error.message : String(error));
        setActionFailure({ action: requested.action, message });
        setActionMessage(`Action failed: ${message}`);
      }
    } finally {
      setActionPending(false);
    }
  };

  const openInstallOptions = (resource: CatalogResource, ref: string | null = null) => {
    setInstallResource(resource);
    setInstallRef(ref);
    const userSupported = availableInstallationDestinations(resource.kind, 'user').length > 0;
    setInstallScope(userSupported ? 'user' : 'project');
    setDestinationSelections({});
    setInstallFocus(userSupported ? 'scope' : 'destinations');
    setInstallMenu(null);
    setScreenMode('install-options');
    setActionMessage('');
  };
  const chooseConfirmation = (choice: number) => {
    if (!confirmation) return;
    if (choice === 0) {
      if (confirmation.action === 'install') setScreenMode('install-options');
      setConfirmation(null);
      setConfirmationStage(1);
      setConfirmationChoice(0);
      return;
    }
    if (actionPending) return;
    if (confirmation.action === 'remove-unmanaged' && confirmationStage === 1) {
      setConfirmationStage(2);
      setConfirmationChoice(0);
      return;
    }
    const requested = confirmation;
    setConfirmation(null);
    setConfirmationStage(1);
    setConfirmationChoice(0);
    if (requested.action === 'install' || (requested.action === 'update' && requested.scope)) {
      setScreenMode('inventory');
      setInstallResource(null);
    }
    void runConfirmedAction(requested);
  };

  const requestConfirmation = (requested: PendingDashboardAction, choice = 0) => {
    setConfirmation(requested);
    setConfirmationChoice(choice);
    setConfirmationStage(1);
    setActionMessage('');
  };
  const handleVersionInput = (input: string, key: Key) => {
    if (!sourceVersionPicker) return;
    if (key.escape) setSourceVersionPicker(null);
    else if (key.upArrow || key.downArrow) {
      setSourceVersionPicker((current) =>
        current
          ? {
              ...current,
              selectedIndex: cycleIndex(current.versions.length, current.selectedIndex, key.upArrow ? -1 : 1),
            }
          : current,
      );
    } else if (key.return) {
      const { resource, versions, selectedIndex, action } = sourceVersionPicker;
      const ref = versions[selectedIndex].sha;
      setSourceVersionPicker(null);
      if (action === 'update') {
        requestConfirmation({ action, resource, ref }, 1);
      } else {
        openInstallOptions(resource, ref);
      }
    }
  };
  const handleConfirmationInput = (input: string, key: Key) => {
    const character = input.toLocaleLowerCase();
    if ((key.ctrl && character === 'c') || key.escape || character === 'n') chooseConfirmation(0);
    else if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
      setConfirmationChoice(confirmationChoice === 0 ? 1 : 0);
    } else if (character === 'y') chooseConfirmation(1);
    else if (key.return) chooseConfirmation(confirmationChoice);
  };
  const reviewOptions = () => {
    if (!installResource || !canReview || installMenu) return;
    setInstallFocus('review');
    if (installed && installRef) {
      requestConfirmation({ action: 'update', resource: installed, scope: installScope, ref: installRef }, 1);
    } else {
      requestConfirmation({
        action: 'install',
        resource: { ...installResource, scope: installScope },
        scope: installScope,
        destinations: selectedDestinations,
        ...(installRef ? { ref: installRef } : {}),
      });
    }
  };
  const cancelOptions = () => {
    setScreenMode('catalog');
    setInstallResource(null);
  };
  const chooseOption = (group: 'scope' | 'destination', index: number) => {
    if (installMenu?.group !== group) return;
    if (group === 'scope') {
      const scope = scopeChoices[index];
      if (!scope) return;
      setInstallScope(scope);
      setInstallFocus('scope');
      setInstallMenu(null);
      return;
    }
    const choice = destinationChoices[index];
    if (!choice) return;
    setInstallMenu({ group, index });
    if (choice.tracked) return;
    setDestinationSelections((current) => {
      const selected = current[installScope] ?? selection;
      return {
        ...current,
        [installScope]: selected.includes(choice.id)
          ? selected.filter((id) => id !== choice.id)
          : [...selected, choice.id],
      };
    });
  };
  const toggleInstallMenu = (group: 'scope' | 'destination') => {
    if (group === 'scope' ? scopeChoices.length < 2 : !destinationChoices.length) return;
    setInstallFocus(group === 'scope' ? 'scope' : 'destinations');
    setInstallMenu((current) => {
      if (current?.group === group) return null;
      if (group === 'scope') return { group, index: scopeChoices.indexOf(installScope) };
      const selected = destinationChoices.findIndex((choice) => choice.selected);
      const available = destinationChoices.findIndex((choice) => !choice.tracked);
      return { group, index: selected >= 0 ? selected : Math.max(0, available) };
    });
  };
  const closeInstallMenu = () => setInstallMenu(null);
  const moveInstallMenu = (direction: -1 | 1) => {
    setInstallMenu((menu) => {
      if (!menu) return null;
      const count = menu.group === 'scope' ? scopeChoices.length : destinationChoices.length;
      return { ...menu, index: Math.max(0, Math.min(count - 1, menu.index + direction)) };
    });
  };
  const handleOptionsInput = (input: string, key: Key) => {
    if (!installResource) return;
    const tab = key.tab || input === '\t';
    if (tab) {
      closeInstallMenu();
      const controls: (typeof installFocus)[] = [];
      if (scopeChoices.length > 1) controls.push('scope');
      if (!replacing) controls.push('destinations');
      if (canReview) controls.push('review');
      controls.push('cancel');
      const index = controls.indexOf(installFocus);
      setInstallFocus(controls[cycleIndex(controls.length, index, key.shift ? -1 : 1)]);
      return;
    }
    if (installMenu) {
      if (key.escape) closeInstallMenu();
      else if (key.upArrow || key.downArrow) moveInstallMenu(key.upArrow ? -1 : 1);
      else if (input === ' ' || (key.return && installMenu.group === 'scope'))
        chooseOption(installMenu.group, installMenu.index);
      return;
    }
    if (key.escape) cancelOptions();
    else if (key.return || input === ' ') {
      if (installFocus === 'scope') toggleInstallMenu('scope');
      else if (installFocus === 'destinations') toggleInstallMenu('destination');
      else if (installFocus === 'review') reviewOptions();
      else if (installFocus === 'cancel') cancelOptions();
    }
  };
  const failureView = actionFailure ? actionFailureModal({ ...actionFailure, page: failurePage, columns, rows }) : null;
  const handleFailureInput = (input: string, key: Key) => {
    if (key.return || key.escape || input === ' ') setActionFailure(null);
    else if (failureView && (key.pageUp || key.pageDown)) {
      const next = failureView.page + (key.pageUp ? -1 : 1);
      setFailurePage(Math.max(0, Math.min(next, failureView.pageCount - 1)));
    }
  };
  const modal = (optionsVisible: boolean) => {
    if (sourceVersionPicker) return sourceVersionsModal({ ...sourceVersionPicker, columns, rows });
    if (failureView) return failureView.frame;
    if (confirmation)
      return confirmationModal({
        confirmation,
        selectedButton: confirmationChoice,
        stage: confirmationStage,
        columns,
      });
    if (optionsVisible && installResource)
      return optionsModal({
        resource: installResource,
        scope: installScope,
        scopeChoices,
        destinations: destinationChoices,
        ref: installRef,
        focus: installFocus,
        menu: installMenu,
        moveMenu: moveInstallMenu,
        replacing,
        scopeError,
        canReview,
        columns,
        rows,
      });
    return null;
  };
  return {
    installedResources,
    scanErrors,
    sourceVersionPicker,
    confirmation,
    actionFailure,
    handleFailureInput,
    openSourceVersions,
    openInstallOptions,
    runConfirmedAction,
    requestConfirmation,
    chooseConfirmation,
    chooseOption,
    toggleInstallMenu,
    closeInstallMenu,
    reviewOptions,
    cancelOptions,
    handleVersionInput,
    handleConfirmationInput,
    handleOptionsInput,
    modal,
  };
}
