package com.elixium.client;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Elixium for Android.
 *
 * The same shape as the desktop build: the engine runs locally, and this points
 * a view at it. There is no address to enter and no server to reach, because
 * the server is in the app — which is why the download folder, the library and
 * the settings are the phone's own rather than shared with anything else.
 */
public class MainActivity extends AppCompatActivity {

  private static final String STATE_WEBVIEW = "webview";
  /** The engine unpacks itself on first launch, so allow for that. */
  private static final long START_TIMEOUT_MS = 120_000;

  private WebView webView;
  private View loading;
  private TextView status;

  private final Handler ui = new Handler(Looper.getMainLooper());
  private boolean loaded = false;

  private FolderBridge folders;
  private ActivityResultLauncher<Uri> folderPicker;
  private ValueCallback<Uri[]> pendingFileChooser;
  private ActivityResultLauncher<Intent> fileChooser;
  private ActivityResultLauncher<String> notificationPermission;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    webView = findViewById(R.id.web);
    loading = findViewById(R.id.loading);
    status = findViewById(R.id.status);

    registerLaunchers();
    configureWebView();
    askForNotificationPermission();
    askForStorageAccess();
    handleBackPresses();

    EngineService.start(this);

    if (savedInstanceState != null) {
      // Returning from a rotation or a process the system reclaimed. The engine
      // is already up, so restore the page rather than starting over.
      loaded = true;
      webView.restoreState(savedInstanceState.getBundle(STATE_WEBVIEW));
      showWeb();
    } else {
      waitForEngine();
    }
  }

  /**
   * Poll the engine until it answers, then show it.
   *
   * First launch has to unpack a couple of thousand files before the server can
   * bind, so this waits rather than failing — but it says what it is doing,
   * because a still splash screen for twenty seconds reads as a hang.
   */
  private void waitForEngine() {
    status.setText(R.string.starting_engine);

    new Thread(() -> {
      long deadline = System.currentTimeMillis() + START_TIMEOUT_MS;
      while (System.currentTimeMillis() < deadline) {
        if (isEngineUp()) {
          ui.post(() -> {
            if (loaded) return;
            loaded = true;
            webView.loadUrl(NodeRuntime.url());
          });
          return;
        }
        try {
          Thread.sleep(400);
        } catch (InterruptedException e) {
          return;
        }
      }
      ui.post(() -> status.setText(R.string.engine_failed));
    }, "elixium-wait").start();
  }

  private boolean isEngineUp() {
    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection) new URL(NodeRuntime.url() + "/api/v1/health").openConnection();
      connection.setConnectTimeout(1500);
      connection.setReadTimeout(1500);
      connection.setRequestMethod("GET");
      return connection.getResponseCode() == 200;
    } catch (IOException e) {
      return false;
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private void registerLaunchers() {
    fileChooser =
        registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
              if (pendingFileChooser == null) return;
              Uri[] chosen = null;
              Intent data = result.getData();
              if (data != null && data.getData() != null) chosen = new Uri[] {data.getData()};
              pendingFileChooser.onReceiveValue(chosen);
              pendingFileChooser = null;
            });

    folderPicker =
        registerForActivityResult(
            new ActivityResultContracts.OpenDocumentTree(),
            tree -> {
              if (tree != null) FolderBridge.remember(this, tree);
              if (folders != null) folders.deliver(tree);
            });

    notificationPermission =
        registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            granted -> {
              // Declining only hides the notification; the engine still runs.
            });
  }

  private void askForNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
        == PackageManager.PERMISSION_GRANTED) {
      return;
    }
    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
  }

  /**
   * Ask once for the access that lets downloads land in the Music folder.
   *
   * Android 11 moved this out of dialogs and into a Settings screen, so the
   * most an app can do is open it. Declining costs the user nothing they can
   * see immediately — the engine still downloads, into its own folder — so this
   * neither blocks nor repeats.
   */
  private void askForStorageAccess() {
    if (Storage.canWriteMusic()) return;

    Intent request = Storage.accessRequest(this);
    if (request == null) return;

    new androidx.appcompat.app.AlertDialog.Builder(this)
        .setTitle(R.string.storage_title)
        .setMessage(R.string.storage_detail)
        .setPositiveButton(R.string.storage_open, (dialog, which) -> {
          try {
            startActivity(request);
          } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.storage_unavailable, Toast.LENGTH_LONG).show();
          }
        })
        .setNegativeButton(R.string.storage_later, null)
        .show();
  }

  @SuppressLint("SetJavaScriptEnabled")
  private void configureWebView() {
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    // Where the interface keeps the queue, recent searches and its own settings.
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    // The interface drives playback from its own controls; asking for a fresh
    // tap on every track would defeat the queue.
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setUseWideViewPort(true);
    settings.setLoadWithOverviewMode(true);
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);

    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

    folders = new FolderBridge(this, folderPicker);
    webView.addJavascriptInterface(folders, "ElixiumHost");

    /*
     * Define window.elixium before the interface's own scripts run.
     *
     * Settings reads it while it renders to decide whether to show a Browse
     * button, so injecting after the page has loaded is a race the interface
     * usually wins — and the button silently never appears.
     */
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      WebViewCompat.addDocumentStartJavaScript(
          webView, FolderBridge.SHIM, java.util.Collections.singleton("*"));
    }

    webView.setBackgroundColor(ContextCompat.getColor(this, R.color.ground));
    webView.setWebChromeClient(new ElixiumChromeClient());
    webView.setWebViewClient(new ElixiumWebViewClient());
    webView.setDownloadListener(this::saveDownload);
  }

  /** The view the folder bridge settles its promises in. */
  WebView webView() {
    return webView;
  }

  private void showWeb() {
    loading.setVisibility(View.GONE);
    webView.setVisibility(View.VISIBLE);
  }

  private class ElixiumWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri target = request.getUrl();
      // The engine is the only thing this view shows; links out belong in a
      // browser rather than in a window with no address bar.
      if (NodeRuntime.HOST.equals(target.getHost())) return false;
      try {
        startActivity(new Intent(Intent.ACTION_VIEW, target));
      } catch (ActivityNotFoundException ignored) {
        return false;
      }
      return true;
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
      if (!request.isForMainFrame()) return;
      // The engine went away mid-session. Waiting for it back is better than a
      // browser error page the user can do nothing with.
      loaded = false;
      webView.setVisibility(View.GONE);
      loading.setVisibility(View.VISIBLE);
      waitForEngine();
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      // A phone whose WebView is too old for document-start scripts still gets
      // the bridge, just later; Settings is reached well after this.
      if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        view.evaluateJavascript(FolderBridge.SHIM, null);
      }
      showWeb();
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
      /*
       * The page's own process died, usually because the system wanted the
       * memory. Left alone this takes the app down with it, so the activity is
       * rebuilt — the engine is a service and keeps running, so this costs a
       * reload rather than the session.
       */
      if (webView != null) {
        webView.destroy();
        webView = null;
      }
      recreate();
      return true;
    }
  }

  private class ElixiumChromeClient extends WebChromeClient {
    @Override
    public boolean onShowFileChooser(
        WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
      // Settings takes a cookies.txt for YouTube Music; without this the picker
      // never opens and the field looks broken.
      if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
      pendingFileChooser = callback;
      try {
        fileChooser.launch(params.createIntent());
      } catch (ActivityNotFoundException e) {
        pendingFileChooser = null;
        Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_LONG).show();
        return false;
      }
      return true;
    }
  }

  /** Hand a download to the system, so it survives leaving the app. */
  private void saveDownload(
      String url, String userAgent, String disposition, String mimeType, long size) {
    try {
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
      request.setMimeType(mimeType);
      request.addRequestHeader("User-Agent", userAgent);
      String cookies = CookieManager.getInstance().getCookie(url);
      if (cookies != null) request.addRequestHeader("Cookie", cookies);

      String name = URLUtil.guessFileName(url, disposition, mimeType);
      request.setTitle(name);
      request.setDestinationInExternalPublicDir(Environment.DIRECTORY_MUSIC, name);
      request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

      DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
      if (manager == null) throw new IllegalStateException("no download manager");
      manager.enqueue(request);
      Toast.makeText(this, getString(R.string.saving, name), Toast.LENGTH_SHORT).show();
    } catch (Exception e) {
      Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
    }
  }

  private void handleBackPresses() {
    getOnBackPressedDispatcher()
        .addCallback(
            this,
            new OnBackPressedCallback(true) {
              @Override
              public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                  webView.goBack();
                  return;
                }
                // Leaving the app deliberately keeps the engine running, so
                // whatever is playing keeps playing.
                moveTaskToBack(true);
              }
            });
  }

  @Override
  protected void onSaveInstanceState(Bundle outState) {
    super.onSaveInstanceState(outState);
    if (webView == null) return;
    Bundle state = new Bundle();
    webView.saveState(state);
    outState.putBundle(STATE_WEBVIEW, state);
  }

  @Override
  protected void onPause() {
    super.onPause();
    /*
     * Write cookies out now rather than whenever the system gets round to it: a
     * process the system reclaims without flushing loses the session, which
     * shows up as being asked to pair again for no apparent reason.
     */
    CookieManager.getInstance().flush();
  }

  @Override
  protected void onDestroy() {
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
