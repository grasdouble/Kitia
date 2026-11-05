#!/usr/bin/env node
"use strict";

const manifest = require("../../package.json");
process.env.KITIA_INSTALLED_VERSION = manifest.version;
startKitia();

function startKitia() {
  if (process.argv[2] === "migrate") {
    process.exitCode = require("../migrations/run.js").main(process.argv.slice(3));
  } else {
    const { main } = require("../dist/cli/main.js");
    main().then((exitCode) => {
      process.exitCode = exitCode;
    }).catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

