import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from '@tanstack/react-router';
import { DASHBOARD_THEME } from '../../../../cli/src/dashboard/colors';
import { initialCatalogs, initialInstallations, installedPath, resourceKey, resources, revisions, sourcePath, type DemoCatalog, type DemoResource, type Installation, type Kind, type Scope } from './demoData';
import styles from './DashboardDemo.module.css';
import { terminalColor } from './terminalTheme';

type View = 'inventory' | 'browse' | 'catalogs';
type Modal =
  | { type: 'install' | 'update' | 'uninstall' | 'preview' | 'revisions'; resource: DemoResource; installation?: Installation }
  | { type: 'catalog'; catalog?: DemoCatalog }
  | { type: 'removeCatalog'; catalog: DemoCatalog }
  | { type: 'help' };

const theme = DASHBOARD_THEME.semantic;
const themeStyle = {
  '--demo-background': 'var(--surface)',
  '--demo-surface': 'var(--surface)',
  '--demo-border': 'var(--line)',
  '--demo-text': terminalColor(theme.accents.label),
  '--demo-muted': terminalColor(theme.accents.muted),
  '--demo-primary': terminalColor(theme.accents.primary),
  '--demo-selected': terminalColor(theme.selected),
  '--demo-success': terminalColor(theme.accents.success),
  '--demo-warning': terminalColor(theme.accents.warning),
  '--demo-danger': terminalColor(theme.accents.danger),
  '--demo-modal': theme.modal.background,
} as CSSProperties;

