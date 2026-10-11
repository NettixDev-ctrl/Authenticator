import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMigration,totp} from '../otp.js';

// Ручное кодирование protobuf — независимо от декодера в otp.js.
function varint(value){const bytes=[];do{let byte=value&0x7f;value=Math.floor(value/128);if(value)byte|=0x80;bytes.push(byte);}while(value);return Buffer.from(bytes);}
function tag(field,wire){return varint((field<<3)|wire);}
function lenField(field,value){return Buffer.concat([tag(field,2),varint(value.length),value]);}
function numField(field,value){return Buffer.concat([tag(field,0),varint(value)]);}
function entry({secret,name,issuer,algorithm=1,digits=1,type=2}){const parts=[lenField(1,secret)];if(name!==undefined)parts.push(lenField(2,Buffer.from(name,'utf8')));if(issuer!==undefined)parts.push(lenField(3,Buffer.from(issuer,'utf8')));parts.push(numField(4,algorithm),numField(5,digits),numField(6,type));return Buffer.concat(parts);}
function payload(entries,{batchSize=1,batchIndex=0}={}){return Buffer.concat([...entries.map(e=>lenField(1,e)),numField(2,1),numField(3,batchSize),numField(4,batchIndex),numField(5,424242)]);}
function uri(buffer){return 'otpauth-migration://offline?data='+encodeURIComponent(buffer.toString('base64'));}

const RFC_SHA1=Buffer.from('12345678901234567890','utf8');

test('migration payload is decoded into a working TOTP account',()=>{
 const raw=payload([entry({secret:RFC_SHA1,name:'user@gmail.com',issuer:'Google',algorithm:1,digits:2})]);
 const {accounts}=parseMigration(uri(raw));
 assert.equal(accounts.length,1);
 const [account]=accounts;
 assert.equal(account.name,'user@gmail.com');
 assert.equal(account.issuer,'Google');
 assert.equal(account.algorithm,'SHA1');
 assert.equal(account.digits,8);
 assert.equal(account.period,30);
 assert.equal(account.secret,RFC_SHA1.toString('base64'));
 // Официальный вектор RFC 6238 для T=59
 assert.equal(totp(account,59000),'94287082');
});

test('SHA256 and SHA512 entries keep their algorithm and digits',()=>{
 const sha256=Buffer.from('12345678901234567890123456789012','utf8');
 const sha512=Buffer.from('1234567890123456789012345678901234567890123456789012345678901234','utf8');
 const raw=payload([
  entry({secret:sha256,name:'sha256',issuer:'Test',algorithm:2,digits:2}),
  entry({secret:sha512,name:'sha512',issuer:'Test',algorithm:3,digits:2}),
 ]);
 const {accounts}=parseMigration(uri(raw));
 assert.equal(accounts.length,2);
 assert.equal(totp(accounts[0],59000),'46119246');
 assert.equal(totp(accounts[1],59000),'90693936');
});

test('six digits is the default and batch metadata is exposed',()=>{
 const raw=payload([entry({secret:RFC_SHA1,name:'a',issuer:'Google',digits:1})],{batchSize:3,batchIndex:1});
 const {accounts,batchSize,batchIndex}=parseMigration(uri(raw));
 assert.equal(accounts[0].digits,6);
 assert.equal(batchSize,3);
 assert.equal(batchIndex,1);
});

test('entries without a name fall back to the issuer',()=>{
 const raw=payload([entry({secret:RFC_SHA1,name:'',issuer:'GitHub'})]);
 const {accounts}=parseMigration(uri(raw));
 assert.equal(accounts[0].name,'GitHub');
});

test('HOTP entries are rejected with a clear message',()=>{
 const raw=payload([entry({secret:RFC_SHA1,name:'hotp-account',issuer:'X',type:1})]);
 assert.throws(()=>parseMigration(uri(raw)),/HOTP/);
});

test('malformed and unrelated input is rejected',()=>{
 assert.throws(()=>parseMigration('otpauth://totp/x?secret=AAAA'),/не QR-код переноса/);
 assert.throws(()=>parseMigration('otpauth-migration://offline?data=%21%21%21'),/Некорректные данные/);
 assert.throws(()=>parseMigration('otpauth-migration://offline'),/нет данных/);
 assert.throws(()=>parseMigration('otpauth-migration://offline?data='+Buffer.from([0x08,0x01]).toString('base64')),/нет аккаунтов/);
 assert.throws(()=>parseMigration(uri(Buffer.from([0x0a,0x40,0x01]))),/Обрезанные данные/);
});
