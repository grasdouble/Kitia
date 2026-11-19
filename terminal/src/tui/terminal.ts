import readline from 'node:readline';

import type { ScanError } from '../core/inventory/checks.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import { matchesSearchText } from '../core/resources/search.js';
import { resolveCatalogResource } from '../core/resources/selection.js';
import { adaptiveColumnWidths, type ColumnWidthRule } from '../table-layout.js';
import { DASHBOARD_THEME } from './colors.js';
import type { DashboardActions } from './contracts.js';

type TerminalColor = Exclude<keyof typeof DASHBOARD_THEME.terminalAnsi, 'palette'>;
type InstalledColumnWidths = {
  scope: number;
  catalog: number;
  kind: number;
  id: number;
  status: number;
  description: number;
  compact: boolean;
};

function fitColumn(value: unknown, width: number): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(text);
  const fitted = characters.length <= width ? text : `${characters.slice(0, Math.max(0, width - 3)).join('')}...`;
  return fitted.padEnd(width);
}

interface Keypress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

type TerminalInput = NodeJS.ReadStream & { isRaw?: boolean };
type TerminalOutput = NodeJS.WriteStream;

function catalogColumnWidths(resources: CatalogResource[], width: number | undefined, markerWidth = 0): number[] {
  const contentWidth = (header: string, value: (resource: CatalogResource) => unknown) =>
    resources.reduce((maximum, resource) => Math.max(maximum, String(value(resource) || '').length), header.length);
  const kindWidth = contentWidth('KIND', (resource) => resource.kind);
  const catalogWidth = contentWidth('CATALOG', (resource) => resource.catalog);
  const idWidth = contentWidth('ID', (resource) => resource.id);
  const statusWidth = contentWidth('STATUS', (resource) => resource.status || '-');
  const compact = typeof width === 'number' && Number.isFinite(width) && width < 58;
  const rules: ColumnWidthRule[] = [
    {
      contentWidth: catalogWidth,
      minWidth: compact ? 7 : catalogWidth,
      growWeight: 1,
      shrinkWeight: 1,
    },
    { contentWidth: kindWidth, minWidth: kindWidth, shrinkWeight: 0 },
    { contentWidth: idWidth, minWidth: compact ? 6 : idWidth, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: statusWidth, minWidth: statusWidth, shrinkWeight: 0 },
    {
      contentWidth: contentWidth('DESCRIPTION', (resource) => resource.description),
      minWidth: 12,
      growWeight: 2,
      shrinkWeight: 4,
    },
  ];
  const naturalWidth = rules.reduce((sum, rule) => sum + rule.contentWidth, rules.length - 1);
  const availableWidth =
    typeof width === 'number' && Number.isFinite(width) ? Math.max(1, width - markerWidth) : naturalWidth;
  return adaptiveColumnWidths(availableWidth, rules);
}

function formatCatalogHeader(columns: number[], markerWidth = 0, color = supportsColor()): string {
  const labels = ['CATALOG', 'KIND', 'ID', 'STATUS', 'DESCRIPTION'];
  return (
    ' '.repeat(markerWidth) +
    labels.map((label, index) => colorize(fitColumn(label, columns[index]), 'bold', color)).join(' ')
  );
}

function formatCatalogRow(resource: CatalogResource, columns: number[], marker = '', color = supportsColor()): string {
  const statusColor =
    resource.status === 'experimental'
      ? DASHBOARD_THEME.semantic.catalogStatus.experimental
      : resource.status === 'stable'
        ? DASHBOARD_THEME.semantic.catalogStatus.stable
        : resource.status === 'deprecated'
          ? DASHBOARD_THEME.semantic.catalogStatus.deprecated
          : DASHBOARD_THEME.semantic.catalogStatus.unknown;
  const catalogColor = resource.source_repository
    ? DASHBOARD_THEME.semantic.catalogRepository.connected
    : DASHBOARD_THEME.semantic.catalogRepository.missing;
  const values = [
    colorize(fitColumn(resource.catalog, columns[0]), catalogColor, color),
    colorize(fitColumn(resource.kind, columns[1]), DASHBOARD_THEME.semantic.terminalKind, color),
    fitColumn(resource.id, columns[2]),
    colorize(fitColumn(resource.status || '-', columns[3]), statusColor, color),
    fitColumn(resource.description, columns[4]),
  ];
  const prefix = marker ? colorize(marker, DASHBOARD_THEME.semantic.selected, color) : '';
  return `${prefix}${values.join(' ')}`;
}

function formatCatalogTable(resources: CatalogResource[], output: TerminalOutput = process.stdout): string {
  const color = supportsColor(output);
  const width = output.isTTY ? output.columns || 100 : undefined;
  const columns = catalogColumnWidths(resources, width);
  return [
    formatCatalogHeader(columns, 0, color),
    ...resources.map((resource) => formatCatalogRow(resource, columns, '', color)),
  ].join('\n');
}

