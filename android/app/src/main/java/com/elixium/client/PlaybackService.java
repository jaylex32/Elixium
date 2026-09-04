package com.elixium.client;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Holds the process up while something is playing.
 *
 * Android stops a backgrounded app from doing work once the screen is off, and
 * a WebView is not exempt — which is why the interface played a few songs
 * through a phone browser and then went quiet. A foreground service is the
 * documented way to say the app is doing something the user can hear, and the
 * notification is the price the system charges for it.
 *
 * It carries no transport controls on purpose. The web interface already
 * publishes a MediaSession, so the lock screen shows the real title, artwork
 * and buttons from the page itself; adding a second set here would put two
 * competing notifications in the shade for one stream of audio.
 */
public class PlaybackService extends Service {

  private static final String CHANNEL_ID = "elixium-playback";
  private static final int NOTIFICATION_ID = 1;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    createChannel();

    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent tap = PendingIntent.getActivity(
        this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(getString(R.string.playing))
        .setContentText(getString(R.string.playing_detail))
        .setSmallIcon(android.R.drawable.ic_media_play)
        .setContentIntent(tap)
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build();

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }

    // Restarting with no intent would put up a notification for audio that is
    // not playing, so the system is told not to bother.
    return START_NOT_STICKY;
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

    NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
    channel.setShowBadge(false);
    channel.setDescription(getString(R.string.playing_detail));
    manager.createNotificationChannel(channel);
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
