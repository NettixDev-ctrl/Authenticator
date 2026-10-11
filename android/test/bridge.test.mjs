// Интеграционный тест: собирает тот же bundle, что попадает в APK,
// и прогоняет его в изолированном окружении с заглушками браузера.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Та же склейка, что делает build.sh. */
export function buildBundle() {
  const otp = readFileSync(join(ROOT, 'src/otp.js'), 'utf8').replace(/^export /gm, '');
  const bridge = readFileSync(join(ROOT, 'src/bridge.js'), 'utf8').replace(/^import .*$/gm, '');
  return `(function(){'use strict';\n${otp}\n${bridge}\n})();`;
}

/** Окружение, максимально похожее на WebView. */
function makeEnv({ now = 59000, files = {}, android = null } = {}) {
  const store = new Map();
  const sandbox = {};

  sandbox.window = sandbox;
  // Мост определяет наличие Android один раз при загрузке,
  // поэтому заглушка должна стоять до запуска бандла.
  if (android) sandbox.Android = android;
  sandbox.console = console;
  sandbox.atob = atob;
  sandbox.btoa = btoa;
  sandbox.TextDecoder = TextDecoder;
  sandbox.TextEncoder = TextEncoder;
  sandbox.URL = URL;
  sandbox.Blob = Blob;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;

  // Фиксируем время, чтобы коды совпадали с векторами RFC 6238
  const RealDate = Date;
  sandbox.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };

  sandbox.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };

  let pendingFile = files.next ?? null;
  sandbox.FileReader = class {
    readAsText() {
      this.result = pendingFile;
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  sandbox.document = {
    body: { appendChild() {} },
    createElement() {
      const el = {
        style: {}, files: null, isConnected: true,
        remove() { this.isConnected = false; },
        click() {
          const file = files.next;
          if (file == null) return;
          setTimeout(() => {
            el.files = [{}];
            el.onchange && el.onchange();
          }, 0);
        }
      };
      return el;
    }
  };
  sandbox.navigator = {};

  vm.createContext(sandbox);
  vm.runInContext(buildBundle(), sandbox, { filename: 'bundle.js' });
  return sandbox;
}

const B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // base32("12345678901234567890")

test('мост публикует API, совместимый с preload.cjs', () => {
  const env = makeEnv();
  const required = ['captureMode', 'captureNative', 'selectQR', 'windowControl', 'windowState',
    'onWindowState', 'list', 'add', 'rename', 'remove', 'codes', 'copy',
    'exportBackup', 'importBackup'];
  for (const name of required) {
    assert.equal(typeof env.auth[name], 'function', `нет метода ${name}`);
  }
});

test('добавление аккаунта и выдача кода по вектору RFC 6238', async () => {
  const env = makeEnv({ now: 59000 });
  const uri = `otpauth://totp/RFC?secret=${B32}&algorithm=SHA1&digits=8&period=30`;
  await env.auth.add({ name: 'RFC', input: uri, encoding: 'auto' });

  const list = await env.auth.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'RFC');
  assert.equal(list[0].secret, undefined, 'ключ не должен уходить в интерфейс');

  const [code] = await env.auth.codes();
  assert.equal(code.code, '94287082', 'код должен совпасть с RFC 6238');
  assert.equal(code.remaining, 1);
});

test('повторный ключ не добавляется', async () => {
  const env = makeEnv();
  const uri = `otpauth://totp/A?secret=${B32}`;
  await env.auth.add({ name: 'A', input: uri });
  await assert.rejects(() => env.auth.add({ name: 'B', input: uri }), /уже добавлен/);
  assert.equal((await env.auth.list()).length, 1);
});

test('перенос из Google Authenticator', async () => {
  const env = makeEnv();
  // Кодируем MigrationPayload вручную: один OtpParameters (SHA1, 6 цифр).
  // Длина вложенного сообщения считается по всем его полям, а не только по ключу.
  const secret = Uint8Array.from(atob('MTIzNDU2Nzg5MDEyMzQ1Njc4OTA='), c => c.charCodeAt(0));
  const name = new TextEncoder().encode('user@example.com');
  const inner = [0x0a, secret.length, ...secret, 0x12, name.length, ...name];
  const payload = Uint8Array.from([0x0a, inner.length, ...inner]);
  const data = btoa(String.fromCharCode(...payload));
  const uri = `otpauth-migration://offline?data=${encodeURIComponent(data)}`;

  const result = await env.auth.add({ input: uri, encoding: 'auto' });
  assert.equal(result.migration, true);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 0);

  const list = await env.auth.list();
  assert.equal(list[0].name, 'user@example.com');
  assert.equal(list[0].algorithm, 'SHA1');
  assert.equal(list[0].digits, 6);

  // Повторный импорт того же QR пропускает дубликат
  const again = await env.auth.add({ input: uri, encoding: 'auto' });
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 1);
});

test('переименование и удаление', async () => {
  const env = makeEnv();
  await env.auth.add({ name: 'Старое', input: `otpauth://totp/X?secret=${B32}` });
  const [acc] = await env.auth.list();

  await env.auth.rename(acc.id, 'Новое');
  assert.equal((await env.auth.list())[0].name, 'Новое');

  await assert.rejects(() => env.auth.rename(acc.id, '   '), /Введите название/);

  await env.auth.remove(acc.id);
  assert.equal((await env.auth.list()).length, 0);
});

test('некорректный ввод отклоняется', async () => {
  const env = makeEnv();
  await assert.rejects(() => env.auth.add({ input: 'не-ссылка' }), /Base32/);
  await assert.rejects(
    () => env.auth.add({ input: 'otpauth://hotp/X?secret=' + B32 }),
    /только TOTP/);
  await assert.rejects(
    () => env.auth.add({ input: `otpauth://totp/X?secret=${B32}&digits=7` }),
    /Неподдерживаемые параметры/);
});

test('экспорт и импорт резервной копии', async () => {
  let saved = null;
  const env = makeEnv({
    android: { saveFile: (name, content) => { saved = { name, content }; } }
  });
  await env.auth.add({ name: 'Один', input: `otpauth://totp/A?secret=${B32}` });

  await env.auth.exportBackup();
  assert.ok(saved, 'файл должен быть передан в Android');
  assert.match(saved.name, /^authenticator-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const parsed = JSON.parse(saved.content);
  assert.equal(parsed.format, 'material-authenticator');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.accounts.length, 1);

  // Импорт в чистый профиль восстанавливает аккаунт
  const target = makeEnv({ files: { next: saved.content } });
  const result = await target.auth.importBackup();
  assert.equal(result.added, 1);
  assert.equal((await target.auth.list())[0].name, 'Один');

  // Повторный импорт пропускает дубликат
  const again = await makeEnv({ files: { next: saved.content } });
  await again.auth.add({ name: 'Один', input: `otpauth://totp/A?secret=${B32}` });
  const second = await again.auth.importBackup();
  assert.equal(second.skipped, 1);
});

test('битый файл резервной копии не ломает приложение', async () => {
  const env = makeEnv({ files: { next: '{"format":"чужое"}' } });
  await assert.rejects(() => env.auth.importBackup(), /Неподдерживаемый файл/);
  assert.equal((await env.auth.list()).length, 0);
});

test('данные переживают перезапуск (localStorage)', async () => {
  const env = makeEnv();
  await env.auth.add({ name: 'Живучий', input: `otpauth://totp/A?secret=${B32}` });
  const raw = env.localStorage.getItem('accounts');
  assert.ok(raw && raw.includes('Живучий'));
  assert.ok(raw.includes('secret'), 'ключ должен храниться');
});
