// TOTP для Android WebView: чистый JS без Node crypto и без Web Crypto.
// Так работает на любом origin, включая file://, где crypto.subtle недоступен.

// ---------- SHA-1 ----------
function sha1(bytes) {
  const ml = bytes.length;
  const total = ((ml + 9 + 63) & ~63);
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = ml * 8;
  dv.setUint32(total - 8, Math.floor(bits / 4294967296));
  dv.setUint32(total - 4, bits >>> 0);
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);
  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
    for (let j = 16; j < 80; j++) { const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]; w[j] = (n << 1) | (n >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = ((((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0);
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20), ov = new DataView(out.buffer);
  ov.setUint32(0, h0); ov.setUint32(4, h1); ov.setUint32(8, h2); ov.setUint32(12, h3); ov.setUint32(16, h4);
  return out;
}

// ---------- SHA-256 ----------
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

function sha256(bytes) {
  const ml = bytes.length;
  const total = ((ml + 9 + 63) & ~63);
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = ml * 8;
  dv.setUint32(total - 8, Math.floor(bits / 4294967296));
  dv.setUint32(total - 4, bits >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3);
      const s1 = ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[j] + w[j]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

// ---------- SHA-512 (64-битная арифметика через BigInt) ----------
const K512 = [
  '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc',
  '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
  'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
  '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
  'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65',
  '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
  '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4',
  'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
  '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
  '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
  'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30',
  'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8',
  '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
  '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
  '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
  'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178',
  '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
  '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c',
  '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817'
].map(h => BigInt('0x' + h));

const M64 = (1n << 64n) - 1n;
const rotr64 = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;

function sha512(bytes) {
  const ml = bytes.length;
  const total = ((ml + 17 + 127) & ~127);
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[ml] = 0x80;
  const bits = BigInt(ml) * 8n;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Number((bits >> 32n) & 0xffffffffn));
  dv.setUint32(total - 4, Number(bits & 0xffffffffn));
  let H = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
           0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
  const w = new Array(80);
  for (let i = 0; i < total; i += 128) {
    for (let j = 0; j < 16; j++) {
      let v = 0n;
      for (let b = 0; b < 8; b++) v = (v << 8n) | BigInt(buf[i + j * 8 + b]);
      w[j] = v;
    }
    for (let j = 16; j < 80; j++) {
      const s0 = rotr64(w[j - 15], 1) ^ rotr64(w[j - 15], 8) ^ (w[j - 15] >> 7n);
      const s1 = rotr64(w[j - 2], 19) ^ rotr64(w[j - 2], 61) ^ (w[j - 2] >> 6n);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) & M64;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 80; j++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ (~e & g & M64);
      const t1 = (h + S1 + ch + K512[j] + w[j]) & M64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) & M64;
      h = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) & M64);
  }
  const out = new Uint8Array(64);
  H.forEach((v, i) => { for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((v >> BigInt(56 - b * 8)) & 0xffn); });
  return out;
}

const HASHES = {
  SHA1: { fn: sha1, block: 64 },
  SHA256: { fn: sha256, block: 64 },
  SHA512: { fn: sha512, block: 128 }
};

function hmac(algorithm, key, message) {
  const { fn, block } = HASHES[algorithm];
  let k = key;
  if (k.length > block) k = fn(k);
  const ipad = new Uint8Array(block), opad = new Uint8Array(block);
  for (let i = 0; i < block; i++) { ipad[i] = (k[i] || 0) ^ 0x36; opad[i] = (k[i] || 0) ^ 0x5c; }
  const inner = fn(concat(ipad, message));
  return fn(concat(opad, inner));
}

function concat(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }

// ---------- Base32 / Base64 ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(text) {
  let bits = '';
  for (const c of String(text).toUpperCase().replace(/[\s=-]/g, '')) {
    const n = B32.indexOf(c);
    if (n < 0) throw Error('Неверный ключ Base32');
    bits += n.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  if (!bytes.length) throw Error('Пустой ключ');
  return new Uint8Array(bytes);
}

export function keyBase32(b64) {
  const bytes = base64ToBytes(b64);
  let bits = '', out = '';
  for (const n of bytes) bits += n.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ---------- Разбор ключей ----------
export function parseSecret(input, encoding = 'auto') {
  input = String(input).trim();
  let name = '', issuer = '', algorithm = 'SHA1', digits = 6, period = 30, key;
  if (input.startsWith('otpauth://')) {
    const uri = new URL(input);
    if (uri.hostname !== 'totp') throw Error('Поддерживаются только TOTP QR-коды');
    name = decodeURIComponent(uri.pathname.slice(1));
    issuer = uri.searchParams.get('issuer') || '';
    algorithm = (uri.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    digits = Number(uri.searchParams.get('digits') || 6);
    period = Number(uri.searchParams.get('period') || 30);
    key = base32(uri.searchParams.get('secret') || '');
  } else if (encoding === 'base64') {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input) || input.length % 4 === 1) throw Error('Неверный Base64');
    const decoded = base64ToBytes(input);
    let str = '';
    try { str = new TextDecoder().decode(decoded); } catch { str = ''; }
    if (str.startsWith('otpauth://')) return parseSecret(str);
    key = /^[A-Z2-7\s=-]+$/i.test(str) ? base32(str) : decoded;
  } else {
    key = base32(input);
  }
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm) || ![6, 8].includes(digits) ||
      !Number.isInteger(period) || period < 1 || period > 300) throw Error('Неподдерживаемые параметры TOTP');
  if (key.length < 10 || key.length > 1024) throw Error('Ключ должен содержать от 10 до 1024 байт');
  return { secret: bytesToBase64(key), name, issuer, algorithm, digits, period };
}

