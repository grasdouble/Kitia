'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [command, action, repository, pointer] = process.argv.slice(2);
const repo = process.env.KITIA_TEST_WEB_CATALOG_REPO;
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

if (command === 'skill' && action === 'preview' && repository === 'example/web-catalog') {
  const [directory, ref] = pointer.split('@');
  const file = (name) => git('show', `${ref}:${directory}/${name}`);
  process.stdout.write(
    [
      'catalog-skill/',
      '├── SKILL.md',
      '└── references/',
      '    └── review.md',
      '',
      '── SKILL.md ──',
      '',
      file('SKILL.md'),
      '── references/review.md ──',
      '',
      file('references/review.md'),
    ].join('\n'),
  );
} else if (command === 'skill' && action === 'install' && repository === 'example/web-catalog') {
  const args = process.argv.slice(2);
  const target = args[args.indexOf('--dir') + 1];
  const ref = args[args.indexOf('--pin') + 1];
  if (!path.isAbsolute(target) || args.includes('--force')) throw new Error('Expected a non-forced, absolute install.');
  const installed = path.join(target, path.posix.basename(pointer));
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(installed);
  fs.writeFileSync(
    path.join(installed, 'SKILL.md'),
    `---\nmetadata:\n  github-repo: ${repository}\n  github-path: ${pointer}\n  github-pinned: ${ref}\n---\n\n${git('show', `${ref}:${pointer}/SKILL.md`)}`,
  );
  fs.mkdirSync(path.join(installed, 'references'));
  fs.writeFileSync(
    path.join(installed, 'references', 'review.md'),
    git('show', `${ref}:${pointer}/references/review.md`),
  );
} else if (command === 'api' && process.argv.includes('repos/example/web-catalog/commits')) {
  const file = process.argv.find((argument) => argument.startsWith('path='))?.slice(5);
  const log = git('log', '--format=%H%x00%cI%x00%s', '--', file).trim();
  process.stdout.write(
    JSON.stringify(
      log
        ? log.split('\n').map((line) => {
            const [sha, date, message] = line.split('\0');
            return { sha, commit: { committer: { date }, message } };
          })
        : [],
    ),
  );
} else {
  throw new Error(`Unexpected GitHub fixture operation: ${process.argv.slice(2).join(' ')}`);
}