function selectCatalogResource(
  resources: CatalogResource[],
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stdout,
): Promise<CatalogResource | null> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    const choices = resources.map((resource) => `${resource.kind}:${resource.id} [${resource.catalog}]`).join(', ');
    return Promise.reject(
      new CatalogError(`Resource id '${resources[0]?.id || ''}' is ambiguous; specify a kind (${choices})`),
    );
  }
  const previousRawMode = Boolean(input.isRaw);
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve) => {
    let query = '';
    let selectedIndex = 0;
    let finished = false;
    const matches = () => {
      return resources.filter((resource) => {
        return matchesSearchText(query, [
          resource.catalog,
          resource.kind,
          resource.id,
          resource.status || '',
          resource.description,
        ]);
      });
    };
    const render = () => {
      const visible = matches();
      selectedIndex = visible.length ? Math.min(selectedIndex, visible.length - 1) : 0;
      const viewport = Math.max(1, (output.rows || 24) - 5);
      const first = Math.max(0, Math.min(selectedIndex - viewport + 1, visible.length - viewport));
      const page = visible.slice(first, first + viewport);
      const columns = catalogColumnWidths(visible, output.columns || 100, 2);
      const color = supportsColor(output);
      const lines = [
        'Select a catalog entry (Esc to cancel):',
        `Filter: ${query}`,
        formatCatalogHeader(columns, 2, color),
        ...(page.length
          ? page.map((resource, index) =>
              formatCatalogRow(resource, columns, first + index === selectedIndex ? '> ' : '  ', color),
            )
          : ['No matching resources.']),
        `${visible.length ? `${first + 1}-${first + page.length} of ${visible.length}` : '0 results'} | Enter: select`,
      ];
      output.write(`\u001b[H\u001b[2J${lines.join('\n')}`);
    };
    const finish = (selected: CatalogResource | null) => {
      if (finished) {
        return;
      }
      finished = true;
      input.removeListener('keypress', onKeypress);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write('\u001b[?25h\u001b[?1049l');
      resolve(selected);
    };
    const onKeypress = (character: string, key: Keypress = {}) => {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        finish(null);
        return;
      }
      const visible = matches();
      if (key.name === 'up') {
        selectedIndex = visible.length ? (selectedIndex - 1 + visible.length) % visible.length : 0;
      } else if (key.name === 'down') {
        selectedIndex = visible.length ? (selectedIndex + 1) % visible.length : 0;
      } else if (key.name === 'return' || key.name === 'enter') {
        finish(visible[selectedIndex] || null);
        return;
      } else if (key.name === 'backspace') {
        query = Array.from(query).slice(0, -1).join('');
        selectedIndex = 0;
      } else if (character && !key.ctrl && !key.meta && character >= ' ') {
        query += character;
        selectedIndex = 0;
      }
      render();
    };

    input.on('keypress', onKeypress);
    output.write('\u001b[?1049h\u001b[?25l');
    render();
  });
}

function installedColumnWidths(resources: CatalogResource[], width: number | undefined): InstalledColumnWidths {
  const compact = typeof width === 'number' && Number.isFinite(width) && width < 48;
  const contentWidth = (header: string, value: (resource: CatalogResource) => unknown) =>
    resources.reduce((maximum, resource) => Math.max(maximum, String(value(resource) || '').length), header.length);
  const kindWidth = contentWidth('KIND', (resource) => resource.kind);
  const scopeWidth = contentWidth('SCOPE', (resource) => resource.scope || 'project');
  const catalogWidth = contentWidth('CATALOG', (resource) => resource.catalog);
  const idWidth = contentWidth('ID', (resource) => resource.id);
  const statusWidth = contentWidth('STATUS', (resource) => dashboardStatus(resource));
  const rules: ColumnWidthRule[] = [
    { contentWidth: scopeWidth, minWidth: scopeWidth, shrinkWeight: 0 },
    {
      contentWidth: catalogWidth,
      minWidth: compact ? 6 : catalogWidth,
      maxWidth: catalogWidth + 4,
      growWeight: 1,
      shrinkWeight: 1,
    },
    { contentWidth: kindWidth, minWidth: kindWidth, shrinkWeight: 0 },
    { contentWidth: idWidth, minWidth: compact ? 6 : idWidth, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: statusWidth, minWidth: statusWidth, shrinkWeight: 0 },
    ...(!compact
      ? [
          {
            contentWidth: contentWidth('DESCRIPTION', (resource) => resource.description),
            minWidth: 12,
            growWeight: 3,
            shrinkWeight: 4,
          },
        ]
      : []),
  ];
  const naturalWidth = rules.reduce((sum, rule) => sum + rule.contentWidth, rules.length - 1);
  const widths = adaptiveColumnWidths(
    typeof width === 'number' && Number.isFinite(width) ? width : naturalWidth,
    rules,
  );
  return {
    scope: widths[0],
    catalog: widths[1],
    kind: widths[2],
    id: widths[3],
    status: widths[4],
    description: compact ? 0 : widths[5],
    compact,
  };
}

