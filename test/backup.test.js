import test from 'node:test';
import assert from 'node:assert/strict';
import {exportBackup,mergeBackup} from '../backup.js';
import {parseSecret,totp} from '../otp.js';
const local={...parseSecret('otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60'),name:'Example',issuer:'Example issuer',id:'old-id'};
test('export/import preserves key, name, issuer, TOTP parameters and local generation',()=>{
 const remote={...parseSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),name:'Remote',issuer:'',remote:true,id:'remote-id'};
 const result=mergeBackup(exportBackup([local,remote]),[]);
 assert.equal(result.added,2);assert.equal(result.skipped,0);
 for(const [i,a] of [local,remote].entries()){
  const restored=result.accounts[i];assert.notEqual(restored.id,a.id);
  for(const key of ['name','issuer','secret','algorithm','digits','period'])assert.equal(restored[key],a[key]);
  assert.equal('remote' in restored,false);assert.equal(totp(restored,1234567890000),totp(a,1234567890000));
 }
});
test('merge keeps existing accounts and skips duplicates within backup',()=>{
 const result=mergeBackup(exportBackup([local,local]),[local]);assert.equal(result.added,0);assert.equal(result.skipped,2);assert.deepEqual(result.accounts,[local]);
});
test('invalid backup is rejected entirely without changing existing data',()=>{
 const existing=[local];const json=exportBackup([local,{...local,period:0}]);assert.throws(()=>mergeBackup(json,existing));assert.deepEqual(existing,[local]);
 assert.throws(()=>mergeBackup('{',existing));assert.throws(()=>mergeBackup(JSON.stringify({format:'unknown',version:1,accounts:[]}),existing));assert.throws(()=>mergeBackup(exportBackup([{...local,secret:'bad!'}]),existing));
});

test('legacy backup with API flags is imported for local generation',()=>{
 const old={...local,remote:true};
 const result=mergeBackup(JSON.stringify({format:'material-authenticator',version:1,accounts:[old]}),[]);
 assert.equal(result.added,1);assert.equal('remote' in result.accounts[0],false);
 assert.equal(totp(result.accounts[0],59000),totp(local,59000));
 assert.equal('remote' in JSON.parse(exportBackup([old])).accounts[0],false);
});
