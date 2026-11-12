import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validateChangesetContent(content, filename = "<changeset>") {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return [`${filename}: expected YAML frontmatter delimited by --- lines`];
  if (!match[1].trim()) return [];

  const body = match[2].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  if (!body.trim()) {
    return [`${filename}: add a short description and grouped details to this package Changeset`];
  }

  const lines = body.split(/\r?\n/);
  const errors = [];
  if (!lines[0] || lines[0].trim() !== lines[0] || /^\s+-\s/.test(lines[0])) {
    errors.push(`${filename}: first body line must be a short, unindented description`);
  }
  if (lines.length < 2) {
    errors.push(`${filename}: add grouped details after the description`);
  }

  const groups = [];
  let currentGroup = null;
  let currentGroupDetails = 0;
  for (const [index, line] of lines.slice(1).entries()) {
    const group = line.match(/^  - \*\*(User-Facing|Technical)\*\*$/);
    if (group) {
      if (currentGroup && currentGroupDetails === 0) {
        errors.push(`${filename}:${index + 1}: ${currentGroup} group must contain at least one detail`);
      }
      const label = group[1];
      if (groups.includes(label)) {
        errors.push(`${filename}:${index + 1}: ${label} group must appear only once`);
      }
      if (label === "User-Facing" && groups.includes("Technical")) {
        errors.push(`${filename}:${index + 1}: User-Facing group must come before Technical`);
      }
      groups.push(label);
      currentGroup = label;
      currentGroupDetails = 0;
      continue;
    }

    if (/^    - \S(?:.*\S)?$/.test(line)) {
      if (!currentGroup) {
        errors.push(`${filename}:${index + 1}: detail must be inside a User-Facing or Technical group`);
      } else {
        currentGroupDetails += 1;
      }
      continue;
    }

    errors.push(`${filename}:${index + 1}: expected a group label or an indented detail bullet`);
  }

  if (currentGroup && currentGroupDetails === 0) {
    errors.push(`${filename}: ${currentGroup} group must contain at least one detail`);
  }
  if (groups.length === 0) {
    errors.push(`${filename}: add a User-Facing or Technical group`);
  }
  return errors;
}

export function validateChangesetDirectory(directory) {
  const files = fs.readdirSync(directory)
    .filter((filename) => filename.endsWith(".md") && filename !== "README.md")
    .sort();
  return files.flatMap((filename) =>
    validateChangesetContent(fs.readFileSync(path.join(directory, filename), "utf8"), filename));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const changesetDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.changeset");
  const errors = validateChangesetDirectory(changesetDirectory);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Changeset descriptions follow the repository format.");
  }
}
