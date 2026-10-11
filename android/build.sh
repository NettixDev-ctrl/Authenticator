#!/usr/bin/env bash
# Сборка APK без Gradle: aapt2 + javac + d8 + apksigner.
#
# Требуется: Android SDK (build-tools 34.0.0, platforms/android-34) и JDK 17.
# Путь к SDK берётся из ANDROID_HOME/ANDROID_SDK_ROOT или ищется в типовых местах.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"   # корень репозитория, там же лежит public/
OUT="$HERE/build"
VERSION_NAME="1.0.0"
VERSION_CODE="1"

# ---------------------------------------------------------------- JDK
# d8 из build-tools 34 падает с NullPointerException на классах от JDK 27,
# поэтому нужен JDK 17 — штатная для Android версия.
find_jdk17() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ] &&
     "$JAVA_HOME/bin/javac" -version 2>&1 | grep -q "^javac 17"; then
    echo "$JAVA_HOME"; return
  fi
  for candidate in /usr/lib/jvm/java-17-openjdk /usr/lib/jvm/java-17-openjdk-* \
                   /usr/lib/jvm/temurin-17-jdk* /opt/java/openjdk-17*; do
    [ -x "$candidate/bin/javac" ] && { echo "$candidate"; return; }
  done
}
JDK="$(find_jdk17 || true)"
if [ -n "$JDK" ]; then
  export JAVA_HOME="$JDK"
  export PATH="$JDK/bin:$PATH"
else
  echo "Внимание: JDK 17 не найден, сборка может упасть на шаге d8." >&2
  echo "Установите: sudo pacman -S jdk17-openjdk" >&2
fi

# ---------------------------------------------------------------- SDK
find_sdk() {
  for candidate in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" \
                   "$HOME/Android/Sdk" "$HOME/android-sdk" \
                   /opt/android-sdk /usr/lib/android-sdk; do
    [ -n "$candidate" ] && [ -d "$candidate/build-tools" ] && { echo "$candidate"; return; }
  done
}
SDK="$(find_sdk || true)"
if [ -z "$SDK" ]; then
  echo "Android SDK не найден. Укажите ANDROID_HOME." >&2
  echo "Установка: см. README, раздел «Сборка для Android»." >&2
  exit 1
fi

BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"

for tool in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$PLATFORM"; do
  [ -e "$tool" ] || { echo "Не найдено: $tool" >&2; exit 1; }
done
command -v node >/dev/null || { echo "Нужен Node.js для проверки скрипта" >&2; exit 1; }

# ---------------------------------------------------------------- Ключ подписи
# Ключ не хранится в репозитории: он создаётся при первой сборке.
KS="$HERE/debug.keystore"
if [ ! -f "$KS" ]; then
  echo "==> Создание отладочного ключа подписи"
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
  echo "    $KS создан (пароль: android)"
fi

# ---------------------------------------------------------------- Подготовка
rm -rf "$OUT"
mkdir -p "$OUT/assets/www" "$OUT/classes" "$OUT/dex" "$OUT/gen"

echo "==> 1/6 Сборка единого скрипта"
# app.js — обычный скрипт, а otp.js и bridge.js — модули. Классический скрипт
# выполняется раньше модуля, поэтому window.auth не успел бы появиться.
# Склеиваем всё в один обычный скрипт и прячем внутренности в замыкание.
{
  echo "// Сгенерировано build.sh — не редактировать вручную."
  echo "(function(){'use strict';"
  sed -E 's/^export //' "$HERE/src/otp.js"
  grep -v '^import ' "$HERE/src/bridge.js"
  echo "})();"
} > "$OUT/assets/www/bundle.js"
node --check "$OUT/assets/www/bundle.js"
echo "    bundle.js: $(stat -c%s "$OUT/assets/www/bundle.js") Б, синтаксис в порядке"

echo "==> 2/6 Подготовка веб-ресурсов"
# Интерфейс общий с настольной версией — копируем, а не дублируем в репозитории.
for item in index.html app.js style.css fonts assets; do
  [ -e "$ROOT/public/$item" ] || { echo "Нет $ROOT/public/$item" >&2; exit 1; }
  cp -a "$ROOT/public/$item" "$OUT/assets/www/"
