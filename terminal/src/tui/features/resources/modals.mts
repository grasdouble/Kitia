import { installationPath, resolveInstallationDestinations } from '../../../core/installations/destinations.js';
import type { InstallationScope } from '../../../core/installations/model.js';
import type { ScanError } from '../../../core/inventory/checks.js';
import type { CatalogResource } from '../../../core/resources/model.js';
import { adaptiveColumnWidths } from '../../../table-layout.js';
import { DASHBOARD_THEME } from '../../colors.js';
import { wrappedShortcutLines } from '../../components/shortcuts/shortcut-lines.mjs';
import type { SourceVersionOption } from '../../contracts.js';
import { fitColumn, fitText, wrapText } from '../../helpers.mjs';
import { modalFrame, choiceGroup, categorizeShortcutHint } from '../../modals.mjs';
import type { PendingDashboardAction } from './types.js';
const { semantic } = DASHBOARD_THEME;

export function optionsModal({
  resource,
  scope,
  scopeChoices,
  destinations,
  focus,
  menuIndex,
  moveMenu,
  replacing,
  scopeError,
  canReview,
  columns,
  ref,
  rows,
}: {
  resource: CatalogResource;
  scope: InstallationScope;
  scopeChoices: InstallationScope[];
  destinations: { label: string; directory: string; tracked: boolean; selected: boolean }[];
  focus: 'scope' | 'destinations' | 'review';
  menuIndex: number | null;
  moveMenu: (direction: -1 | 1) => void;
  replacing: boolean;
  scopeError?: ScanError;
  canReview: boolean;
  columns: number;
  rows: number;
  ref?: string | null;
}) {
  const source = (resource.catalog || '-').toUpperCase();
  const modalWidth = Math.max(20, Math.min(64, columns - 4));
  const contentWidth = modalWidth - 4;
  const compact = rows < 19;
  const scopeIndex = scopeChoices.indexOf(scope);
  const allInstalled = destinations.length > 0 && destinations.every(({ tracked }) => tracked);
  const scopeControl =
    scopeChoices.length === 1
      ? [{ text: 'SCOPE: PROJECT (instructions are project-scoped)', dimColor: true }]
      : modalWidth >= 34
        ? [choiceGroup('SCOPE', scopeChoices, scopeIndex, focus === 'scope')]
        : scopeChoices.map((choice, index) => ({
            text: `${focus === 'scope' && index === scopeIndex ? '› ' : '  '}[${index === scopeIndex ? 'x' : ' '}] ${choice}`,
            mouseTarget: { type: 'modal-option' as const, group: 'scope' as const, index },
          }));
  const selected = destinations.filter(({ selected }) => selected);
  const names = selected
    .slice(0, 2)
    .map(({ label }) => label)
    .join(', ');
  const extra = selected.length > 2 ? ` +${selected.length - 2}` : '';
  const summary =
    names && names.length + extra.length <= contentWidth - 8 ? `${names}${extra}` : `${selected.length} selected`;
  const frame = modalFrame(
    'INSTALL OPTIONS',
    [
      { text: fitText(`${source} / ${resource.kind}:${resource.id}`, contentWidth) },
      ...(!compact
        ? [
            ...wrapText(resource.description || 'No description available.', contentWidth, 2),
            { text: `License: ${resource.license_status || 'not declared'}`, dimColor: true },
          ]
        : []),
      ...(scopeError
        ? [
            {
              text: `${scope.toUpperCase()} unavailable: ${scopeError.code}`,
              color: semantic.accents.error,
            },
          ]
        : []),
      ...scopeControl,
      ...(replacing
        ? [
            {
              text: `Selected revision will replace the installed resource in ${scope} scope.`,
              color: semantic.inventoryStatus.attention,
            },
          ]
        : [
            { text: 'DESTINATIONS', bold: true },
            {
              text: `${focus === 'destinations' ? '›' : ' '} [ ${summary} ${menuIndex === null ? '▾' : '▴'} ]`,
              bold: focus === 'destinations',
              color: focus === 'destinations' ? semantic.selected : semantic.accents.primary,
              preserveSpacing: true,
              mouseTarget: { type: 'modal-destinations' as const, action: 'toggle' as const },
            },
            ...(!canReview && !scopeError
              ? [
                  {
                    text: allInstalled ? 'All destinations already installed.' : 'Select at least one new destination.',
                    color: semantic.inventoryStatus.attention,
                  },
                ]
              : []),
          ]),
      ...(ref
        ? [
            {
              text: `Selected commit: ${ref}. The catalog pin remains unchanged.`,
              color: semantic.selected,
            },
          ]
        : []),
      {
        text: compact
          ? 'Pinned source audit required.'
          : 'Kitia audits the pinned source before every dashboard install; findings or incomplete coverage block it.',
        color: semantic.accents.warning,
      },
      ...(canReview
        ? [
            {
              text: `${focus === 'review' ? '› ' : ''}[ ${replacing ? 'Review replacement' : 'Review install'} ]`,
              bold: true,
              color: focus === 'review' ? semantic.selected : semantic.accents.primary,
              mouseTarget: { type: 'modal-review' as const },
            },
          ]
        : []),
      ...(!compact
        ? [
            {
              text:
                menuIndex === null
                  ? 'TAB MOVE · ENTER / SPACE ACTIVATE · ESC BACK'
                  : '↑↓ MOVE · SPACE TOGGLE · TAB / ESC CLOSE',
              dimColor: true,
            },
          ]
        : []),
    ],
    columns,
    semantic.selected,
  );
  if (menuIndex === null) return frame;
  return {
    ...frame,
    destinationMenu: {
      index: menuIndex,
      move: moveMenu,
      items: destinations.map(({ label, directory, selected, tracked }) => ({
        title: tracked ? `${label} [Installed]` : `${selected ? '✓' : '□'} ${label}`,
        directory: `${scope === 'user' ? '~/' : ''}${directory}/`,
        tracked,
      })),
    },
  };
}

