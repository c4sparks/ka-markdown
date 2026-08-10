#!/usr/bin/env node
'use strict';

const { main } = require('../src/mcp/server');

main().catch(function (e) {
  process.stderr.write(String((e && e.stack) || e) + '\n');
  process.exit(1);
});
