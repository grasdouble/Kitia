'use strict';

const { execFileSync } = require('node:child_process');
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
