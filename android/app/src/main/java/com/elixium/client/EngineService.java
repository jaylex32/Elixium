package com.elixium.client;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Hosts the Elixium engine for as long as the app is in use.
 *
 * This is a foreground service for two reasons, and both matter. The engine is
 * an HTTP server the interface talks to, so if Android stops the process the
 * page it is showing has nothing to talk to; and audio playing with the screen
 * off is exactly the case Android reclaims a background process for. A
 * foreground service is the documented way to say this process is doing
 * something the user can hear.
 *
 * The engine is started once per process. Node cannot be started twice inside
 * one process, so a second start request is ignored rather than attempted.
 */
public class EngineService extends Service {

  private static final String TAG = "ElixiumEngine";
  private static final String CHANNEL_ID = "elixium-engine";
  private static final int NOTIFICATION_ID = 1;

  /** Node runs for the life of the process, so starting it twice is a crash. */
  private static boolean started = false;

  /* The notification's buttons come back as service starts. */
  static final String ACTION_PLAY_PAUSE = "com.elixium.client.PLAY_PAUSE";
  static final String ACTION_NEXT = "com.elixium.client.NEXT";
  static final String ACTION_PREVIOUS = "com.elixium.client.PREVIOUS";

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    Playback playback = Playback.get(this);
    // Redraw whenever the interface reports something new.
    playback.setListener(this::refreshNotification);

    /*
     * A button on the notification arrives as a start of this service. It is
     * handed to the session rather than acted on here, so the notification and
     * a headset button take the same path into the interface.
     */
    String action = intent == null ? null : intent.getAction();
    if (ACTION_PLAY_PAUSE.equals(action)) {
      if (playback.isPlaying()) playback.session().getController().getTransportControls().pause();
      else playback.session().getController().getTransportControls().play();
    } else if (ACTION_NEXT.equals(action)) {
      playback.session().getController().getTransportControls().skipToNext();
    } else if (ACTION_PREVIOUS.equals(action)) {
      playback.session().getController().getTransportControls().skipToPrevious();
    }

    enterForeground(NOTIFICATION_ID, notification());

    if (started) return START_STICKY;
    started = true;

