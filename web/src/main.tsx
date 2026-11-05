import React from 'react';
import { createRoot } from 'react-dom/client';
import workspaceScreenshot from '../assets/workspace-inventory-termless.png';
import catalogScreenshot from '../assets/catalog-browser-termless.png';
import './styles.css';

const repo = 'https://github.com/grasdouble/Kitia';
const contract = `${repo}/blob/main/docs/cli-contract.md`;

function Brand({ footer = false }: { footer?: boolean }) {
  return <a className={`brand${footer ? ' footer-brand' : ''}`} href="#top" aria-label="Kitia home"><span className="brand-mark" aria-hidden="true">K</span><span>kitia<span className="brand-period">.</span></span></a>;
}

function Header() {
  return <header className="site-header"><nav className="nav shell" aria-label="Main navigation"><Brand /><div className="nav-links"><a href="#approach">Approach</a><a href="#dashboard">Dashboard</a><a href="#workflow">Workflow</a><a href="#commands">Automation</a></div><a className="nav-cta" href={repo}>GitHub <span aria-hidden="true">↗</span></a></nav></header>;
}

function ProductPreview() {
  return <section className="screen-gallery shell" id="dashboard" aria-labelledby="screens-title">
    <div className="gallery-heading"><p className="eyebrow eyebrow-dark">The Kitia dashboard · Demo data</p><h2 id="screens-title">Your resources, at a glance.</h2><p>Browse connected catalogs, inspect installed resources, and manage your workspace in Kitia's interactive local dashboard.</p></div>
    <div className="screens-grid">
      <figure className="screen-figure catalog-figure"><div className="capture-label"><span>Real Ink dashboard · Termless · Demo data</span><span>02 / 02 · Catalog</span></div><a className="screen-image-link" href={catalogScreenshot} target="_blank" rel="noopener" aria-label="Open full-size Termless catalog browser screenshot with demo data"><img src={catalogScreenshot} alt="Termless xterm.js rendering of Kitia's actual CATALOG RESOURCES screen with deterministic mock skills, an agent, and an instruction." /></a><figcaption><span>Catalog browser · demo index</span><span>Termless xterm.js rendering of the isolated metadata-only mock catalog.</span></figcaption></figure>
    </div>
  </section>;
}

function Workflow() {
  const steps = [
    ['Install once', 'Install Kitia globally, then run kitia to open the dashboard. For one-off use, run commands with npx.', 'npm install --global @grasdouble/kitia'],
    ['Start in your dashboard', 'The interactive inventory brings project and user resources together, with details and attention items in one place.', 'kitia'],
    ['Browse and manage catalogs', 'Add trusted GitHub sources, search resources, inspect files, and preview changes without leaving the dashboard.', 'N add catalog · F filter · D details'],
    ['Choose and confirm actions', 'Install, update, or uninstall selected resources. Kitia protects files it does not manage and asks before dashboard actions.', 'A install · U update · Delete uninstall'],
  ];
  return <section className="section shell workflow" id="workflow" aria-labelledby="workflow-title"><div className="section-intro"><p className="eyebrow eyebrow-dark">Your workspace starts here</p><h2 id="workflow-title">A TUI for<br /><em>the whole workflow.</em></h2><p>Explore your resources in Kitia's interactive terminal interface. Use the CLI when you want to automate repeatable checks.</p></div><div className="workflow-list">{steps.map(([title, text, command], i) => <article key={title}><span className="step">0{i + 1}</span><div><h3>{title}</h3><p>{text}</p><code>{command}</code></div></article>)}</div></section>;
}

