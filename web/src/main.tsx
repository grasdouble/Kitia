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
  return <header className="site-header"><nav className="nav shell" aria-label="Main navigation"><Brand /><div className="nav-links"><a href="#approach">Approach</a><a href="#workflow">Workflow</a><a href="#commands">Commands</a></div><a className="nav-cta" href={repo}>GitHub <span aria-hidden="true">↗</span></a></nav></header>;
}

function ProductPreview() {
  return <section className="screen-gallery shell" aria-labelledby="screens-title">
    <div className="gallery-heading"><p className="eyebrow eyebrow-dark">Real Kitia dashboard · Demo data</p><h2 id="screens-title">Browse a catalog.</h2><p>This view uses Kitia's real Ink CLI with isolated, deterministic demo resources—not live user catalog data.</p></div>
    <div className="screens-grid">
      <figure className="screen-figure catalog-figure"><div className="capture-label"><span>Real Ink dashboard · Termless · Demo data</span><span>02 / 02 · Catalog</span></div><a className="screen-image-link" href={catalogScreenshot} target="_blank" rel="noopener" aria-label="Open full-size Termless catalog browser screenshot with demo data"><img src={catalogScreenshot} alt="Termless xterm.js rendering of Kitia's actual CATALOG RESOURCES screen with deterministic mock skills, an agent, and an instruction." /></a><figcaption><span>Catalog browser · demo index</span><span>Termless xterm.js rendering of the isolated metadata-only mock catalog.</span></figcaption></figure>
    </div>
  </section>;
}

function Workflow() {
  const steps = [
    ['Install the CLI', 'Install Kitia once globally, then run kitia from your terminal. For a one-off, prefix commands with npx --yes @grasdouble/kitia.', 'npm install --global @grasdouble/kitia'],
    ['Connect repositories you trust', 'Add external GitHub catalogs yourself. Use basic discovery or map the paths you want.', 'kitia catalog add <name> <github-url>'],
    ['Inspect before installing', 'Search the catalog, inspect metadata, and preview resource files before choosing an install.', 'kitia search "documentation"'],
    ['Keep changes accountable', 'Preview a plan with dry-run. Kitia tracks managed files and protects untracked or locally modified content.', 'kitia install skill <id> --dry-run'],
  ];
  return <section className="section shell workflow" id="workflow" aria-labelledby="workflow-title"><div className="section-intro"><p className="eyebrow eyebrow-dark">A simpler way to stay deliberate</p><h2 id="workflow-title">Your sources.<br /><em>Your call.</em></h2><p>Kitia helps you discover and manage AI resources without turning your workflow into another hosted service.</p></div><div className="workflow-list">{steps.map(([title, text, command], i) => <article key={title}><span className="step">0{i + 1}</span><div><h3>{title}</h3><p>{text}</p><code>{command}</code></div></article>)}</div></section>;
}

function Principles() {
  const points = [['Local metadata', 'Catalog definitions and metadata-only indexes live in your user configuration.'], ['Upstream content', 'Skill, agent, and instruction bodies stay in their source repositories.'], ['Explicit choices', 'You choose the catalogs and resources to add, preview, install, and manage.'], ['Conflict-aware', 'Managed-file tracking helps avoid overwriting content Kitia does not own.']];
  return <section className="principles" id="approach" aria-labelledby="approach-title"><div className="shell principles-layout"><div><p className="eyebrow"><span className="status-dot" aria-hidden="true" />The Kitia approach</p><h2 id="approach-title">Catalog metadata stays local.<br /><em>Resources stay upstream.</em></h2><p className="principle-lede">Kitia brings catalog metadata into your local configuration. The resource bodies remain in the repositories that publish them.</p><a className="light-link" href={contract}>Read the CLI contract <span aria-hidden="true">↗</span></a></div><dl className="principle-details">{points.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl></div></section>;
}

function Commands() {
  const commands = [['Discover', 'kitia catalog list', 'See the catalogs you have configured.'], ['Inspect', 'kitia preview skill <id>', 'Review resource files before installation.'], ['Plan', 'kitia install skill <id> --dry-run', 'Inspect a lifecycle plan without changing files.']];
  return <section className="section shell commands" id="commands" aria-labelledby="commands-title"><div className="command-heading"><div><p className="eyebrow eyebrow-dark">Made for the terminal</p><h2 id="commands-title">One clear step<br />at a time.</h2></div><p>Use Kitia's CLI or interactive dashboard to browse and manage resources across Claude Code and GitHub Copilot.</p></div><div className="command-list">{commands.map(([label, command, description]) => <article key={label}><span>{label}</span><code>{command}</code><p>{description}</p></article>)}</div></section>;
}

function Closing() {
  return <section className="closing" aria-labelledby="closing-title"><div className="shell closing-inner"><div><p className="eyebrow"><span className="status-dot" aria-hidden="true" />Open source · Your tools · Your choice</p><h2 id="closing-title">Start with a catalog<br />you already trust.</h2></div><div className="closing-actions"><a className="button button-light" href={`${repo}#readme`}>Get started on GitHub <span aria-hidden="true">↗</span></a><a href={contract}>Explore the CLI contract <span aria-hidden="true">→</span></a></div></div></section>;
}

function App() {
  return <><a className="skip-link" href="#main">Skip to content</a><Header /><main id="main"><section className="hero shell" id="top" aria-labelledby="hero-title"><div className="hero-copy"><p className="eyebrow"><span className="status-dot" aria-hidden="true" />An open-source resource manager</p><h1 id="hero-title">Bring your AI resources <em>into focus.</em></h1><p className="hero-intro">Browse external catalogs of skills, agents, and instructions. Choose what belongs in Claude Code or GitHub Copilot—with your sources and files under your control.</p><div className="hero-actions"><a className="button button-primary" href="#workflow">Explore the workflow <span aria-hidden="true">↓</span></a><a className="text-link" href={`${repo}#readme`}>Read the README <span aria-hidden="true">↗</span></a></div><div className="hero-note"><span aria-hidden="true">01</span>Metadata stays local. Resource bodies stay upstream.</div></div><figure className="hero-aside hero-product"><div className="product-bar"><span><i aria-hidden="true" />kitia · workspace inventory</span><span>demo data</span></div><a className="screen-image-link" href={workspaceScreenshot} target="_blank" rel="noopener" aria-label="Open full-size Termless workspace inventory screenshot with demo data"><img src={workspaceScreenshot} alt="Termless xterm.js rendering of Kitia's actual Ink dashboard, showing project ask-matt selected beside the inventory rows for user grill-me and unmanaged herdr." fetchPriority="high" /></a><figcaption>Real Ink dashboard · Termless · demo inventory</figcaption></figure></section><div className="trust-strip" aria-label="Resource types and supported tools"><div className="shell strip-inner"><span>One tool for the resources you choose</span><div><b>Skills</b><i>·</i><b>Agents</b><i>·</i><b>Instructions</b></div><span>Claude Code <i>+</i> GitHub Copilot</span></div></div><ProductPreview /><Workflow /><Principles /><Commands /><Closing /></main><footer className="site-footer shell"><Brand footer /><p>Open-source CLI for the AI resources you choose.</p><div className="footer-links"><a href={repo}>Repository</a><a href={`${repo}#readme`}>README</a><a href={contract}>CLI contract</a></div><span className="copyright">© Kitia contributors</span></footer></>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