function formatInstalledHeader(columns: InstalledColumnWidths): string {
  const headers: Array<[string, number]> = [
    ['SCOPE', columns.scope],
    ['CATALOG', columns.catalog],
    ['KIND', columns.kind],
    ['ID', columns.id],
    ['STATUS', columns.status],
  ];
  if (!columns.compact) headers.push(['DESCRIPTION', columns.description]);
  return headers
    .filter(([, columnWidth]) => columnWidth > 0)
    .map(([label, columnWidth]) => fitColumn(label, columnWidth))
    .join(' ');
}

function dashboardStatus(resource: CatalogResource): string | undefined {
  return resource.status === 'attention' &&
    resource.issues?.length &&
    resource.issues.every((issue) => issue.code === 'UPDATE_AVAILABLE')
    ? 'update'
    : resource.status;
}

function formatInstalledRow(
  resource: CatalogResource,
  columns: InstalledColumnWidths,
  marker = '',
  color = supportsColor(),
): string {
  const status = dashboardStatus(resource);
  const statusColor =
    status === 'unmanaged'
      ? DASHBOARD_THEME.semantic.inventoryStatus.unmanaged
      : status === 'attention'
        ? DASHBOARD_THEME.semantic.inventoryStatus.attention
        : status === 'update'
          ? DASHBOARD_THEME.semantic.selected
          : DASHBOARD_THEME.semantic.inventoryStatus.current;
  const scopeColor =
    resource.scope === 'user'
      ? DASHBOARD_THEME.semantic.terminalScope.user
      : DASHBOARD_THEME.semantic.terminalScope.project;
  const catalogColor = resource.source_repository
    ? DASHBOARD_THEME.semantic.catalogRepository.connected
    : DASHBOARD_THEME.semantic.catalogRepository.missing;
  const fields: Array<[string, number]> = [
    [colorize(fitColumn(`${marker}${resource.scope || 'project'}`, columns.scope), scopeColor, color), columns.scope],
    [colorize(fitColumn(resource.catalog, columns.catalog), catalogColor, color), columns.catalog],
    [colorize(fitColumn(resource.kind, columns.kind), DASHBOARD_THEME.semantic.terminalKind, color), columns.kind],
    [fitColumn(resource.id, columns.id), columns.id],
    [colorize(fitColumn(status, columns.status), statusColor, color), columns.status],
    [fitColumn(resource.description, columns.description), columns.description],
  ];
  return fields
    .filter(([, width]) => width > 0)
    .map(([value]) => value)
    .join(' ');
}

function renderInstalledResources(
  resources: CatalogResource[],
  output: TerminalOutput = process.stdout,
  errors: ScanError[] = [],
): string {
  const width = output.isTTY ? output.columns || 100 : undefined;
  const columns = installedColumnWidths(resources, width);
  const lines = resources.length
    ? [
        formatInstalledHeader(columns),
        ...resources.flatMap((resource) => [
          formatInstalledRow(resource, columns, '', supportsColor(output)),
          ...(columns.compact && resource.description && width !== undefined
            ? [`  ${truncateDescription(resource.description, Math.max(4, width - 2))}`]
            : []),
        ]),
      ]
    : ['No catalog-managed resources found in project or user scope.'];
  if (errors.length) {
    lines.push('', ...errors.map((error) => `Error (${error.scope} scope, ${error.code}): ${error.message}`));
  }
  return lines.join('\n');
}

async function browseInstalledResources(
  resources: CatalogResource[],
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stdout,
  errors: ScanError[] = [],
  actions: DashboardActions = {},
): Promise<boolean> {
  const { runDashboard } = await import('./dashboard.mjs');
  return runDashboard(resources, input, output, errors, actions);
}

function truncateDescription(description: string, maxLength = 80): string {
  const characters = Array.from(description);
  if (characters.length <= maxLength) {
    return description;
  }
  return `${characters
    .slice(0, Math.max(0, maxLength - 3))
    .join('')
    .trimEnd()}...`;
}

function supportsColor(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(stream.isTTY && !env.NO_COLOR && env.TERM !== 'dumb');
}

function colorize(value: string, color: TerminalColor, enabled = supportsColor()): string {
  if (!enabled) {
    return value;
  }
  const code = DASHBOARD_THEME.terminalAnsi[color];
  if (typeof code !== 'string' || !code) {
    throw new CatalogError(`Unknown terminal color: ${color}`);
  }
  return `\u001b[${code}m${value}\u001b[0m`;
}

export {
  formatCatalogTable,
  selectCatalogResource,
  formatInstalledHeader,
  formatInstalledRow,
  renderInstalledResources,
  browseInstalledResources,
  truncateDescription,
  supportsColor,
  colorize,
};
