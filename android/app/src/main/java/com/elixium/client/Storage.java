package com.elixium.client;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Where downloaded music goes, and permission to put it there.
 *
 * The engine writes files with ordinary file writes, and its default paths are
 * relative to its working directory — which on a phone is the app's own private
 * folder. Music left there is invisible: no player scans it, no file manager
 * shows it, and plugging the phone into a computer does not reveal it. For a
 * downloader that is indistinguishable from losing the files.
 *
 * So the first run points the engine at the phone's own Music folder instead,
 * and asks for the access that makes writing there possible. Asking is all it
 * does — a refusal leaves the app working, writing where it always could.
 */
final class Storage {

  private static final String TAG = "ElixiumEngine";

  /** Where music lands, if the user has not chosen somewhere else. */
  static final String MUSIC_ROOT =
      new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "Elixium")
          .getAbsolutePath();

  private Storage() {}

  /**
   * Whether the engine can actually write to the music folder.
   *
   * Android 11 replaced the storage permissions with a single all-files grant
   * that lives in Settings rather than in a dialog, so there is nothing to
   * request in-process and the answer has to be asked of the system.
   */
  static boolean canWriteMusic() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      return Environment.isExternalStorageManager();
    }
    // Below Android 11 the manifest permission is enough, and it is granted at
    // install time for the maxSdkVersion range it is declared for.
    return true;
  }

  /** The system screen where all-files access is granted, or null if not applicable. */
  static Intent accessRequest(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
    intent.setData(Uri.parse("package:" + context.getPackageName()));
    return intent;
  }

  /**
   * Give the engine somewhere sensible to write on its first run.
   *
   * Only ever written when there is no configuration at all. The engine owns
   * this file afterwards — every path in it is editable in Settings — and
   * rewriting it later would quietly undo whatever the user had chosen.
   */
  static void seedConfig(File configFile) {
    if (configFile.exists()) return;

    String config =
        "{\n"
            + "  \"paths\": {\n"
            + "    \"deezer\": \"" + escape(MUSIC_ROOT + "/Deezer") + "\",\n"
            + "    \"qobuz\": \"" + escape(MUSIC_ROOT + "/Qobuz") + "\",\n"
            + "    \"ytmusic\": \"" + escape(MUSIC_ROOT + "/YouTube Music") + "\"\n"
            + "  }\n"
            + "}\n";

    try {
      File parent = configFile.getParentFile();
      if (parent != null) parent.mkdirs();
      Files.write(configFile.toPath(), config.getBytes(StandardCharsets.UTF_8));
      Log.i(TAG, "seeded download paths under " + MUSIC_ROOT);
    } catch (IOException e) {
      // Not fatal: the engine writes its own configuration with its own
      // defaults, and the paths are editable in Settings either way.
      Log.w(TAG, "could not seed the configuration", e);
    }
  }

  /** JSON string escaping for the two characters a Windows-style path can carry. */
  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }
}
