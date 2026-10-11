import {randomUUID} from 'node:crypto';
import {parseSecret, keyBase32} from './otp.js';
export function exportBackup(accounts){return JSON.stringify({format:'material-authenticator',version:1,exportedAt:new Date().toISOString(),accounts:accounts.map(({remote,...account})=>account)},null,2);}
export function mergeBackup(text,existing){
 const data=JSON.parse(text);
 if(data?.format!=='material-authenticator'||data.version!==1||!Array.isArray(data.accounts)||data.accounts.length>10000)throw Error('Неподдерживаемый файл экспорта');
 const validated=data.accounts.map((a,index)=>{
  if(!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>100||typeof a.secret!=='string'||!a.secret.length||a.secret.length>1400||typeof a.issuer!=='string'||a.issuer.length>500||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.secret)||!['SHA1','SHA256','SHA512'].includes(a.algorithm)||![6,8].includes(a.digits)||!Number.isInteger(a.period))throw Error('Некорректный аккаунт №'+(index+1));
  const uri=new URL('otpauth://totp/'+encodeURIComponent(a.name));
  for(const [key,value] of Object.entries({secret:keyBase32(a.secret),algorithm:a.algorithm,digits:a.digits,period:a.period}))uri.searchParams.set(key,value);
  const parsed=parseSecret(uri.toString());
  return {...parsed,name:a.name.trim(),issuer:a.issuer,id:randomUUID()};
 });
 const next=[...existing];let added=0,skipped=0;
 for(const a of validated){if(next.some(b=>b.secret===a.secret&&b.algorithm===a.algorithm&&b.digits===a.digits&&b.period===a.period)){skipped++;continue;}next.push(a);added++;}
 return {accounts:next,added,skipped};
}