export function confirmationModal({
  confirmation,
  selectedButton,
  stage,
  columns,
}: {
  confirmation: PendingDashboardAction;
  selectedButton: number;
  stage: number;
  columns: number;
}) {
  const permanentRemoval = confirmation.action === 'remove-unmanaged' && stage === 2;
  const actionLabel =
    confirmation.action === 'install'
      ? 'Install'
      : confirmation.action === 'update'
        ? 'Update'
        : confirmation.action === 'remove-unmanaged'
          ? permanentRemoval
            ? 'Remove permanently'
            : 'Remove'
          : 'Uninstall';
  const confirmationLabel =
    permanentRemoval && columns < 44 ? (columns < 40 ? 'REMOVE' : 'REMOVE PERMANENT') : actionLabel;
  const conflict = confirmation.conflict;
  const conflictCategory = confirmation.ghForceRetry
    ? 'GitHub CLI reported that the skill is already installed and requires --force to overwrite it.'
    : conflict?.category === 'tracked-modification'
      ? 'Tracked files were locally modified.'
      : conflict?.category === 'untracked-skill-content'
        ? 'Untracked content is present in the skill directory.'
        : 'A local conflict was detected.';
  const conflictPaths = conflict?.paths || [];
  const forceImpact = confirmation.ghForceRetry
    ? "Retry will pass --force to GitHub CLI only; Kitia's local-modification and untracked-content checks still apply."
    : conflict?.category === 'tracked-modification'
      ? 'Forcing will overwrite the locally modified tracked files listed above.'
      : conflict?.category === 'untracked-skill-content'
        ? 'Forcing may replace or remove untracked content in this skill directory.'
        : 'Forcing will overwrite the conflicting local destination files listed above.';
  const targetContext = [
    confirmation.resource.catalog && `catalog ${confirmation.resource.catalog}`,
    confirmation.resource.scope && `scope ${confirmation.resource.scope}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const question = confirmation.ghForceRetry
    ? `GitHub CLI asked to overwrite ${confirmation.resource.kind}:${confirmation.resource.id}${confirmation.ghForceAgent ? ` for ${confirmation.ghForceAgent}` : ''}${targetContext ? ` (${targetContext})` : ''}. Retry with --force?`
    : confirmation.forceRetry
      ? `Conflict detected while updating ${confirmation.resource.kind}:${confirmation.resource.id}${targetContext ? ` (${targetContext})` : ''}. Force update and retry?`
      : confirmation.action === 'install'
        ? `Install ${confirmation.resource.kind}:${confirmation.resource.id}?`
        : confirmation.action === 'update' && confirmation.ref
          ? `Replace the installed ${confirmation.resource.kind}:${confirmation.resource.id} with the selected revision in ${confirmation.resource.scope} scope?`
          : confirmation.action === 'remove-unmanaged'
            ? permanentRemoval
              ? `Permanently remove unmanaged ${confirmation.resource.kind}:${confirmation.resource.id}?`
              : `Remove unmanaged ${confirmation.resource.kind}:${confirmation.resource.id}?`
            : `${actionLabel} ${confirmation.resource.kind}:${confirmation.resource.id} from ${confirmation.resource.scope}?`;
  const removalWarning = permanentRemoval
    ? `This artifact is not managed by a Kitia catalog. This action is irreversible; ${
        confirmation.resource.kind === 'skill' ? 'all data in its skill directory' : 'the artifact file'
      } will be permanently lost.`
    : confirmation.resource.kind === 'skill'
      ? 'Kitia will remove the entire detected skill folder and all of its contents.'
      : 'Kitia will remove the detected artifact file.';
  const updateSafeguard =
    confirmation.resource.kind === 'skill' && confirmation.resource.source_repository
      ? 'The first gh skill install runs without --force. If GH says overwrite requires --force, Kitia asks before retrying; local safety checks apply.'
      : 'This resource update does not use gh --force. Kitia checks local conflicts and asks separately before Kitia force can overwrite them.';
  const paths =
    confirmation.action === 'install'
      ? resolveInstallationDestinations(
          confirmation.resource.kind,
          confirmation.scope ?? 'project',
          confirmation.destinations,
        ).map((layout) => installationPath(layout, confirmation.resource.id))
      : confirmation.action === 'update' || confirmation.action === 'uninstall'
        ? confirmation.resource.paths
        : undefined;
  return modalFrame(
    confirmation.ghForceRetry
      ? 'GH REQUESTS OVERWRITE'
      : confirmation.forceRetry
        ? 'LOCAL CONFLICT'
        : permanentRemoval
          ? 'CONFIRM PERMANENT REMOVAL'
          : `CONFIRM ${actionLabel.toUpperCase()}`,
    [
      question,
      ...(!confirmation.forceRetry && paths?.length
        ? [
            confirmation.action === 'install'
              ? `Selected paths (${confirmation.scope ?? 'project'}):`
              : 'Tracked paths:',
            ...paths.map((path) => `• ${path}`),
          ]
        : []),
      ...(confirmation.forceRetry
        ? [
            conflict?.message || conflictCategory,
            ...(!confirmation.ghForceRetry ? conflictPaths.slice(0, 12).map((item) => `• ${item}`) : []),
            ...(!confirmation.ghForceRetry && conflictPaths.length > 12
              ? [`…and ${conflictPaths.length - 12} more path(s)`]
              : []),
            forceImpact,
          ]
        : confirmation.action === 'install'
          ? [
              ...(confirmation.ref ? [`Selected revision: ${confirmation.ref} (catalog pin unchanged).`] : []),
              'Normal CLI safeguards apply; --force is not used.',
            ]
          : confirmation.action === 'update'
            ? [
                updateSafeguard,
                ...(confirmation.ref ? [`Selected revision: ${confirmation.ref} (catalog pin unchanged).`] : []),
              ]
            : confirmation.action === 'remove-unmanaged'
              ? [removalWarning]
              : confirmation.action === 'uninstall' && confirmation.resource.kind === 'skill'
                ? [
                    'Kitia removes the entire managed skill folder and all of its contents; locally modified tracked files still block uninstall.',
                  ]
                : ['The CLI safety checks apply; locally modified tracked files are protected.']),
      '',
      choiceGroup(
        '',
        [
          { label: confirmation.forceRetry ? 'NO / CANCEL' : 'CANCEL' },
          {
            label: confirmation.forceRetry ? 'YES, RETRY WITH --FORCE' : confirmationLabel,
            color:
              confirmation.forceRetry ||
              confirmation.action === 'uninstall' ||
              confirmation.action === 'remove-unmanaged'
                ? semantic.accents.danger
                : semantic.accents.primary,
          },
        ],
        selectedButton,
      ),
      '←/→ CHOOSE · ENTER CONFIRM · Y/N SHORTCUTS',
    ],
    columns,
    semantic.accents.warning,
  );
}
export function actionFailureModal({ action, message, columns }: { action: string; message: string; columns: number }) {
  const outputLines = message.split(/\r?\n/).filter(Boolean);
  return modalFrame(
    `${action.toUpperCase()} FAILED`,
    [
      { text: 'Kitia could not complete this action.', color: semantic.accents.error, bold: true },
      ...(outputLines.length ? outputLines : ['No error details were provided.']),
      'ENTER / ESC CLOSE',
    ],
    columns,
    semantic.accents.error,
    88,
  );
}

export function sourceVersionsModal({
  resource,
  versions,
  selectedIndex,
  action,
  columns,
  rows,
}: {
  resource: CatalogResource;
  versions: SourceVersionOption[];
  selectedIndex: number;
  action: 'install' | 'update';
  columns: number;
  rows: number;
}) {
  const width = Math.max(20, columns - 4);
  const lineWidth = width - 4;
  const shortcutHint = `↑↓ SELECT · ENTER ${action.toUpperCase()} · ESC BACK`;
  const shortcutsRows = wrappedShortcutLines(categorizeShortcutHint(shortcutHint), width).length + 4;
  const compactContext = rows <= 18;
  const rangeRows = compactContext
    ? 0
    : wrapText(`Showing ${versions.length}-${versions.length} of ${versions.length} commits.`, lineWidth).length;
  const instruction = compactContext ? '' : `Select a commit to ${action}; the catalog pin remains unchanged.`;
  const resourceLabel = `${resource.catalog || 'source'} / ${resource.kind}:${resource.id}`;
  const instructionRows = instruction ? wrapText(instruction, lineWidth) : [];
  const contextBudget = rows - 4 - shortcutsRows - 1 - rangeRows - 1;
  const resourceRows = wrapText(resourceLabel, lineWidth);
  const context = [
    ...(resourceRows.length + instructionRows.length <= contextBudget
      ? resourceRows
      : [fitText(resourceLabel, lineWidth)]),
    ...instructionRows,
  ];
  // Reserve both frames, their gap, and header metadata before sizing the revision viewport.
  const headerRows = context.length + rangeRows;
  const availableRows = rows - 4 - shortcutsRows - 1 - headerRows;
  const gap = availableRows > 1 ? [''] : [];
  const count = Math.max(1, Math.min(14, versions.length, availableRows - gap.length));
  const first = Math.max(0, Math.min(selectedIndex - Math.floor(count / 2), versions.length - count));
  const visible = versions.slice(first, first + count);
  const prefixContentWidth = Math.max(9, ...visible.map(({ prefix }) => prefix.length + 2));
  const subjectContentWidth = Math.max(8, ...visible.map(({ subject }) => subject.length));
  const minimumColumnWidth = Math.max(1, Math.floor((lineWidth - 4) / 3));
  const [prefixWidth, dateWidth, subjectWidth] = adaptiveColumnWidths(
    lineWidth,
    [
      {
        contentWidth: prefixContentWidth,
        minWidth: Math.min(9, minimumColumnWidth),
        maxWidth: prefixContentWidth + 6,
        growWeight: 1,
      },
      {
        contentWidth: 10,
        minWidth: Math.min(8, minimumColumnWidth),
        maxWidth: 10,
        shrinkWeight: 1,
      },
      {
        contentWidth: subjectContentWidth,
        minWidth: Math.min(8, minimumColumnWidth),
        growWeight: 2,
        shrinkWeight: 3,
      },
    ],
    2,
  );
  return modalFrame(
    'RESOURCE REVISIONS',
    [
      ...gap,
      ...visible.map((version, offset) => ({
        text: [
          fitColumn(`${first + offset === selectedIndex ? '›' : ' '} ${version.prefix}`, prefixWidth),
          fitColumn(version.date.slice(0, 10), dateWidth),
          fitText(version.subject, subjectWidth),
        ].join('  '),
        color: first + offset === selectedIndex ? semantic.selected : undefined,
        preserveSpacing: true,
        bold: first + offset === selectedIndex,
      })),
      shortcutHint,
    ],
    columns,
    semantic.selected,
    width,
    [
      ...context,
      ...(!compactContext && versions.length > count
        ? [`Showing ${first + 1}-${first + count} of ${versions.length} commits.`]
        : []),
    ],
  );
}
