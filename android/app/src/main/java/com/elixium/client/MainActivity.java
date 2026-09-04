package com.elixium.client;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

/**
 * Elixium's Android client.
 *
 * Deliberately not tied to one address. Everybody runs their own server, so the
 * app asks where it is on first launch and remembers the answer, rather than
 * being rebuilt per person.
 *
 * The reason this exists at all rather than a home-screen shortcut is the
 * screen turning off. A page in a browser tab is a background tab the moment
 * the phone locks, and Android is free to starve it; playback stopped after a
 * few songs. An app can hold a foreground service while audio is playing, which
 * is the documented way to tell the system that this process is doing something
 * the user can hear. That service is the whole point of the wrapper.
 */
public class MainActivity extends AppCompatActivity {

  private static final String PREFS = "elixium";
  private static final String KEY_SERVER = "server";

  private WebView webView;
  private SharedPreferences prefs;

  /** Whether the page currently reports audio playing, so we do not restart the service each event. */
  private boolean serviceRunning = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

    String server = prefs.getString(KEY_SERVER, null);
    if (server == null || server.isEmpty()) {
      showSetup(null);
    } else {
      showWeb(server);
    }

    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (webView != null && webView.canGoBack()) {
          webView.goBack();
          return;
        }
        // At the root there is nowhere back to go, so offer the one setting
        // this app has rather than silently closing.
        new AlertDialog.Builder(MainActivity.this)
            .setTitle(R.string.app_name)
            .setPositiveButton(R.string.change_server, (d, which) -> showSetup(null))
            .setNegativeButton(android.R.string.cancel, null)
            .setNeutralButton("Exit", (d, which) -> finish())
            .show();
      }
    });
  }

  /** First-run screen, also shown when the saved address stops working. */
  private void showSetup(String error) {
    stopPlaybackService();
    setContentView(R.layout.activity_setup);

    EditText field = findViewById(R.id.server);
    Button connect = findViewById(R.id.connect);
    TextView problem = findViewById(R.id.problem);

    String existing = prefs.getString(KEY_SERVER, "");
    field.setText(existing);

    if (error != null) {
      problem.setText(error);
      problem.setVisibility(View.VISIBLE);
    }

    connect.setOnClickListener(v -> {
      String entered = normalise(field.getText().toString());
      if (entered == null) {
        problem.setText(R.string.cannot_reach);
        problem.setVisibility(View.VISIBLE);
        return;
      }
      prefs.edit().putString(KEY_SERVER, entered).apply();
      showWeb(entered);
    });
  }

  /**
   * Accept what people actually type.
   *
   * "music.example.com", "music.example.com:9999" and a full URL all mean the
   * same thing to someone entering their own server, so a missing scheme is
   * filled in rather than rejected.
   */
  static String normalise(String raw) {
    if (raw == null) return null;
    String value = raw.trim();
    if (value.isEmpty()) return null;
    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      value = "https://" + value;
    }
    Uri parsed = Uri.parse(value);
    if (parsed.getHost() == null || parsed.getHost().isEmpty()) return null;
    // Trailing slashes produce doubled separators once the page navigates.
    while (value.endsWith("/")) {
      value = value.substring(0, value.length() - 1);
    }
    return value;
  }

  @SuppressLint("SetJavaScriptEnabled")
  private void showWeb(String server) {
    setContentView(R.layout.activity_main);
    webView = findViewById(R.id.web);

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    // The interface starts playback from its own controls, and a wrapper that
    // demanded a fresh tap per track would defeat the point of the queue.
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setSupportZoom(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

    webView.addJavascriptInterface(new PlaybackBridge(), "ElixiumHost");

    webView.setWebChromeClient(new WebChromeClient());
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri target = request.getUrl();
        String host = Uri.parse(server).getHost();
        // Anything that is not the user's own server belongs in a browser.
        if (host != null && host.equalsIgnoreCase(target.getHost())) return false;
        startActivity(new Intent(Intent.ACTION_VIEW, target));
        return true;
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        // Only the page itself failing is worth interrupting for; a missing
        // cover image is not a reason to throw the user back to setup.
        if (!request.isForMainFrame()) return;
        showSetup(getString(R.string.cannot_reach));
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        view.evaluateJavascript(PLAYBACK_WATCHER, null);
      }
    });

    webView.loadUrl(server);
  }

  /**
   * Reports whether anything is audible, so the service can follow it.
   *
   * Media events do not bubble, which is why these listeners are registered in
   * the capture phase on the document — that catches them from any element the
   * interface creates, without the page needing to know this app exists.
   */
  private static final String PLAYBACK_WATCHER =
      "(function(){"
          + "if(window.__elixiumWatch)return;window.__elixiumWatch=true;"
          + "var report=function(){"
          + "var playing=false;"
          + "document.querySelectorAll('audio,video').forEach(function(m){"
          + "if(!m.paused&&!m.ended&&m.currentTime>0)playing=true;});"
          + "try{ElixiumHost.playing(playing);}catch(e){}};"
          + "document.addEventListener('play',report,true);"
          + "document.addEventListener('playing',report,true);"
          + "document.addEventListener('pause',report,true);"
          + "document.addEventListener('ended',report,true);"
          + "setInterval(report,5000);report();"
          + "})();";

  private class PlaybackBridge {
    @JavascriptInterface
    public void playing(boolean isPlaying) {
      runOnUiThread(() -> {
        if (isPlaying) startPlaybackService();
        else stopPlaybackService();
      });
    }
  }

  private void startPlaybackService() {
    if (serviceRunning) return;
    serviceRunning = true;
    Intent intent = new Intent(this, PlaybackService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ContextCompat.startForegroundService(this, intent);
    } else {
      startService(intent);
    }
  }

  private void stopPlaybackService() {
    if (!serviceRunning) return;
    serviceRunning = false;
    stopService(new Intent(this, PlaybackService.class));
  }

  @Override
  protected void onDestroy() {
    stopPlaybackService();
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
