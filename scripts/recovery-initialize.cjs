'use strict';
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const result = spawnSync(process.execPath, [resolve(__dirname, '../apps/api/dist/recovery/recovery-initialize.main.js'), ...process.argv.slice(2)],
  { windowsHide: true, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
