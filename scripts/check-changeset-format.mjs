import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validateChangesetContent(content, filename = "<changeset>") {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return [`${filename}: expected YAML frontmatter delimited by --- lines`];
  if (!match[1].trim()) return [];

  const body = match[2].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  if (!body.trim()) {
    return [`${filename}: add a short description and indented details to this package Changeset`];
  }

  const lines = body.split(/\r?\n/);
  const errors = [];
  if (!lines[0] || lines[0].trim() !== lines[0] || /^\s+-\s/.test(lines[0])) {
    errors.push(`${filename}: first body line must be a short, unindented description`);
  }
  if (lines.length < 2) {
    errors.push(`${filename}: add details as indented "  - ..." lines after the description`);
  }
  for (const [index, line] of lines.slice(1).entries()) {
    if (!/^  - \S(?:.*\S)?$/.test(line)) {
      errors.push(`${filename}:${index + 2}: expected an indented detail in the form "  - ..."`);
    }
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
