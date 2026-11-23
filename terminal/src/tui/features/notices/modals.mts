import { DASHBOARD_THEME } from '../../colors.js';
import { sectionNavigationHints } from '../../components/shortcuts/shortcut-lines.mjs';
import type { DashboardSelfUpdate } from '../../contracts.js';
import { choiceGroup, modalFrame } from '../../modals.mjs';
const { semantic } = DASHBOARD_THEME;
const MODAL_FOREGROUND = semantic.modal.foreground;

export function inventoryMigrationModal({ scopes, columns }: { scopes: string[]; columns: number }) {
  const affectedScopes = [...new Set(scopes.filter((scope) => ['project', 'user'].includes(scope)))];
  const scopeLabel = affectedScopes.length === 2 ? 'project and user inventories' : `${affectedScopes[0]} inventory`;
  return modalFrame(
    'INVENTORY MIGRATION REQUIRED',
    [
      {
        text: `Migration is required for the ${scopeLabel}.`,
        color: semantic.accents.warning,
        bold: true,
      },
      ...affectedScopes.map((scope) => ({
        text: `${scope.toUpperCase()} inventory needs migration.`,
        color: scope === 'user' ? semantic.selected : MODAL_FOREGROUND,
        bold: true,
      })),
      '',
      'Run this from the current project directory:',
      {
        text: 'npx --yes @grasdouble/kitia migrate --apply',
        color: semantic.selected,
        bold: true,
      },
      'It checks project and home inventories, skipping ones already current.',
      'Restart the dashboard after migration.',
      '',
      { text: '[ EXIT DASHBOARD ]', color: semantic.selected, bold: true },
      'ENTER / ESC TO EXIT',
    ],
    columns,
    semantic.accents.warning,
    96,
  );
}

export function onboardingModal(step: number) {
  const navigation = sectionNavigationHints.join(' · ');
  const tour = [
    {
      title: '1/3 · INVENTORY',
      description:
        'Your installed resources live here. The highlighted list shows status, scope, kind, and catalog; move the selection to inspect an item.',
      shortcut: `${navigation} · ↑ / ↓ move · F filter · D details`,
    },
    {
      title: '2/3 · CATALOG',
      description:
        'Browse resources available to install. Select a resource with Enter to choose its scope and runtime before installing.',
      shortcut: `${navigation} · F filter · C catalog · K kind · Enter select`,
    },
    {
      title: '3/3 · CATALOG MANAGEMENT',
      description:
        'Manage the GitHub catalogs that supply resources. Refreshing updates the catalog index; it does not change installed resources.',
      shortcut: `${navigation} · A add · E edit · R refresh · Delete remove`,
    },
  ][step];
  return modalFrame(
    tour.title,
    [
      tour.description,
      '',
      tour.shortcut,
      '',
      step < 2 ? 'ENTER / SPACE / → NEXT · ← BACK · ESC FINISH' : 'ENTER / SPACE / ← BACK · ESC FINISH',
    ],
    76,
    semantic.accents.warning,
    76,
  );
}

export function versionAvailableModal(
  installedVersion: string,
  availableVersion: string,
  changelogUrl: string,
  columns: number,
  selfUpdate: DashboardSelfUpdate | null | undefined,
  selected: number,
) {
  return modalFrame(
    'NEW VERSION AVAILABLE',
    [
      'A newer version of Kitia is available.',
      '',
      `Installed: ${installedVersion}`,
      `Available: ${availableVersion}`,
      '',
      'Changelog for this version:',
      changelogUrl,
      '',
      ...(selfUpdate
        ? [
            `Update the global installation with ${selfUpdate.manager}, then restart Kitia.`,
            choiceGroup('', ['Later', 'Update'], selected),
            'U UPDATE | ENTER SELECT | ESC CLOSE',
          ]
        : [
            selfUpdate === undefined
              ? 'Checking the global installation…'
              : 'If self-update is unavailable, use your original installer or rerun npx or pnpm dlx with @grasdouble/kitia@latest.',
            'ENTER / ESC CLOSE',
          ]),
    ],
    columns,
    semantic.accents.success,
    76,
  );
}
