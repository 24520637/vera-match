const {generateKeyPairSync,randomBytes,randomUUID}=require('node:crypto');
const {mkdtempSync,writeFileSync,unlinkSync,rmdirSync}=require('node:fs');
const {tmpdir}=require('node:os'); const {join,resolve}=require('node:path'); const {spawnSync}=require('node:child_process');
const root=resolve(__dirname,'..'); const url=new URL(process.env.DATABASE_URL??'');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port!=='5433'||process.env.VERA_SAFETY_E2E_RUN_ID)throw new Error('Isolated local staff MFA runner required');
const directory=mkdtempSync(join(tmpdir(),'vera-staff-browser-')),publicFile=join(directory,'authority.pub.json'),privateFile=join(directory,'fixture-authority.private.pem'),wrappingFile=join(directory,'wrapping.json');
const authority=generateKeyPairSync('ed25519'),runId=randomUUID();
writeFileSync(publicFile,JSON.stringify({schemaVersion:1,keys:[{id:'synthetic-browser-root',publicKeyPem:authority.publicKey.export({type:'spki',format:'pem'}).toString()}]}),{mode:0o600});
writeFileSync(privateFile,authority.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
writeFileSync(wrappingFile,JSON.stringify({schemaVersion:1,activeKeyId:'synthetic-browser-key',keys:[{id:'synthetic-browser-key',keyBase64url:randomBytes(32).toString('base64url')}]}),{mode:0o600});
const env={...process.env,VERA_AUTH_E2E_RUN_ID:runId,VERA_STAFF_MFA_E2E_RUN_ID:runId,STAFF_AUTHORITY_KEYS_PATH:publicFile,STAFF_MFA_KEYRING_PATH:wrappingFile,VERA_STAFF_MFA_FIXTURE_PRIVATE_PATH:privateFile,API_INTERNAL_ORIGIN:'http://localhost:4100'};
let status=1;
try{
 for(const [file,args,cwd] of [
  ['node_modules/@nestjs/cli/bin/nest.js',['build'],'apps/api'],
  ['node_modules/next/dist/bin/next',['build'],'apps/web'],
  ['node_modules/playwright/cli.js',['test','--config','playwright.staff.config.ts',...process.argv.slice(2)],'apps/web'],
 ]){const result=spawnSync(process.execPath,[resolve(root,file),...args],{cwd:resolve(root,cwd),env,windowsHide:true,stdio:'inherit'});status=result.status??1;if(status!==0)break;}
}finally{for(const file of [publicFile,privateFile,wrappingFile])unlinkSync(file);rmdirSync(directory);}
process.exitCode=status;
