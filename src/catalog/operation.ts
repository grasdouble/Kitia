"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { CatalogError } = require("./resources/index.js");

const OPERATION_LOCK = ".kitia-operation.lock";

function inspectOperationLock(target) {
  const file = path.join(fs.realpathSync(target), OPERATION_LOCK);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return { status: "absent" };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { status: "unknown", message: "The operation lock is not a regular file." };
  }
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { status: "unknown", message: "The operation lock is incomplete or invalid." };
  }
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.host !== "string" || typeof owner.token !== "string") {
    return { status: "unknown", message: "The operation lock has invalid ownership metadata." };
  }
  if (owner.host !== os.hostname()) return { status: "unknown", owner };
  try {
    process.kill(owner.pid, 0);
    return { status: "active", owner };
  } catch (error) {
    if (error.code === "ESRCH") return { status: "stale", owner };
    if (error.code === "EPERM") return { status: "active", owner };
    throw error;
  }
}

function acquireOperationLock(target) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`, "INVALID_TARGET");
  }
  const root = fs.realpathSync(target);
  const file = path.join(root, OPERATION_LOCK);
  const token = crypto.randomUUID();
  let descriptor;
  try {
    descriptor = fs.openSync(file, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const lock = inspectOperationLock(root);
    const recovery = lock.status === "stale"
      ? "The recorded process no longer exists. Review the interrupted operation and remove this lock explicitly before retrying."
      : "Wait for the other operation to finish. Do not remove an active or unknown lock.";
    throw new CatalogError(
      `Target operation is locked: ${file}${lock.owner ? ` (PID ${lock.owner.pid}, host ${lock.owner.host})` : ""}. ${recovery}`,
      lock.status === "stale" ? "STALE_OPERATION_LOCK" : "OPERATION_LOCKED",
    );
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify({
      pid: process.pid, host: os.hostname(), token, started_at: new Date().toISOString(),
    })}\n`);
  } catch (error) {
    fs.closeSync(descriptor);
    fs.unlinkSync(file);
    throw error;
  }
  fs.closeSync(descriptor);
  return () => {
    const lock = inspectOperationLock(root);
    if (lock.owner?.token !== token) {
      throw new CatalogError(`Operation lock ownership changed: ${file}; refusing to remove it.`, "OPERATION_LOCK_CHANGED");
    }
    fs.unlinkSync(file);
  };
}

module.exports = { OPERATION_LOCK, acquireOperationLock, inspectOperationLock };
