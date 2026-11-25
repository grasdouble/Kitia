import type { ResourceActionResult } from '../../application/resource-actions.js';

export function MutationResult({ result, operation }: { result: ResourceActionResult; operation: string }) {
  const audit = result.messages.find((message) => typeof message !== 'string');
  const messages = result.messages.filter((message) => typeof message === 'string');
  const scanErrors = result.errors.filter(({ scope }) => scope !== 'catalog');
  return (
    <>
      {result.code === 0 ? (
        <p role="status">
          {operation} complete.{scanErrors.length ? '' : ' Inventory refreshed.'}
        </p>
      ) : (
        <p role="alert">{result.failure?.userMessage ?? `${operation} did not complete.`}</p>
      )}
      {scanErrors.length ? (
        <ul aria-label="Inventory scan errors">
          {scanErrors.map(({ scope, message }) => (
            <li key={scope}>
              {scope}: {message}
            </li>
          ))}
        </ul>
      ) : null}
      {messages.length ? (
        <ul>
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
      {result.failure?.paths?.length ? (
        <ul>
          {result.failure.paths.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {audit ? (
        <section>
          <h3>Entry-file audit</h3>
          <p>
            {audit.coverage.analyzed} of {audit.coverage.discovered} files analyzed. This is not a safety guarantee.
          </p>
          {audit.findings.length ? (
            <ul>
              {audit.findings.map(({ path, line, code, message }, index) => (
                <li key={index}>
                  <code>
                    {path}:{line}
                  </code>{' '}
                  · {code}: {message}
                </li>
              ))}
            </ul>
          ) : null}
          {audit.coverage.skipped.length ? (
            <ul>
              {audit.coverage.skipped.map(({ path, reason }) => (
                <li key={path}>
                  <code>{path}</code>: {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
