import { Fragment, useMemo } from 'react';

import type { PreviewFile } from '../../core/inspection/model.js';
import { DASHBOARD_THEME } from '../../tui/colors.js';
import { highlightSource } from '../../tui/source-highlighting.mjs';

const { syntax, modal } = DASHBOARD_THEME.semantic;
const codeStyle = { backgroundColor: modal.background, color: modal.foreground };

export function SourceCode({ path, content }: PreviewFile) {
  const lines = useMemo(() => highlightSource(path, content.split('\n')), [path, content]);
  return (
    <pre className="highlighted-code" style={codeStyle}>
      <code>
        {lines.map((line, index) => (
          <Fragment key={index}>
            {index > 0 ? '\n' : null}
            {line.map(({ text, role }, offset) =>
              role ? (
                <span key={offset} style={{ color: syntax[role] }}>
                  {text}
                </span>
              ) : (
                <Fragment key={offset}>{text}</Fragment>
              ),
            )}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
