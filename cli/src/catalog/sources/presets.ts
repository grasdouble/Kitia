export type CatalogPreset = {
  command: string;
  name: string;
  catalogName: string;
  repository: string;
  mode: "basic" | "custom";
  entries: Array<{ kind: "skill" | "agent" | "instruction"; id?: string; path: string }>;
};

export const CATALOG_PRESETS: readonly CatalogPreset[] = [
  {
    command: "anthropics",
    name: "Anthropics",
    catalogName: "Anthropics",
    repository: "https://github.com/anthropics/skills",
    mode: "basic",
    entries: [],
  },
  {
    command: "matt-pocock",
    name: "Matt Pocock",
    catalogName: "matt-pocock",
    repository: "https://github.com/mattpocock/skills",
    mode: "basic",
    entries: [],
  },
  {
    command: "github-awesome-copilot",
    name: "GitHub Awesome Copilot",
    catalogName: "github-awesome-copilot",
    repository: "https://github.com/github/awesome-copilot",
    mode: "basic",
    entries: [],
  },
];