    new Thread(this::runEngine, "elixium-engine").start();
    return START_STICKY;
  }

  private void runEngine() {
    try {
      File engineDir = unpackEngine();
      File entry = new File(engineDir, "bootstrap.js");
      File config = new File(getFilesDir(), "elixium.config.json");
      /* First run only: point downloads at the phone's Music folder. */
      Storage.seedConfig(config);

      /*
       * The same arguments the desktop shell passes, plus the OpenSSL flag.
       *
       * Deezer streams are Blowfish-CBC, which OpenSSL 3 moved into its legacy
       * provider. The flag is not optional here: without it the engine finds
       * bf-cbc missing and relaunches itself to add the flag, and on Android
       * process.execPath is app_process64 rather than node — so the relaunch
       * aborts with "Error changing dalvik-cache ownership" and the service
       * restarts in a loop. The desktop build never needs it, because Electron
       * links BoringSSL, where the cipher is simply present.
       */
      String[] arguments = {
        "node",
        "--openssl-legacy-provider",
        entry.getAbsolutePath(),
        "--web",
        "--port",
        String.valueOf(NodeRuntime.PORT),
        "--host",
        NodeRuntime.HOST,
        "--config-file",
        config.getAbsolutePath(),
      };

      Log.i(TAG, "starting engine from " + entry.getAbsolutePath());
      NodeRuntime.nativeStart(arguments, getFilesDir().getAbsolutePath());
      Log.w(TAG, "engine exited");
    } catch (Exception e) {
      Log.e(TAG, "engine could not start", e);
    }
  }

  /**
   * Unpack the engine on first run, and again whenever the app is updated.
   *
   * The marker holds the version that was unpacked. Comparing it means an
   * upgrade replaces the engine, while an ordinary launch costs one string
   * comparison rather than rewriting a couple of thousand files.
   */
  private File unpackEngine() throws IOException {
    File engineDir = new File(getFilesDir(), "engine");
    File marker = new File(engineDir, ".version");

    /*
     * Identify the payload, not just the release.
     *
     * Keying this on the version alone means a rebuilt engine under an
     * unchanged version is never unpacked, so the app keeps running the
     * previous copy — which during development looks exactly like a change
     * having no effect, and in a hotfix would ship the bug it fixed. The
     * asset's own length moves whenever the engine is rebuilt.
     */
    String version = BuildConfig.VERSION_NAME + ":" + BuildConfig.ENGINE_ID;

    if (marker.exists() && version.equals(readText(marker))) {
      Log.i(TAG, "engine already unpacked");
      return engineDir;
    }

    Log.i(TAG, "unpacking engine " + version);
    deleteTree(engineDir);
    if (!engineDir.mkdirs() && !engineDir.isDirectory()) {
      throw new IOException("could not create " + engineDir);
    }

    try (InputStream raw = getAssets().open("engine.zip");
        ZipInputStream zip = new ZipInputStream(raw)) {
      byte[] buffer = new byte[64 * 1024];
      ZipEntry entry;
      while ((entry = zip.getNextEntry()) != null) {
        File target = new File(engineDir, entry.getName());

        // A zip entry naming its way out of the directory is how archives are
        // used to overwrite files elsewhere; refuse rather than trust our own.
        if (!target.getCanonicalPath().startsWith(engineDir.getCanonicalPath() + File.separator)) {
          throw new IOException("refusing entry outside the engine directory: " + entry.getName());
        }

        if (entry.isDirectory()) {
          target.mkdirs();
          continue;
        }
        File parent = target.getParentFile();
        if (parent != null) parent.mkdirs();

        try (OutputStream out = new FileOutputStream(target)) {
          int read;
          while ((read = zip.read(buffer)) != -1) out.write(buffer, 0, read);
        }
      }
    }

    writeText(marker, version);
    Log.i(TAG, "engine unpacked");
    return engineDir;
  }

  private static String readText(File file) {
    try (InputStream in = new java.io.FileInputStream(file)) {
      byte[] bytes = new byte[(int) file.length()];
      int read = in.read(bytes);
      return read <= 0 ? "" : new String(bytes, 0, read, "UTF-8");
    } catch (IOException e) {
      return "";
    }
  }

  private static void writeText(File file, String text) throws IOException {
    try (OutputStream out = new FileOutputStream(file)) {
      out.write(text.getBytes("UTF-8"));
    }
  }

  private static void deleteTree(File file) {
    File[] children = file.listFiles();
    if (children != null) {
      for (File child : children) deleteTree(child);
    }
    // A file that will not delete is reported by the unpack that follows.
    file.delete();
  }

  /** Redraw in place, so the buttons and the title follow the music. */
  private void refreshNotification() {
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager != null) manager.notify(NOTIFICATION_ID, notification());
  }

  private PendingIntent button(String action) {
    Intent intent = new Intent(this, EngineService.class).setAction(action);
    return PendingIntent.getService(
        this, action.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  /**
   * The player in the shade and on the lock screen.
   *
   * Built from the session rather than from this service's own idea of the
   * state, which is what lets the lock screen, the headset and the interface
   * agree. Before there is any music it is a plain line saying the engine is
   * running — a media notification with nothing playing is worse than none.
   */
  private Notification notification() {
    createChannel();
    Playback playback = Playback.get(this);

    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent tap =
        PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    NotificationCompat.Builder builder =
        new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

    if (!playback.hasTrack()) {
      return builder
          .setContentTitle(getString(R.string.app_name))
          .setContentText(getString(R.string.engine_running))
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .build();
    }

    builder
        .setContentTitle(playback.title())
        .setContentText(playback.subtitle())
        .setLargeIcon(playback.artwork())
        .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
        .addAction(
            android.R.drawable.ic_media_previous, getString(R.string.previous), button(ACTION_PREVIOUS))
        .addAction(
            playback.isPlaying() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            getString(playback.isPlaying() ? R.string.pause : R.string.play),
            button(ACTION_PLAY_PAUSE))
        .addAction(android.R.drawable.ic_media_next, getString(R.string.next), button(ACTION_NEXT))
        .setStyle(
            new MediaStyle()
                .setMediaSession(playback.session().getSessionToken())
                // Which buttons survive when the shade collapses.
                .setShowActionsInCompactView(0, 1, 2));

    return builder.build();
  }

  /** Named apart from Service.startForeground, which is final. */
  private void enterForeground(int id, Notification built) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(id, built, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    } else {
      startForeground(id, built);
    }
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

    NotificationChannel channel =
        new NotificationChannel(
            CHANNEL_ID, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
    channel.setShowBadge(false);
    channel.setDescription(getString(R.string.engine_running));
    manager.createNotificationChannel(channel);
  }

  static void start(Context context) {
    Intent intent = new Intent(context, EngineService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent);
    } else {
      context.startService(intent);
    }
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
