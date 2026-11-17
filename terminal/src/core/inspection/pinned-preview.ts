import type { AuditResult } from "./audit.js";
import type { PreparedPinnedSourceFile } from "../resources/content.js";
"use strict";

const { auditTextResources } = require("./audit.js");
function auditPreparedSourceFile(
  prepared: PreparedPinnedSourceFile,
): AuditResult {
  return auditTextResources([{
    path: prepared.path,
    kind: prepared.resource.kind,
    content: prepared.content,
  }]);
}

module.exports = { auditPreparedSourceFile };
