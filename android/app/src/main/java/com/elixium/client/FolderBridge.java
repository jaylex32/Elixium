package com.elixium.client;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.activity.result.ActivityResultLauncher;

import java.io.File;

/**
 * The folder picker the interface already knows how to use.
 *
 * The web build deliberately offers no folder dialog: over a network it would
 * show the viewer's folders, and the engine writes on the server. The desktop
 * build does offer one, because there the engine and the window are the same
 * machine — which is exactly the situation here. So rather than adding a second
 * way to choose a folder, this app presents the same bridge the desktop shell
 * does, and the existing Browse and Open buttons appear on their own.
 */
final class FolderBridge {

  private static final String TAG = "ElixiumEngine";

  /**
   * Defines window.elixium before the interface's own scripts run.
   *
   * pickFolder cannot answer immediately — it opens a system picker and waits
   * for the user — so the promise is parked here and settled by name when the
   * result arrives.
   */
  static final String SHIM =
      "(function(){"
          + "if(window.elixium)return;"
          + "var pending={},next=1;"
          + "window.__elixiumSettle=function(id,value){"
          + "var resolve=pending[id];delete pending[id];if(resolve)resolve(value);};"
          + "window.elixium={"
          + "isDesktop:true,"
          + "pickFolder:function(current){return new Promise(function(resolve){"
          + "var id=String(next++);pending[id]=resolve;"
          + "try{ElixiumHost.pickFolder(id,current||'');}catch(e){resolve(null);}});},"
          + "openFolder:function(target){return Promise.resolve("
          + "(function(){try{return ElixiumHost.openFolder(target||'');}catch(e){return false;}})());}"
          + "};"
          + "})();";

  private final MainActivity activity;
  private final ActivityResultLauncher<Uri> picker;

  /** The request the open picker belongs to, so its answer reaches the right promise. */
  private String pendingId;

  FolderBridge(MainActivity activity, ActivityResultLauncher<Uri> picker) {
    this.activity = activity;
    this.picker = picker;
  }

  @JavascriptInterface
  public void pickFolder(String id, String current) {
    pendingId = id;
    activity.runOnUiThread(() -> {
      try {
        picker.launch(null);
      } catch (ActivityNotFoundException e) {
        settle(id, null);
      }
    });
  }

  /**
   * The interface's playback state, on its way to the system.
   *
   * Called whenever the track, the play state or the second changes — not on
   * every timeupdate, which would be four times a second for a notification
   * that shows whole seconds.
   */
  @JavascriptInterface
  public void playback(String state) {
    Playback.get(activity).update(state);
  }

  @JavascriptInterface
  public boolean openFolder(String target) {
    if (target == null || target.isEmpty()) return false;
    try {
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(Uri.parse("file://" + target), "resource/folder");
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      activity.startActivity(intent);
      return true;
    } catch (Exception e) {
      // Most phones ship no file manager that answers this, and that is not
      // worth an error: the path is written down in Settings either way.
      Log.i(TAG, "no app would open " + target);
      return false;
    }
  }

  /** Called by the activity once the picker returns. */
  void deliver(Uri tree) {
    settle(pendingId, tree == null ? null : toFilePath(tree));
    pendingId = null;
  }

  private void settle(String id, String path) {
    if (id == null) return;
    WebView view = activity.webView();
    if (view == null) return;

    String value = path == null ? "null" : "'" + path.replace("\\", "\\\\").replace("'", "\\'") + "'";
    activity.runOnUiThread(
        () -> view.evaluateJavascript("window.__elixiumSettle('" + id + "'," + value + ");", null));
  }

  /**
   * Turn the picker's answer into a path the engine can write to.
   *
   * The picker returns a document tree, not a location: something like
   * content://com.android.externalstorage.documents/tree/primary%3AMusic. The
   * engine writes with ordinary file calls and cannot use that, so the volume
   * and the path inside it are read back out. "primary" is the built-in
   * storage; anything else is a card or a stick, which mounts under its own id.
   */
  static String toFilePath(Uri tree) {
    try {
      String documentId = DocumentsContract.getTreeDocumentId(tree);
      String[] parts = documentId.split(":", 2);
      String volume = parts[0];
      String relative = parts.length > 1 ? parts[1] : "";

      File root =
          "primary".equalsIgnoreCase(volume)
              ? Environment.getExternalStorageDirectory()
              : new File("/storage/" + volume);

      return relative.isEmpty() ? root.getAbsolutePath() : new File(root, relative).getAbsolutePath();
    } catch (Exception e) {
      Log.w(TAG, "could not read a path out of " + tree, e);
      return null;
    }
  }

  /** Keeps the picker's grant across restarts, so a chosen folder stays usable. */
  static void remember(Context context, Uri tree) {
    try {
      context
          .getContentResolver()
          .takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION
              | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    } catch (Exception e) {
      // The engine writes through the all-files grant rather than this one, so
      // failing to persist it costs nothing.
      Log.i(TAG, "could not persist access to " + tree);
    }
  }
}
