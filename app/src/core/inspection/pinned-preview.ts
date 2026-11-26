import type { PreparedPinnedSourceFile } from '../resources/content.js';
import type { AuditResult } from './audit.js';
import { auditTextResources } from './audit.js';
function auditPreparedSourceFile(prepared: PreparedPinnedSourceFile): AuditResult {
  return auditTextResources([
    {
      path: prepared.path,
      kind: prepared.resource.kind,
      content: prepared.content,
    },
  ]);
}

export { auditPreparedSourceFile };
