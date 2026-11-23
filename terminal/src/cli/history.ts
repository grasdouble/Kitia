import { uniqueSourceVersionPrefixes } from '../core/resources/history.js';
import { adaptiveColumnWidths } from '../table-layout.js';
import type { SourceVersionOption } from '../tui/contracts.js';

function formatSourceVersionTable(
  versions: Pick<SourceVersionOption, 'sha' | 'date' | 'subject'>[],
  terminalWidth?: number,
) {
  const prefixes: string[] = uniqueSourceVersionPrefixes(versions);
  const interactive = Number.isFinite(terminalWidth);
  const shaContentWidth = Math.max(3, ...prefixes.map((prefix: string) => prefix.length));
  const dates = versions.map(({ date }) => (interactive ? date.slice(0, 10) : date));
  const dateContentWidth = Math.max(10, ...dates.map((date) => date.length));
  const subjectContentWidth = Math.max(7, ...versions.map(({ subject }) => subject.length));
  const naturalWidth = shaContentWidth + dateContentWidth + subjectContentWidth + 4;
  const [shaWidth, dateWidth, subjectWidth] = adaptiveColumnWidths(
    terminalWidth || naturalWidth,
    [
      { contentWidth: shaContentWidth, minWidth: Math.min(shaContentWidth, 7), shrinkWeight: 1 },
      { contentWidth: dateContentWidth, minWidth: Math.min(dateContentWidth, 10), shrinkWeight: 2 },
      {
        contentWidth: subjectContentWidth,
        minWidth: Math.min(subjectContentWidth, 8),
        growWeight: 1,
        shrinkWeight: 3,
      },
    ],
    2,
  );
  const fit = (value: string, width: number) => {
    const text = String(value);
    return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text.padEnd(width);
  };
  const rows = [
    `${fit('SHA', shaWidth)}  ${fit('DATE', dateWidth)}  ${fit('SUBJECT', subjectWidth)}`,
    `${'-'.repeat(shaWidth)}  ${'-'.repeat(dateWidth)}  ${'-'.repeat(subjectWidth)}`,
  ];
  for (const [index, version] of versions.entries()) {
    rows.push(
      `${fit(prefixes[index], shaWidth)}  ${fit(dates[index], dateWidth)}  ${fit(version.subject, subjectWidth)}`,
    );
  }
  return rows;
}

export { formatSourceVersionTable };