function Principles() {
  const points = [['Local metadata', 'Catalog definitions and metadata-only indexes live in your user configuration.'], ['Upstream content', 'Skill, agent, and instruction bodies stay in their source repositories.'], ['Explicit choices', 'You choose the catalogs and resources to add, preview, install, and manage.'], ['Conflict-aware', 'Managed-file tracking helps avoid overwriting content Kitia does not own.']];
  return <section className="principles" id="approach" aria-labelledby="approach-title"><div className="shell principles-layout"><div><p className="eyebrow"><span className="status-dot" aria-hidden="true" />The Kitia approach</p><h2 id="approach-title">Catalog metadata stays local.<br /><em>Resources stay upstream.</em></h2><p className="principle-lede">Kitia brings catalog metadata into your local configuration. The resource bodies remain in the repositories that publish them.</p><a className="light-link" href={contract}>Read the CLI contract <span aria-hidden="true">↗</span></a></div><dl className="principle-details">{points.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl></div></section>;
}

function Commands() {
  const commands = [['Validate catalogs', 'kitia validate', 'Run strict catalog validation as a CI gate; exits non-zero when validation fails.'], ['Check installations', 'kitia check --json', 'Consume a structured status report and use its exit code in CI.'], ['Preview a change', 'kitia install skill <id> --dry-run --json', 'Review a machine-readable plan without changing files.']];
  return <section className="section shell commands" id="commands" aria-labelledby="commands-title"><div className="command-heading"><div><p className="eyebrow eyebrow-dark">Automation when you need it</p><h2 id="commands-title">CLI for scripts<br />and CI.</h2></div><p>The dashboard is Kitia's interactive workspace. Use the CLI as a secondary interface for repeatable checks and machine-readable reports in your scripts and CI pipelines.</p></div><div className="command-list">{commands.map(([label, command, description]) => <article key={label}><span>{label}</span><code>{command}</code><p>{description}</p></article>)}</div></section>;
}

function Closing() {
  return <section className="closing" aria-labelledby="closing-title"><div className="shell closing-inner"><div><p className="eyebrow"><span className="status-dot" aria-hidden="true" />Open source · Your tools · Your choice</p><h2 id="closing-title">Start with a catalog<br />you already trust.</h2></div><div className="closing-actions"><a className="button button-light" href={`${repo}#readme`}>Get started on GitHub <span aria-hidden="true">↗</span></a><a href={contract}>Explore the CLI contract <span aria-hidden="true">→</span></a></div></div></section>;
}

function App() {
  return <><a className="skip-link" href="#main">Skip to content</a><Header /><main id="main"><section className="hero shell" id="top" aria-labelledby="hero-title"><div className="hero-copy"><p className="eyebrow"><span className="status-dot" aria-hidden="true" />An open-source resource manager</p><h1 id="hero-title">Manage your AI resources <em>from one terminal.</em></h1><p className="hero-intro">Kitia is an interactive terminal UI (TUI) for browsing catalogs, reviewing installed resources, and managing changes. Its CLI provides repeatable automation for scripts and CI.</p><div className="hero-actions"><a className="button button-primary" href="#dashboard">Explore the dashboard <span aria-hidden="true">↓</span></a><a className="text-link" href={`${repo}#readme`}>Read the README <span aria-hidden="true">↗</span></a></div><div className="hero-note"><span aria-hidden="true">01</span>Metadata stays local. Resource bodies stay upstream.</div></div><figure className="hero-aside hero-product"><div className="product-bar"><span><i aria-hidden="true" />kitia · workspace inventory</span><span>demo data</span></div><a className="screen-image-link" href={workspaceScreenshot} target="_blank" rel="noopener" aria-label="Open full-size Termless workspace inventory screenshot with demo data"><img src={workspaceScreenshot} alt="Termless xterm.js rendering of Kitia's actual Ink dashboard, showing project ask-matt selected beside the inventory rows for user grill-me and unmanaged herdr." fetchPriority="high" /></a><figcaption>Interactive local terminal interface · demo inventory</figcaption></figure></section><div className="trust-strip" aria-label="Resource types and supported tools"><div className="shell strip-inner"><span>One tool for the resources you choose</span><div><b>Skills</b><i>·</i><b>Agents</b><i>·</i><b>Instructions</b></div><span>Claude Code <i>+</i> GitHub Copilot</span></div></div><ProductPreview /><Workflow /><Principles /><Commands /><Closing /></main><footer className="site-footer shell"><Brand footer /><p>Interactive dashboard with CLI automation.</p><div className="footer-links"><a href={repo}>Repository</a><a href={`${repo}#readme`}>README</a><a href={contract}>CLI contract</a></div><span className="copyright">© Kitia contributors</span></footer></>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
