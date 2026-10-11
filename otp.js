import {createHmac} from 'node:crypto';
export function base32(text){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of text.toUpperCase().replace(/[\s=-]/g,'')){const n=alphabet.indexOf(c);if(n<0)throw Error('Неверный ключ Base32');bits+=n.toString(2).padStart(5,'0')}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));if(!bytes.length)throw Error('Пустой ключ');return Buffer.from(bytes)}
export function parseSecret(input,encoding='auto'){input=input.trim();let name='',issuer='',algorithm='SHA1',digits=6,period=30,key;
if(input.startsWith('otpauth://')){const uri=new URL(input);if(uri.hostname!=='totp')throw Error('Поддерживаются только TOTP QR-коды');name=decodeURIComponent(uri.pathname.slice(1));issuer=uri.searchParams.get('issuer')||'';algorithm=(uri.searchParams.get('algorithm')||'SHA1').toUpperCase();digits=Number(uri.searchParams.get('digits')||6);period=Number(uri.searchParams.get('period')||30);key=base32(uri.searchParams.get('secret')||'');}
else if(encoding==='base64'){if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input)||input.length%4===1)throw Error('Неверный Base64');const decoded=Buffer.from(input,'base64');const str=decoded.toString('utf8');if(str.startsWith('otpauth://'))return parseSecret(str);key=/^[A-Z2-7\s=-]+$/i.test(str)?base32(str):decoded;}
else key=base32(input);
if(!['SHA1','SHA256','SHA512'].includes(algorithm)||![6,8].includes(digits)||!Number.isInteger(period)||period<1||period>300)throw Error('Неподдерживаемые параметры TOTP');if(key.length<10||key.length>1024)throw Error('Ключ должен содержать от 10 до 1024 байт');return {secret:key.toString('base64'),name,issuer,algorithm,digits,period};}
export function totp(account,time=Date.now()){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/1000/account.period)));const hash=createHmac(account.algorithm.toLowerCase(),Buffer.from(account.secret,'base64')).update(counter).digest();const offset=hash.at(-1)&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%10**account.digits).padStart(account.digits,'0');}
export function keyBase32(secret){let bits=[...Buffer.from(secret,'base64')].map(n=>n.toString(2).padStart(8,'0')).join('');let out='';for(let i=0;i<bits.length;i+=5)out+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];return out;}

// --- Перенос из Google Authenticator: otpauth-migration://offline?data=<base64 protobuf> ---
// Схема MigrationPayload / OtpParameters из открытого формата Google Authenticator.
function readVarint(buffer,position){let value=0,shift=0;while(position<buffer.length){const byte=buffer[position++];value+=(byte&0x7f)*2**shift;if(!(byte&0x80))return [value,position];shift+=7;if(shift>56)throw Error('Некорректные данные переноса');}throw Error('Обрезанные данные переноса');}
function readFields(buffer){const fields=[];let position=0;while(position<buffer.length){let tag;[tag,position]=readVarint(buffer,position);const field=tag>>3,wire=tag&7;if(!field)throw Error('Некорректные данные переноса');if(wire===0){let value;[value,position]=readVarint(buffer,position);fields.push([field,wire,value]);}else if(wire===2){let length;[length,position]=readVarint(buffer,position);if(position+length>buffer.length)throw Error('Обрезанные данные переноса');fields.push([field,wire,buffer.subarray(position,position+length)]);position+=length;}else if(wire===5){if(position+4>buffer.length)throw Error('Обрезанные данные переноса');fields.push([field,wire,buffer.subarray(position,position+4)]);position+=4;}else if(wire===1){if(position+8>buffer.length)throw Error('Обрезанные данные переноса');fields.push([field,wire,buffer.subarray(position,position+8)]);position+=8;}else throw Error('Некорректные данные переноса');}return fields;}
const MIGRATION_ALGORITHMS={1:'SHA1',2:'SHA256',3:'SHA512',4:'MD5'};
function migrationAccount(buffer){
 let secret=null,name='',issuer='',algorithm='SHA1',digits=6,type=2;
 for(const [field,wire,value] of readFields(buffer)){
  if(field===1&&wire===2)secret=value;
  else if(field===2&&wire===2)name=value.toString('utf8');
  else if(field===3&&wire===2)issuer=value.toString('utf8');
  else if(field===4&&wire===0)algorithm=MIGRATION_ALGORITHMS[value]||'SHA1';
  else if(field===5&&wire===0)digits=value===2?8:6;
  else if(field===6&&wire===0)type=value;
 }
 const label=(name.trim()||issuer.trim()||'Аккаунт').slice(0,100);
 if(!secret||!secret.length)throw Error('В записи переноса нет ключа: '+label);
 if(type===1)throw Error('Аккаунт «'+label+'» использует HOTP — такие коды не поддерживаются');
 if(algorithm==='MD5')throw Error('Аккаунт «'+label+'» использует MD5 — такие коды не поддерживаются');
 const uri=new URL('otpauth://totp/'+encodeURIComponent(label));
 uri.searchParams.set('secret',keyBase32(secret.toString('base64')));
 if(issuer.trim())uri.searchParams.set('issuer',issuer.trim().slice(0,500));
 uri.searchParams.set('algorithm',algorithm);uri.searchParams.set('digits',String(digits));uri.searchParams.set('period','30');
 const parsed=parseSecret(uri.toString());
 return {...parsed,name:label,issuer:issuer.trim().slice(0,500)};
}
export function parseMigration(input){
 const text=String(input||'').trim();
 if(!text.startsWith('otpauth-migration://'))throw Error('Это не QR-код переноса Google Authenticator');
 let data;try{data=new URL(text).searchParams.get('data');}catch{throw Error('Некорректная ссылка переноса');}
 if(!data)throw Error('В ссылке переноса нет данных');
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw Error('Некорректные данные переноса');
 const buffer=Buffer.from(data,'base64');
 if(!buffer.length)throw Error('Пустые данные переноса');
 if(buffer.length>64*1024)throw Error('Слишком большой объём данных переноса');
 const accounts=[];let batchSize=null,batchIndex=null;
 for(const [field,wire,value] of readFields(buffer)){
  if(field===1&&wire===2)accounts.push(migrationAccount(value));
  else if(field===3&&wire===0)batchSize=value;
  else if(field===4&&wire===0)batchIndex=value;
 }
 if(!accounts.length)throw Error('В данных переноса нет аккаунтов');
 return {accounts,batchSize,batchIndex};
}
