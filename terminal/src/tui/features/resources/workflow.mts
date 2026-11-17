import type { Key } from 'ink';
import { useState } from 'react';

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
) {
  const { actionPending, setActionPending, setActionMessage, setLastActionFailed } = activity;
  const setScreenMode = navigate;
  const [installedResources, setInstalledResources] = useState(() => [...resources]);
  const [scanErrors, setScanErrors] = useState(() => [...errors]);
  const [installResource, setInstallResource] = useState<CatalogResource | null>(null);
  const [installScope, setInstallScope] = useState('project');
  const [installTool, setInstallTool] = useState('copilot');
  const [installFocus, setInstallFocus] = useState(0);
  const [confirmation, setConfirmation] = useState<PendingDashboardAction | null>(null);
  const [confirmationChoice, setConfirmationChoice] = useState(0);
  const [confirmationStage, setConfirmationStage] = useState(1);
  const [actionFailure, setActionFailure] = useState<{ action: string; message: string } | null>(null);
  const [sourceVersionPicker, setSourceVersionPicker] = useState<{
    resource: CatalogResource;
    versions: SourceVersionOption[];
    selectedIndex: number;
    action: 'install' | 'update';
  } | null>(null);
  const [installRef, setInstallRef] = useState<string | null>(null);

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
        tool: requested.tool,
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
          setActionFailure({ action: requested.action, message: errorText });
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

  const openInstallOptions = (resource: CatalogResource) => {
    setInstallResource(resource);
    setInstallRef(null);
    setInstallScope('project');
    setInstallTool('copilot');
    setInstallFocus(resource.kind === 'instruction' ? 1 : 0);
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
    if (requested.action === 'install') setScreenMode('inventory');
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
        setConfirmation({ action, resource, ref });
        setConfirmationChoice(1);
        setConfirmationStage(1);
        setActionMessage('');
      } else {
        const installedScopes = ['project', 'user'].filter((scope) =>
          installedResources.some(
            (installed) =>
              installed.scope === scope &&
              installed.catalog === resource.catalog &&
              installed.kind === resource.kind &&
              installed.id === resource.id,
          ),
        );
        if (installedScopes.length === 1) {
          const scope = installedScopes[0];
          setConfirmation({ action: 'update', resource: { ...resource, scope }, scope, ref });
          setConfirmationChoice(1);
          setConfirmationStage(1);
          setActionMessage('');
        } else {
          setInstallResource(resource);
          setInstallRef(ref);
          setInstallScope('project');
          setInstallTool('copilot');
          setInstallFocus(0);
          setScreenMode('install-options');
          setActionMessage('');
        }
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
  const handleOptionsInput = (input: string, key: Key) => {
    if (!installResource) return;
    if (key.escape) setScreenMode('catalog');
    else if (key.tab) {
      setInstallFocus(installResource.kind === 'instruction' ? 1 : installFocus === 0 ? 1 : 0);
    } else if ((key.upArrow || key.downArrow) && installResource.kind !== 'instruction') {
      setInstallFocus(installFocus === 0 ? 1 : 0);
    } else if (key.leftArrow || key.rightArrow) {
      const scopeFocused = installFocus === 0 && installResource.kind !== 'instruction';
      const choices = scopeFocused ? ['project', 'user'] : ['copilot', 'claude', 'both'];
      const current = scopeFocused ? installScope : installTool;
      const offset = key.rightArrow ? 1 : -1;
      const index = cycleIndex(choices.length, choices.indexOf(current), offset);
      if (scopeFocused) setInstallScope(choices[index]);
      else setInstallTool(choices[index]);
    } else if (key.return) {
      const alreadyInstalled = installedResources.some(
        (resource) =>
          resource.scope === installScope &&
          resource.catalog === installResource.catalog &&
          resource.kind === installResource.kind &&
          resource.id === installResource.id,
      );
      const scopeError = scanErrors.find((error) => error.scope === installScope);
      if ((!alreadyInstalled || installRef) && !scopeError) {
        const replacement = alreadyInstalled && Boolean(installRef);
        setConfirmation({
          action: replacement ? 'update' : 'install',
          resource: { ...installResource, scope: installScope },
          scope: installScope,
          tool: installTool,
          ...(installRef ? { ref: installRef } : {}),
        });
        setConfirmationChoice(replacement ? 1 : 0);
      }
    }
  };
  const chooseOption = (group: 'scope' | 'client', index: number) => {
    if (!installResource) return;
    if (group === 'scope') {
      const choices = installResource.kind === 'instruction' ? ['project'] : ['project', 'user'];
      setInstallScope(choices[Math.min(index, choices.length - 1)]);
      setInstallFocus(0);
    } else {
      setInstallTool(['copilot', 'claude', 'both'][Math.min(index, 2)]);
      setInstallFocus(1);
    }
  };
  const modal = (columns: number, rows: number, optionsVisible: boolean) => {
    if (sourceVersionPicker) return sourceVersionsModal({ ...sourceVersionPicker, columns, rows });
    if (actionFailure) return actionFailureModal({ ...actionFailure, columns });
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
        tool: installTool,
        ref: installRef,
        focus: installFocus,
        resources: installedResources,
        errors: scanErrors,
        columns,
      });
    return null;
  };
  return {
    installedResources,
    scanErrors,
    sourceVersionPicker,
    confirmation,
    actionFailure,
    dismissFailure: () => setActionFailure(null),
    openSourceVersions,
    openInstallOptions,
    runConfirmedAction,
    requestConfirmation,
    chooseConfirmation,
    chooseOption,
    handleVersionInput,
    handleConfirmationInput,
    handleOptionsInput,
    modal,
  };
}
