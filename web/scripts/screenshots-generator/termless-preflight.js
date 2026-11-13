"use strict";

const minimum = [26, 0, 0];

function supportsTermless(version = process.versions.node) {
  const current = version.split(".").map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((current[index] || 0) > minimum[index]) return true;
    if ((current[index] || 0) < minimum[index]) return false;
  }
  return true;
}

function assertTermlessRuntime(version = process.versions.node) {
  if (!supportsTermless(version)) {
    throw new Error(
      `Kitia's Termless dashboard tooling requires Node.js >=26.0.0; current version is ${version}.`,
    );
  }
}

if (require.main === module) {
  try {
    assertTermlessRuntime();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { assertTermlessRuntime, supportsTermless };
