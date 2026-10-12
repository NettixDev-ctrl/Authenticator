// Мост для Android: реализует тот же API window.auth, что и preload.cjs в Electron,
// но поверх localStorage и нативных вызовов Android (камера, буфер обмена, файлы).
// Благодаря этому app.js переиспользуется почти без изменений.

import { parseSecret, parseMigration, totp, keyBase32 } from './otp.js';

const STORAGE_KEY = 'accounts';
const native = typeof Android !== 'undefined' ? Android : null;

// Отступы под системные панели приходят из MainActivity (в WebView
// env(safe-area-inset-*) всегда равен нулю). Пишем их в CSS-переменные,
// которые использует android.css. Нативные инсеты — в физических пикселях,
// поэтому переводим их в логические (CSS) через devicePixelRatio.
window.__applyInsets = (top, bottom) => {
  const dpr = window.devicePixelRatio || 1;
  const root = document.documentElement;
  root.style.setProperty('--inset-top', (top || 0) / dpr + 'px');
  root.style.setProperty('--inset-bottom', (bottom || 0) / dpr + 'px');
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function save(accounts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

function publicAccount(a) {
  const { secret, ...rest } = a;
  return rest;
}

function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function describeMigration(result) {
  const batch = result.batchSize > 1 ? ` · QR ${(result.batchIndex ?? 0) + 1} из ${result.batchSize}` : '';
  return `Перенос Google Authenticator${batch}: добавлено ${result.added}, пропущено дубликатов ${result.skipped}`;
}

// ---------- QR через нативную камеру ----------
let qrResolve = null;

window.__onQRImage = dataUrl => {
  const resolve = qrResolve;
  qrResolve = null;
  if (!resolve) return;
  const image = new Image();
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(data.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
      if (!decoded) {
        resolve({ error: 'QR не найден. Снимите код целиком вместе с белой рамкой.' });
        return;
      }
      const value = decoded.data;
      if (!value.startsWith('otpauth://totp/') && !value.startsWith('otpauth-migration://')) {
        resolve({ error: 'Это не QR-код двухэтапной аутентификации' });
        return;
      }
      try {
        if (value.startsWith('otpauth-migration://')) parseMigration(value);
        else parseSecret(value);
      } catch (error) {
        resolve({ error: error.message });
        return;
      }
      resolve({ value });
    } catch (error) {
      resolve({ error: error.message });
    }
  };
  image.onerror = () => resolve({ error: 'Не удалось открыть снимок' });
  image.src = dataUrl;
};

window.__onQRError = message => {
  const resolve = qrResolve;
  qrResolve = null;
  if (resolve) resolve(message ? { error: message } : {});
};

window.__onFileSaved = () => {};

// ---------- Импорт резервной копии ----------
function pickFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    // Отмена выбора не всегда даёт событие, поэтому подстраховываемся
    // таймаутом и снимаем его, как только файл выбран.
    const fallback = setTimeout(() => {
      input.remove();
      resolve(null);
    }, 120000);

    input.onchange = () => {
      clearTimeout(fallback);
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };

    input.click();
  });
}

function mergeBackup(text, existing) {
  const data = JSON.parse(text);
  if (data?.format !== 'material-authenticator' || data.version !== 1 ||
      !Array.isArray(data.accounts) || data.accounts.length > 10000) {
    throw Error('Неподдерживаемый файл экспорта');
  }
  const validated = data.accounts.map((a, index) => {
    if (!a || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 100 ||
        typeof a.secret !== 'string' || !a.secret.length || a.secret.length > 1400 ||
        typeof a.issuer !== 'string' || a.issuer.length > 500 ||
        !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.secret) ||
        !['SHA1', 'SHA256', 'SHA512'].includes(a.algorithm) ||
        ![6, 8].includes(a.digits) || !Number.isInteger(a.period)) {
      throw Error('Некорректный аккаунт №' + (index + 1));
    }
    const uri = new URL('otpauth://totp/' + encodeURIComponent(a.name));
    for (const [key, value] of Object.entries({
      secret: keyBase32(a.secret), algorithm: a.algorithm, digits: a.digits, period: a.period
    })) uri.searchParams.set(key, value);
    const parsed = parseSecret(uri.toString());
    return { ...parsed, name: a.name.trim(), issuer: a.issuer, id: uid() };
  });
  const next = [...existing];
  let added = 0, skipped = 0;
  for (const a of validated) {
    if (next.some(b => b.secret === a.secret && b.algorithm === a.algorithm &&
                       b.digits === a.digits && b.period === a.period)) { skipped++; continue; }
    next.push(a);
    added++;
  }
  return { accounts: next, added, skipped };
}

