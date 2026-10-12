package tools.local.materialauthenticator;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {

    private static final int REQ_CAPTURE = 1001;
    private static final int REQ_PICK = 1002;

    // Свой origin обязателен: на file:// в WebView не работает localStorage,
    // то есть негде хранить ключи. Раздаём ресурсы как https, перехватывая запросы.
    private static final String APP_HOST = "app.local";
    private static final String APP_URL = "https://" + APP_HOST + "/index.html";

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("svg", "image/svg+xml");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
    }

    private WebView web;
    private Uri pendingCaptureUri;
    private ValueCallback<Uri[]> pendingFileCallback;
    private int insetTop = 0;
    private int insetBottom = 0;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        Window window = getWindow();
        // Края экрана: контент рисуется под системными панелями, а сами панели
        // прозрачны, поэтому полоса жестов и статус-бар всегда совпадают по цвету
        // с фоном приложения. Отступы под панели приходят в CSS через __applyInsets.
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Иначе система рисует полупрозрачный «контрастный» слой поверх
            // панели навигации — на светлой теме он выглядит как тёмная полоса.
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        web = new WebView(this);
        setContentView(web);

        // Системные панели прозрачны, поэтому отступы под них считаем сами и
        // отдаём в CSS. Иначе env(safe-area-inset-*) в WebView всегда равен нулю,
        // и плавающая кнопка уезжает под полосу жестов.
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            int top, bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                // При жестовой навигации панель навигации не занимает места,
                // но область жестов перекрывает низ экрана — учитываем и её.
                android.graphics.Insets gestures = insets.getInsets(WindowInsets.Type.systemGestures());
                top = Math.max(bars.top, gestures.top);
                bottom = Math.max(bars.bottom, gestures.bottom);
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                if (insets.getDisplayCutout() != null) {
                    top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                    bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                }
            }
            // Часть прошивок в режиме жестов не сообщает высоту области жестов
            // (все инсеты снизу равны нулю) — тогда берём её из настроек системы.
            bottom = Math.max(bottom, gestureNavInset());
            applyInsets(top, bottom);
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        // Тёмный фон до отрисовки страницы, чтобы не мигало белым
        web.setBackgroundColor(0xFF13151A);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!APP_HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
                if (path.contains("..")) return notFound();
                try {
                    InputStream in = getAssets().open("www" + path);
                    int dot = path.lastIndexOf('.');
                    String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase();
                    String mime = MIME.get(ext);
                    if (mime == null) mime = "application/octet-stream";
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    return new WebResourceResponse(mime, "utf-8", 200, "OK", headers, in);
                } catch (Exception e) {
                    return notFound();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Отступы могли прийти до загрузки страницы — повторяем, когда
                // __applyInsets уже определён в bundle.js.
                sendInsets();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "Файл резервной копии"), REQ_PICK);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl(APP_URL);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    /** Запоминает отступы под системные панели и перерисовывает их в CSS. */
    private void applyInsets(int top, int bottom) {
        insetTop = top;
        insetBottom = bottom;
        sendInsets();
    }

    /** Высота области жестов, если система её не сообщает. 24dp — типовое значение. */
    private int gestureNavInset() {
        try {
            int mode = android.provider.Settings.Secure.getInt(
                    getContentResolver(), "navigation_mode", 0);
            if (mode == 2) {
                return Math.round(24 * getResources().getDisplayMetrics().density);
            }
        } catch (Exception ignored) {
            // Настройка недоступна — оставляем как посчитала система
        }
        return 0;
    }

    private void sendInsets() {
        callJs("window.__applyInsets&&window.__applyInsets(" + insetTop + "," + insetBottom + ")");
    }

    /** Красит значки статус-бара и панели навигации под тему приложения. */
    private void applyBars(boolean dark) {
        // Фон панелей прозрачный: сквозь них видно фон страницы, поэтому он
        // всегда совпадает с темой. Здесь важны только значки (светлые/тёмные).
        if (web != null) web.setBackgroundColor(dark ? 0xFF13151A : 0xFFF6F8FC);
        Window window = getWindow();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.view.WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                     | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            // Светлый фон требует тёмных значков, тёмный — светлых
            controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
        } else {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                      | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            if (dark) {
                flags &= ~light;
            } else {
                flags |= light;
            }
            decor.setSystemUiVisibility(flags);
        }
    }

    /** Мост между веб-интерфейсом и Android. */
    private class Bridge {
        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("code", text));
                    Toast.makeText(MainActivity.this, "Код скопирован", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                }
            });
        }

        /** Цвет системных панелей под текущую тему приложения. */
        @JavascriptInterface
        public void setDarkBars(final boolean dark) {
            runOnUiThread(new Runnable() {
                public void run() {
                    applyBars(dark);
                }
            });
        }

        /** Снимок QR-кода камерой. Результат придёт в window.__onQRImage(dataUrl). */
        @JavascriptInterface
        public void scanQR() {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Images.Media.DISPLAY_NAME, "qr_" + System.currentTimeMillis() + ".jpg");
                        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                        pendingCaptureUri = getContentResolver()
                                .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCaptureUri);
                        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        startActivityForResult(intent, REQ_CAPTURE);
                    } catch (Exception e) {
                        callJs("window.__onQRError(" + jsString("Камера недоступна: " + e.getMessage()) + ")");
                    }
                }
            });
        }

        /** Сохранить резервную копию. */
        @JavascriptInterface
        public void saveFile(final String name, final String content) {
            new Thread(new Runnable() {
                public void run() {
                    String result;
                    try {
                        result = writeBackup(name, content);
                    } catch (Exception e) {
                        result = null;
                    }
                    final String message = result == null
                            ? "Не удалось сохранить файл"
                            : "Сохранено: " + result;
                    final boolean saved = result != null;
                    runOnUiThread(new Runnable() {
                        public void run() {
                            Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                            callJs("window.__onFileSaved(" + saved + ")");
                        }
                    });
                }
            }).start();
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                    }
                }
            });
        }
    }

    private String writeBackup(String name, String content) throws Exception {
        byte[] bytes = content.getBytes("UTF-8");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri != null) {
                OutputStream out = getContentResolver().openOutputStream(uri);
                if (out != null) {
                    out.write(bytes);
                    out.close();
                    return "Загрузки/" + name;
                }
            }
        }
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = getFilesDir();
        File file = new File(dir, name);
        FileOutputStream out = new FileOutputStream(file);
        out.write(bytes);
        out.close();
        return file.getAbsolutePath();
    }

    private void callJs(final String script) {
        if (web != null) web.post(new Runnable() {
            public void run() {
                web.evaluateJavascript(script, null);
            }
        });
    }

    private static String jsString(String value) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        return sb.append('"').toString();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_CAPTURE) {
            if (resultCode == RESULT_OK && pendingCaptureUri != null) {
                try {
                    InputStream in = getContentResolver().openInputStream(pendingCaptureUri);
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int read;
                    while ((read = in.read(chunk)) > 0) buffer.write(chunk, 0, read);
                    in.close();
                    String encoded = Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP);
                    callJs("window.__onQRImage('data:image/jpeg;base64," + encoded + "')");
                } catch (Exception e) {
                    callJs("window.__onQRError(" + jsString("Не удалось прочитать снимок") + ")");
                }
            } else {
                callJs("window.__onQRError(null)");
            }
            if (pendingCaptureUri != null) {
                try {
                    getContentResolver().delete(pendingCaptureUri, null, null);
                } catch (Exception ignored) {
                }
                pendingCaptureUri = null;
            }
            return;
        }

        if (requestCode == REQ_PICK) {
            if (pendingFileCallback == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                result = new Uri[]{uri};
                try {
                    InputStream in = getContentResolver().openInputStream(uri);
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int read;
                    while ((read = in.read(chunk)) > 0) buffer.write(chunk, 0, read);
                    in.close();
                    String text = buffer.toString("UTF-8");
                    callJs("window.__onFilePicked(" + jsString(text) + ")");
                } catch (Exception e) {
                    callJs("window.__onFilePicked(null)");
                }
            } else {
                callJs("window.__onFilePicked(null)");
            }
            pendingFileCallback.onReceiveValue(result);
            pendingFileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        // Аппаратная кнопка «назад» закрывает диалоги, а не приложение
        web.evaluateJavascript(
                "(function(){var d=document.querySelector('dialog[open]');" +
                "if(d){d.close();return 'handled';}return 'exit';})()",
                value -> {
                    if (value == null || value.contains("exit")) {
                        moveTaskToBack(true);
                    }
                });
    }
}
