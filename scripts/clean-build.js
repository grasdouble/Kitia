"use strict";

const fs = require("node:fs");
const path = require("node:path");

const output = path.resolve(__dirname, "..", "dist");
fs.rmSync(output, { recursive: true, force: true });
