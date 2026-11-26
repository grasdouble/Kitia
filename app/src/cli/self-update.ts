import { createInterface } from 'node:readline/promises';

import { prepareSelfUpdate, selfUpdateUnavailable } from '../application/self-update.js';
import { CatalogError } from '../core/resources/model.js';

export async function runSelfUpdate(yes: boolean, nonInteractive: boolean) {
  const update = await prepareSelfUpdate();
  if (!update) throw new CatalogError(selfUpdateUnavailable, 'SELF_UPDATE_UNAVAILABLE');
  if (!yes) {
    if (nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CatalogError(
        'Use kitia self-update --yes to confirm non-interactively.',
        'SELF_UPDATE_CONFIRMATION_REQUIRED',
      );
    }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await prompt.question(`Update Kitia globally with ${update.manager}? [y/N] `);
      if (!/^y(?:es)?$/i.test(answer.trim())) return 0;
    } finally {
      prompt.close();
    }
  }
  await update.apply();
  return 0;
}
