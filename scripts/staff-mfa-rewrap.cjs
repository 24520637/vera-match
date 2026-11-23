const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const entry = path.join(root,'apps/api/dist/staff-security/staff-mfa-rewrap.main.js');
if (!fs.existsSync(entry)) { console.error('STAFF_BUILD_REQUIRED: build the API before rotating keys.'); process.exitCode=1; }
else { const result=cp.spawnSync(process.execPath,[entry,...process.argv.slice(2)],{cwd:path.join(root,'apps/api'),env:process.env,windowsHide:true,stdio:'inherit'}); process.exitCode=result.status??1; }
