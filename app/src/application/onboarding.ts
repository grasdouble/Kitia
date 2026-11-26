import fs from 'node:fs';
import path from 'node:path';

import { userCatalogDirectory } from '../core/catalogs/config.js';

const marker = 'onboarding-complete';

export function hasSeenOnboarding() {
  return fs.existsSync(path.join(userCatalogDirectory(), marker));
}

export function markOnboardingComplete() {
  const directory = userCatalogDirectory();
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, marker), '1\n');
}