// ---------- Публичный API ----------
window.auth = {
  // Android всегда использует нативный путь захвата
  captureMode: async () => 'native',
  captureNative: () => new Promise(resolve => {
    if (!native) return resolve({ error: 'Камера доступна только в приложении Android' });
    qrResolve = resolve;
    native.scanQR();
  }),
  selectQR: async () => ({ error: 'Выделение области доступно только в настольной версии' }),

  windowControl: () => {},
  windowState: async () => false,
  onWindowState: () => {},

  list: async () => load().map(publicAccount),

  add: async data => {
    const input = String(data.input || '');
    const accounts = load();

    if (input.trim().startsWith('otpauth-migration://')) {
      const migration = parseMigration(input);
      const next = [...accounts];
      let added = 0, skipped = 0;
      for (const entry of migration.accounts) {
        if (next.some(a => a.secret === entry.secret && a.algorithm === entry.algorithm &&
                           a.digits === entry.digits && a.period === entry.period)) { skipped++; continue; }
        next.push({ ...entry, id: uid() });
        added++;
      }
      if (added) save(next);
      return { migration: true, added, skipped, total: migration.accounts.length,
               batchSize: migration.batchSize, batchIndex: migration.batchIndex };
    }

    const parsed = parseSecret(input, data.encoding);
    const name = String(data.name || parsed.name || '').trim().slice(0, 100);
    if (!name) throw Error('Введите название');
    if (accounts.some(a => a.secret === parsed.secret && a.algorithm === parsed.algorithm &&
                           a.period === parsed.period && a.digits === parsed.digits)) {
      throw Error('Этот ключ уже добавлен');
    }
    const account = { ...parsed, name, id: uid() };
    save([...accounts, account]);
    return publicAccount(account);
  },

  rename: async (id, name) => {
    name = String(name).trim().slice(0, 100);
    if (!name) throw Error('Введите название');
    save(load().map(a => (a.id === id ? { ...a, name } : a)));
  },

  remove: async id => save(load().filter(a => a.id !== id)),

  codes: async () => {
    const now = Date.now();
    return load().map(a => {
      const remaining = a.period - Math.floor(now / 1000) % a.period;
      try {
        return { id: a.id, code: totp(a, now), remaining, period: a.period };
      } catch {
        return { id: a.id, error: 'Некорректный ключ', remaining, period: a.period };
      }
    });
  },

  copy: async code => {
    if (!/^\d{6,8}$/.test(code)) return;
    if (native) native.copy(code);
    else if (navigator.clipboard) await navigator.clipboard.writeText(code);
  },

  exportBackup: async () => {
    const accounts = load();
    if (!accounts.length) throw Error('Нет аккаунтов для экспорта');
    const text = JSON.stringify({
      format: 'material-authenticator',
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts
    }, null, 2);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `authenticator-backup-${stamp}.json`;
    if (native) native.saveFile(name, text);
    else {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }
    return { count: accounts.length };
  },

  importBackup: async () => {
    const text = await pickFile();
    if (text == null) return { canceled: true };
    const result = mergeBackup(text, load());
    save(result.accounts);
    return { added: result.added, skipped: result.skipped };
  }
};

window.__describeMigration = describeMigration;

// Цвет системных панелей следит за темой приложения: сама тема переключается
// в app.js классом body.dark, поэтому наблюдаем за изменением класса.
if (native && native.setDarkBars && typeof MutationObserver !== 'undefined' &&
    typeof document !== 'undefined' && document.body && document.body.classList) {
  const syncBars = () => {
    try {
      native.setDarkBars(document.body.classList.contains('dark'));
    } catch {
      // Мост недоступен — тема останется прежней, это не критично
    }
  };
  new MutationObserver(syncBars).observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
  // До первого кадра body ещё без класса .dark, поэтому берём тему из хранилища,
  // иначе при тёмной теме успевает мигнуть светлый фон системных панелей.
  try {
    native.setDarkBars(localStorage.getItem('theme') === 'dark');
  } catch {
    syncBars();
  }
}