export function DashboardDemo() {
  const [view, setView] = useState<View>('inventory');
  const [catalogs, setCatalogs] = useState(initialCatalogs);
  const [installations, setInstallations] = useState(initialInstallations);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [catalogFilter, setCatalogFilter] = useState('all');
  const [license, setLicense] = useState('all');
  const [selectedKey, setSelectedKey] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [message, setMessage] = useState('Try updating code-review, or browse the catalog to install a resource.');
  const [formError, setFormError] = useState('');
  const [scope, setScope] = useState<Scope>('project');
  const [revision, setRevision] = useState(revisions[0].sha);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);

  const available = catalogs.flatMap((catalog) => resources
    .filter((resource) => resource.catalog === (catalog.repository === 'demo/team' ? 'team' : 'toolkit'))
    .map((resource) => ({ ...resource, catalog: catalog.name })));
  const matches = (resource: DemoResource) =>
    (kind === 'all' || resource.kind === kind) &&
    (catalogFilter === 'all' || resource.catalog === catalogFilter) &&
    (license === 'all' || resource.license === license) &&
    `${resource.id} ${resource.description} ${resource.catalog} ${resource.kind}`.toLowerCase().includes(query.toLowerCase());
  const rows = view === 'inventory'
    ? installations.filter(({ resource }) => matches(resource)).map((installation) => ({ resource: installation.resource, installation, key: `${resourceKey(installation.resource)}:${installation.scope}` }))
    : available.filter(matches).map((resource) => ({ resource, installation: undefined as Installation | undefined, key: resourceKey(resource) }));
  const selected = rows.find(({ key }) => key === selectedKey) ?? rows[0];
  const selectedCatalog = catalogs.find(({ name }) => name === selectedKey) ?? catalogs[0];
  const connected = (resource: DemoResource) => available.some((candidate) => resourceKey(candidate) === resourceKey(resource));
  const updates = installations.filter(({ resource, revision: ref }) => connected(resource) && ref !== revisions[0].sha).length;

  function changeView(next: View) {
    setView(next);
    setQuery('');
    setKind('all');
    setCatalogFilter('all');
    setLicense('all');
    setSelectedKey('');
  }

  function open(next: Modal) {
    setFormError('');
    setScope('installation' in next ? next.installation?.scope ?? 'project' : 'project');
    setRevision(revisions[0].sha);
    setModal(next);
  }

  function act(type: 'install' | 'update' | 'uninstall' | 'preview' | 'revisions') {
    if (!selected) return;
    if ((type === 'update' || type === 'revisions') && !connected(selected.resource)) return;
    open({ type, resource: selected.resource, installation: selected.installation });
  }

  function finish(text: string) {
    setMessage(text);
    setModal(null);
  }

  function saveResource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || !('resource' in modal)) return;
    const { resource, installation } = modal;
    if (modal.type === 'uninstall') {
      setInstallations((current) => current.filter((entry) => entry !== installation));
      finish(`Uninstalled ${resource.id} from ${installation!.scope}. Other scopes are unchanged.`);
      return;
    }
    const targetScope = installation?.scope ?? scope;
    const conflict = installations.find((entry) => entry.scope === targetScope && entry.resource.kind === resource.kind && entry.resource.id === resource.id);
    if (modal.type === 'install' && conflict) {
      setFormError(`${resource.id} is already installed in ${targetScope}${conflict.resource.catalog !== resource.catalog ? ` from ${conflict.resource.catalog}` : ''}. Choose another scope or uninstall it first.`);
      return;
    }
    setInstallations((current) => modal.type === 'install'
      ? [...current, { resource, scope: targetScope, revision }]
      : current.map((entry) => entry === installation ? { ...entry, revision } : entry));
    finish(`${modal.type === 'install' ? 'Installed' : 'Updated'} ${resource.id} in ${targetScope} at ${revision}. Simulated only; no files were changed.`);
  }

  function saveCatalog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modal?.type !== 'catalog') return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name')).trim();
    const repository = String(data.get('repository'));
    if (catalogs.some((catalog) => catalog.name === name && catalog.name !== modal.catalog?.name)) {
      setFormError('A catalog with this name is already connected.');
      return;
    }
    const oldName = modal.catalog?.name;
    setCatalogs((current) => oldName ? current.map((catalog) => catalog.name === oldName ? { name, repository } : catalog) : [...current, { name, repository }]);
    if (oldName) setInstallations((current) => current.map((entry) => entry.resource.catalog === oldName ? { ...entry, resource: { ...entry.resource, catalog: name } } : entry));
    setSelectedKey(name);
    finish(`${oldName ? 'Updated' : 'Connected'} demo catalog ${name}. No repository was contacted.`);
  }

  function reset() {
    setCatalogs(initialCatalogs);
    setInstallations(initialInstallations());
    changeView('inventory');
    setModal(null);
    setMessage('Demo reset. All sample resources and catalogs have been restored.');
  }

  function keyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (modal || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('input, select, textarea')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const keys = view === 'catalogs' ? catalogs.map(({ name }) => name) : rows.map(({ key }) => key);
      const index = Math.max(0, keys.indexOf(view === 'catalogs' ? selectedCatalog?.name : selected?.key));
      const next = keys[(index + (event.key === 'ArrowDown' ? 1 : -1) + keys.length) % keys.length];
      if (next) setSelectedKey(next);
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'f') { event.preventDefault(); search.current?.focus(); }
    if (key === '?') open({ type: 'help' });
    if (key === 'a') changeView('browse');
    if (key === 'n') open({ type: 'catalog' });
    if (key === 'p' && view !== 'catalogs') act('preview');
    if (key === 'v' && view !== 'catalogs') act('revisions');
    if (key === 'u' && view === 'inventory') act('update');
    if (event.key === 'Delete' && view === 'inventory') act('uninstall');
    if (event.key === 'Enter' && view === 'browse' && (event.target as HTMLElement).tagName !== 'BUTTON') act('install');
  }

  const modalResource = modal && 'resource' in modal ? modal.resource : undefined;
  const modalInstallation = modal && 'installation' in modal ? modal.installation : undefined;
  const modalTitle = modal?.type === 'catalog' ? `${modal.catalog ? 'Edit' : 'Connect'} a demo catalog`
    : modal?.type === 'removeCatalog' ? 'Disconnect catalog?'
    : modal?.type === 'help' ? 'Explore the dashboard'
    : `${modal?.type === 'preview' ? 'Source preview' : modal?.type === 'revisions' ? 'Revision history' : modal?.type === 'uninstall' ? 'Uninstall' : modal?.type === 'update' ? 'Update' : 'Install'} · ${modalResource?.id ?? ''}`;

  return <main id="main" className={`shell ${styles.page}`} style={themeStyle}>
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>Interactive playground</p><h1>Your toolkit. Your turn.</h1><p>Try Kitia’s dashboard without installing anything.</p></div>
      <Link to="/" hash="commands" data-ga-event="demo_install_cli">Get the real CLI <span aria-hidden="true">↗</span></Link>
    </div>
    <p className={styles.notice}><strong>Demo mode</strong> · Sample data, browser-only actions. No downloads, GitHub access, or local file changes. Reload or reset to start over.</p>
    <section className={styles.terminal} aria-label="Interactive dashboard demo" onKeyDown={keyboard} tabIndex={0}>
      <header className={styles.titlebar}>
        <div className={styles.brand}><pre aria-hidden="true">{' /\\_/\\\n( o.o )\n > ^ <'}</pre><div><strong>KITIA</strong><span>demo workspace / my-project</span></div></div>
        <div className={styles.topActions}><button type="button" onClick={() => open({ type: 'help' })}>? Guide</button><button type="button" onClick={reset}>Reset demo</button></div>
      </header>
      <nav className={styles.tabs} aria-label="Demo screens">{([['inventory', 'Inventory'], ['browse', 'Browse resources'], ['catalogs', 'Catalogs']] as const).map(([value, label]) => <button type="button" key={value} aria-current={view === value ? 'page' : undefined} onClick={() => changeView(value)}>{label}<span>{value === 'inventory' ? installations.length : value === 'browse' ? available.length : catalogs.length}</span></button>)}</nav>
      <div className={styles.summary}>
        <div><span>PROJECT</span><strong>{installations.filter(({ scope: value }) => value === 'project').length}</strong><small>my-project</small></div>
        <div><span>USER</span><strong>{installations.filter(({ scope: value }) => value === 'user').length}</strong><small>shared across projects</small></div>
        <div><span>UPDATES</span><strong className={updates ? styles.warning : ''}>{updates}</strong><small>compared with catalog pin</small></div>
      </div>
      {view !== 'catalogs' ? <>
        <div className={styles.filters}>
          <label className={styles.search}>Search<input ref={search} type="search" placeholder="Search resources…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All kinds</option>{(['skill', 'agent', 'instruction'] as Kind[]).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Catalog<select value={catalogFilter} onChange={(event) => setCatalogFilter(event.target.value)}><option value="all">All catalogs</option>{[...new Set([...catalogs.map(({ name }) => name), ...installations.map(({ resource }) => resource.catalog)])].map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>License<select value={license} onChange={(event) => setLicense(event.target.value)}><option value="all">All licenses</option><option>MIT</option><option>Apache-2.0</option></select></label>
        </div>
        <div className={styles.workspace}>
          <div className={styles.list}>
            <h2>{view === 'inventory' ? 'Installed resources' : 'Catalog resources'} <span>{rows.length} results</span></h2>
            <div className={styles.tableScroll}><table><caption className={styles.srOnly}>Select a resource to inspect it and try actions.</caption><thead><tr><th>Resource</th><th>Kind</th><th>{view === 'inventory' ? 'Scope' : 'Installed'}</th><th>{view === 'inventory' ? 'Status' : 'Catalog'}</th></tr></thead><tbody>{rows.map((row) => {
              const { resource, installation } = row;
              const status = !connected(resource) ? 'Disconnected' : installation?.revision !== revisions[0].sha ? 'Update available' : 'Current';
              return <tr key={row.key} className={selected?.key === row.key ? styles.selected : ''} style={{ '--row-color': terminalColor(theme.kind[resource.kind]) } as CSSProperties}>
                <td><button type="button" aria-pressed={selected?.key === row.key} onClick={() => setSelectedKey(row.key)}>{resource.id}</button></td><td>{resource.kind}</td><td>{installation?.scope ?? (installations.filter((entry) => resourceKey(entry.resource) === resourceKey(resource)).map(({ scope: value }) => value).join(', ') || '—')}</td><td>{installation ? status : resource.catalog}</td>
              </tr>;
            })}</tbody></table></div>
            {!rows.length && <div className={styles.empty}><p>{view === 'inventory' && !installations.length ? 'No resources installed. Browse the catalog to add your first one.' : 'No matching resources. Try another search or clear the filters.'}</p><button type="button" onClick={() => changeView(view === 'inventory' && !installations.length ? 'browse' : view)}>{view === 'inventory' && !installations.length ? 'Browse resources' : 'Clear filters'}</button></div>}
          </div>
          <aside className={styles.details} aria-label="Selected resource">
            <h2>Selection details</h2>{selected ? <>
              <span className={styles.kind} style={{ color: terminalColor(theme.kind[selected.resource.kind]) }}>{selected.resource.kind}</span><h3>{selected.resource.id}</h3><p>{selected.resource.description}</p>
              <dl><dt>Catalog</dt><dd>{selected.resource.catalog}</dd><dt>License</dt><dd>{selected.resource.license}</dd><dt>{selected.installation ? 'Installed revision' : 'Catalog pin'}</dt><dd>{selected.installation?.revision ?? revisions[0].sha}</dd><dt>{selected.installation ? 'Installed path' : 'Source path'}</dt><dd>{selected.installation ? installedPath(selected.resource, selected.installation.scope) : sourcePath(selected.resource)}</dd></dl>
              <div className={styles.actions}>{view === 'browse' ? <button type="button" className={styles.primary} onClick={() => act('install')}>Install resource</button> : <><button type="button" className={styles.primary} disabled={!connected(selected.resource)} onClick={() => act('update')}>Update resource</button><button type="button" className={styles.danger} onClick={() => act('uninstall')}>Uninstall</button></>}<button type="button" onClick={() => act('preview')}>Preview / audit</button><button type="button" disabled={!connected(selected.resource)} onClick={() => act('revisions')}>Revisions</button></div>
              {!connected(selected.resource) && <p>Reconnect this catalog to update or browse its revisions. Installed content is retained.</p>}
            </> : <p>Select a resource to see its details.</p>}
          </aside>
        </div>
      </> : <div className={styles.catalogPage}>
        <div className={styles.catalogHeading}><div><h2>Connected catalogs</h2><p>Try connecting, editing, refreshing, or disconnecting sample sources.</p></div><button type="button" className={styles.primary} onClick={() => open({ type: 'catalog' })}>Connect catalog</button></div>
        {catalogs.map((catalog) => <article key={catalog.name} className={`${styles.catalogCard} ${selectedCatalog?.name === catalog.name ? styles.activeCatalog : ''}`}>
          <div><button type="button" aria-pressed={selectedCatalog?.name === catalog.name} onClick={() => setSelectedKey(catalog.name)}>{catalog.name}</button><p>{catalog.repository} · {available.filter((resource) => resource.catalog === catalog.name).length} resources{catalog.refreshedAt ? ` · snapshot refreshed ${catalog.refreshedAt}` : ''}</p></div><div className={styles.actions}><button type="button" onClick={() => { setCatalogs((current) => current.map((entry) => entry.name === catalog.name ? { ...entry, refreshedAt: new Date().toLocaleTimeString() } : entry)); setMessage(`Refreshed ${catalog.name} from its bundled demo snapshot. Installed resources are unchanged.`); }}>Refresh</button><button type="button" onClick={() => open({ type: 'catalog', catalog })}>Edit</button><button type="button" className={styles.danger} onClick={() => open({ type: 'removeCatalog', catalog })}>Disconnect</button></div>
        </article>)}
        {!catalogs.length && <p>No catalogs connected. Connect a demo catalog to browse resources again.</p>}
      </div>}
      <footer className={styles.shortcuts}><span>↑ ↓ select</span><span>F search</span><span>A browse</span><span>P preview</span><span>V revisions</span><span>U update</span><span>N connect catalog</span><span>? guide</span></footer>
      <p className={styles.feedback} role="status" aria-live="polite">{message}</p>
    </section>
    <p className={styles.footnote}>A browser simulation of the local dashboard, not a terminal session. GitHub authentication, filesystem checks, real audits, and collection file import/export require the CLI. Try it locally with <code>npx @grasdouble/kitia dashboard</code>.</p>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="demo-dialog-title" onCancel={() => setModal(null)}>
      {modal && <><header className={styles.dialogHeader}><h2 id="demo-dialog-title">{modalTitle}</h2><button type="button" aria-label="Close dialog" onClick={() => setModal(null)}>×</button></header>
        {modal.type === 'help' ? <div className={styles.dialogBody}><p>Everything here uses bundled sample data and resets on reload.</p><ol><li>In Inventory, select code-review and update its pinned revision.</li><li>Browse resources, search or filter, then install a skill, agent, or instruction.</li><li>Choose project or user scope. Instructions are project-only.</li><li>Preview sample source, explore revisions, or uninstall a resource.</li><li>In Catalogs, connect, edit, refresh, or disconnect a sample source.</li></ol><p>Click any control, or focus the dashboard to use the shortcuts below it. Esc closes dialogs. Reset demo restores the starting state.</p></div>
        : modal.type === 'catalog' ? <form className={styles.dialogBody} onSubmit={saveCatalog}><p>Connect bundled fixtures only. This does not access a real repository.</p><label>Catalog name<input name="name" required pattern="[a-z0-9][a-z0-9-]*" maxLength={40} defaultValue={modal.catalog?.name ?? ''} placeholder="my-catalog" /></label><label>Demo source<select name="repository" defaultValue={modal.catalog?.repository ?? 'demo/toolkit'}><option value="demo/toolkit">demo/toolkit · skills, agent, instruction</option><option value="demo/team">demo/team · team resources</option></select></label>{formError && <p role="alert" className={styles.warning}>{formError}</p>}<button className={styles.primary} type="submit">{modal.catalog ? 'Save catalog' : 'Connect demo catalog'}</button></form>
        : modal.type === 'removeCatalog' ? <div className={styles.dialogBody}><p>Disconnect <strong>{modal.catalog.name}</strong>? Its resources will leave the browser, but existing installations will remain in Inventory.</p><button type="button" className={styles.danger} onClick={() => { setCatalogs((current) => current.filter(({ name }) => name !== modal.catalog.name)); finish(`Disconnected ${modal.catalog.name}. Existing installations were retained.`); }}>Disconnect catalog</button></div>
        : modal.type === 'preview' ? <div className={styles.dialogBody}><p>{modalInstallation ? 'Installed sample content' : 'Catalog sample content'} · {sourcePath(modal.resource)} · {modalInstallation?.revision ?? revisions[0].sha}</p><pre className={styles.source}>{modal.resource.content}</pre><h3>Audit · demonstration only</h3><p>No audit is executed in this browser demo. The real dashboard checks source files and reports findings and skipped paths; an empty report is not a safety guarantee.</p><h3>Source tree</h3><code>{sourcePath(modal.resource)}</code></div>
        : modal.type === 'revisions' ? <div className={styles.dialogBody}><p>Illustrative commit history, not live GitHub data. Choose a revision to {modalInstallation ? 'update the installation' : 'install the resource'}.</p><div className={styles.revisions}>{revisions.map((entry, index) => <button type="button" key={entry.sha} onClick={() => { setRevision(entry.sha); setFormError(''); setModal({ ...modal, type: modalInstallation ? 'update' : 'install' }); }}><code>{entry.sha}</code><span>{entry.label}{index === 0 ? ' · catalog pin' : ''}</span></button>)}</div></div>
        : <form className={styles.dialogBody} onSubmit={saveResource}><p>{modal.type === 'uninstall' ? 'Remove this sample installation from the selected scope. Other scopes are kept.' : 'Simulate a Copilot installation with a pinned revision. No files are written.'}</p>
          {modal.type === 'install' ? <label>Scope<select value={scope} onChange={(event) => setScope(event.target.value as Scope)}><option value="project">Project · my-project</option>{modal.resource.kind !== 'instruction' && <option value="user">User · shared across projects</option>}</select></label> : <p><strong>Scope:</strong> {modalInstallation?.scope}</p>}
          {modal.type === 'install' && modal.resource.kind === 'instruction' && <p>Instructions support project scope only.</p>}
          {modal.type !== 'uninstall' && <label>Revision<select value={revision} onChange={(event) => setRevision(event.target.value)}>{revisions.map((entry, index) => <option key={entry.sha} value={entry.sha}>{entry.sha} · {index === 0 ? 'catalog pin' : entry.label}</option>)}</select></label>}
          <div className={styles.destination}><span>{modal.type === 'uninstall' ? 'Remove from' : 'Destination'}</span><code>{installedPath(modal.resource, modalInstallation?.scope ?? scope)}</code></div>
          {formError && <p role="alert" className={styles.warning}>{formError}</p>}<button type="submit" className={modal.type === 'uninstall' ? styles.danger : styles.primary}>Confirm {modal.type}</button>
        </form>}
      </>}
    </dialog>
  </main>;
}