done
cp "$HERE/web/android.css" "$OUT/assets/www/"

# jsQR: берём из node_modules, если зависимости установлены, иначе вендорную копию
if [ -f "$ROOT/node_modules/jsqr/dist/jsQR.js" ]; then
  cp "$ROOT/node_modules/jsqr/dist/jsQR.js" "$OUT/assets/www/jsqr.js"
  echo "    jsQR: из node_modules"
else
  cp "$HERE/vendor/jsQR.js" "$OUT/assets/www/jsqr.js"
  echo "    jsQR: вендорная копия"
fi

python3 - "$ROOT/public/index.html" "$OUT/assets/www/index.html" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()

def sub(old, new, why):
    global html
    assert old in html, f'не найдено: {why}'
    html = html.replace(old, new)

# jsQR в APK лежит рядом со страницей
sub('../node_modules/jsqr/dist/jsQR.js', 'jsqr.js', 'путь к jsQR')
# мобильный viewport
sub('content="width=device-width,initial-scale=1"',
    'content="width=device-width,initial-scale=1,maximum-scale=1,'
    'user-scalable=no,viewport-fit=cover"', 'viewport')
# мобильные стили
sub('</head>', '<link rel="stylesheet" href="android.css"></head>', 'android.css')
# мост должен быть подключён до app.js
sub('<script src="app.js"></script>',
    '<script src="bundle.js"></script><script src="app.js"></script>', 'подключение app.js')

open(dst, 'w', encoding='utf-8').write(html)
print('    index.html: пути и viewport поправлены')
PY

python3 - "$OUT/assets/www/app.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = "nativeCapture=mode==='spectacle'"
new = "nativeCapture=mode==='spectacle'||mode==='native'"
assert old in s, 'не найдена строка выбора режима захвата'
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
print('    app.js: захват переключён на нативный (камера)')
PY

echo "==> 3/6 Компиляция ресурсов"
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip" >/dev/null

echo "==> 4/6 Сборка ресурсов и манифеста"
"$BT/aapt2" link \
  -o "$OUT/app-unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$HERE/AndroidManifest.xml" \
  -R "$OUT/res.zip" \
  --auto-add-overlay \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --no-version-vectors

echo "==> 5/6 Компиляция Java"
javac --release 11 -nowarn \
  -classpath "$PLATFORM" \
  -d "$OUT/classes" \
  "$HERE/MainActivity.java"

# Массив, а не $(find ...): иначе пути с пробелами разобьются на слова
mapfile -t CLASSES < <(find "$OUT/classes" -name '*.class')
[ "${#CLASSES[@]}" -gt 0 ] || { echo "javac не создал классы" >&2; exit 1; }

"$BT/d8" --lib "$PLATFORM" --min-api 24 \
  --output "$OUT/dex" \
  "${CLASSES[@]}" 2>&1 | grep -viE '^warning' || true

[ -f "$OUT/dex/classes.dex" ] || { echo "d8 не создал classes.dex" >&2; exit 1; }

python3 - "$OUT/app-unsigned.apk" "$OUT/dex/classes.dex" <<'PY'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with open(dex, 'rb') as f:
    data = f.read()
with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    z.writestr('classes.dex', data)
print(f'    classes.dex добавлен: {len(data)} Б')
PY

echo "==> 6/6 Выравнивание и подпись"
"$BT/zipalign" -f -p 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"
APK="$HERE/Authenticator-$VERSION_NAME.apk"
"$BT/apksigner" sign \
  --ks "$KS" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --min-sdk-version 24 \
  --out "$APK" \
  "$OUT/app-aligned.apk"

"$BT/apksigner" verify --print-certs "$APK" 2>/dev/null | head -2

echo
echo "Готово: $APK ($(du -h "$APK" | cut -f1))"
echo "Установка: adb install -r \"$APK\""
