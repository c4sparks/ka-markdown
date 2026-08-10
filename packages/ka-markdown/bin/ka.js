#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli');

run().then(function (code) {
  process.exitCode = code;
}).catch(function (e) {
  process.stderr.write(String((e && e.stack) || e) + '\n');
  process.exitCode = 1;
});