export function totp(account, time = Date.now()) {
  const key = base64ToBytes(account.secret);
  const counter = BigInt(Math.floor(time / 1000 / account.period));
  const msg = new Uint8Array(8);
  for (let i = 0; i < 8; i++) msg[7 - i] = Number((counter >> BigInt(i * 8)) & 0xffn);
  const hash = hmac(account.algorithm, key, msg);
  const offset = hash[hash.length - 1] & 15;
  const value = ((hash[offset] & 0x7f) * 16777216) + (hash[offset + 1] << 16) + (hash[offset + 2] << 8) + hash[offset + 3];
  return String(value % 10 ** account.digits).padStart(account.digits, '0');
}

// ---------- Перенос из Google Authenticator ----------
function readVarint(buf, pos) {
  let value = 0, shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [value, pos];
    shift += 7;
    if (shift > 56) throw Error('Некорректные данные переноса');
  }
  throw Error('Обрезанные данные переноса');
}

function readFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag; [tag, pos] = readVarint(buf, pos);
    const field = tag >> 3, wire = tag & 7;
    if (!field) throw Error('Некорректные данные переноса');
    if (wire === 0) { let v; [v, pos] = readVarint(buf, pos); fields.push([field, wire, v]); }
    else if (wire === 2) {
      let len; [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw Error('Обрезанные данные переноса');
      fields.push([field, wire, buf.subarray(pos, pos + len)]); pos += len;
    } else if (wire === 5) { fields.push([field, wire, buf.subarray(pos, pos + 4)]); pos += 4; }
    else if (wire === 1) { fields.push([field, wire, buf.subarray(pos, pos + 8)]); pos += 8; }
    else throw Error('Некорректные данные переноса');
  }
  return fields;
}

const MIGRATION_ALGORITHMS = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512', 4: 'MD5' };

function migrationAccount(buf) {
  let secret = null, name = '', issuer = '', algorithm = 'SHA1', digits = 6, type = 2;
  for (const [field, wire, value] of readFields(buf)) {
    if (field === 1 && wire === 2) secret = value;
    else if (field === 2 && wire === 2) name = new TextDecoder().decode(value);
    else if (field === 3 && wire === 2) issuer = new TextDecoder().decode(value);
    else if (field === 4 && wire === 0) algorithm = MIGRATION_ALGORITHMS[value] || 'SHA1';
    else if (field === 5 && wire === 0) digits = value === 2 ? 8 : 6;
    else if (field === 6 && wire === 0) type = value;
  }
  const label = (name.trim() || issuer.trim() || 'Аккаунт').slice(0, 100);
  if (!secret || !secret.length) throw Error('В записи переноса нет ключа: ' + label);
  if (type === 1) throw Error('Аккаунт «' + label + '» использует HOTP — такие коды не поддерживаются');
  if (algorithm === 'MD5') throw Error('Аккаунт «' + label + '» использует MD5 — такие коды не поддерживаются');
  const uri = new URL('otpauth://totp/' + encodeURIComponent(label));
  uri.searchParams.set('secret', keyBase32(bytesToBase64(secret)));
  if (issuer.trim()) uri.searchParams.set('issuer', issuer.trim().slice(0, 500));
  uri.searchParams.set('algorithm', algorithm);
  uri.searchParams.set('digits', String(digits));
  uri.searchParams.set('period', '30');
  const parsed = parseSecret(uri.toString());
  return { ...parsed, name: label, issuer: issuer.trim().slice(0, 500) };
}

export function parseMigration(input) {
  const text = String(input || '').trim();
  if (!text.startsWith('otpauth-migration://')) throw Error('Это не QR-код переноса Google Authenticator');
  let data;
  try { data = new URL(text).searchParams.get('data'); } catch { throw Error('Некорректная ссылка переноса'); }
  if (!data) throw Error('В ссылке переноса нет данных');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error('Некорректные данные переноса');
  const buffer = base64ToBytes(data);
  if (!buffer.length) throw Error('Пустые данные переноса');
  if (buffer.length > 64 * 1024) throw Error('Слишком большой объём данных переноса');
  const accounts = [];
  let batchSize = null, batchIndex = null;
  for (const [field, wire, value] of readFields(buffer)) {
    if (field === 1 && wire === 2) accounts.push(migrationAccount(value));
    else if (field === 3 && wire === 0) batchSize = value;
    else if (field === 4 && wire === 0) batchIndex = value;
  }
  if (!accounts.length) throw Error('В данных переноса нет аккаунтов');
  return { accounts, batchSize, batchIndex };
}
