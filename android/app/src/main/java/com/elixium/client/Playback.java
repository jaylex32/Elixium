package com.elixium.client;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * What Android needs to know about the music, since the WebView will not say.
 *
 * The interface publishes a Web MediaSession, and in a browser that is enough:
 * Chrome turns it into a notification, a lock-screen player and headset button
 * handling. A WebView surfaces none of it, so on Android the same page plays
 * with nothing to control it — which is the difference between an app and a
 * page in a frame.
 *
 * So the page reports its state here, and this keeps a real MediaSessionCompat
 * in step with it. The controls travel back the other way: a tap on the
 * notification calls the interface's own remote, so the queue, shuffle and
 * repeat all behave exactly as they do on screen rather than being
 * reimplemented natively and drifting.
 */
final class Playback {

  private static final String TAG = "ElixiumEngine";

  /** Told when the state changes, so the notification can be redrawn. */
  interface Listener {
    void onPlaybackChanged();
  }

  /** Drives the interface when a transport control is used. */
  interface Remote {
    void command(String script);
  }

  private static Playback instance;

  private final MediaSessionCompat session;
  private final ExecutorService artworkLoader = Executors.newSingleThreadExecutor();

  private Listener listener;
  private Remote remote;

  private String title = "";
  private String artist = "";
  private String album = "";
  private String artworkUrl = "";
  private boolean playing = false;
  private long position = 0;
  private long duration = 0;
  private Bitmap artwork;
  private String artworkLoaded = "";

  private Playback(Context context) {
    session = new MediaSessionCompat(context.getApplicationContext(), "Elixium");
    session.setCallback(
        new MediaSessionCompat.Callback() {
          @Override
          public void onPlay() {
            send("window.__elixiumRemote && window.__elixiumRemote.play();");
          }

          @Override
          public void onPause() {
            send("window.__elixiumRemote && window.__elixiumRemote.pause();");
          }

          @Override
          public void onSkipToNext() {
            send("window.__elixiumRemote && window.__elixiumRemote.next();");
          }

          @Override
          public void onSkipToPrevious() {
            send("window.__elixiumRemote && window.__elixiumRemote.previous();");
          }

          @Override
          public void onStop() {
            send("window.__elixiumRemote && window.__elixiumRemote.stop();");
          }

          @Override
          public void onSeekTo(long ms) {
            send("window.__elixiumRemote && window.__elixiumRemote.seek(" + (ms / 1000) + ");");
          }
        });
    session.setActive(true);
  }

  static synchronized Playback get(Context context) {
    if (instance == null) instance = new Playback(context);
    return instance;
  }

  MediaSessionCompat session() {
    return session;
  }

  void setListener(Listener value) {
    listener = value;
  }

  void setRemote(Remote value) {
    remote = value;
  }

  private void send(String script) {
    Remote target = remote;
    if (target != null) target.command(script);
  }

  boolean isPlaying() {
    return playing;
  }

  boolean hasTrack() {
    return !title.isEmpty();
  }

  String title() {
    return title.isEmpty() ? "Elixium" : title;
  }

  String subtitle() {
    if (artist.isEmpty()) return album;
    return album.isEmpty() ? artist : artist + " — " + album;
  }

  Bitmap artwork() {
    return artwork;
  }

  /** Accepts the interface's report and brings the session into line with it. */
  void update(String json) {
    try {
      JSONObject state = new JSONObject(json);
      boolean has = state.optBoolean("hasTrack", false);

      title = has ? state.optString("title", "") : "";
      artist = has ? state.optString("artist", "") : "";
      album = has ? state.optString("album", "") : "";
      playing = has && state.optBoolean("playing", false);
      position = (long) (state.optDouble("position", 0) * 1000);
      duration = (long) (state.optDouble("duration", 0) * 1000);

      String cover = has ? state.optString("artwork", "") : "";
      if (!cover.equals(artworkUrl)) {
        artworkUrl = cover;
        artwork = null;
        loadArtwork(cover);
      }

      publish();
    } catch (Exception e) {
      Log.w(TAG, "could not read the playback state", e);
    }
  }

  private void publish() {
    MediaMetadataCompat.Builder metadata =
        new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
    if (artwork != null) {
      metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
    }
    session.setMetadata(metadata.build());

    session.setPlaybackState(
        new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY
                    | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY_PAUSE
                    | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                    | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackStateCompat.ACTION_SEEK_TO
                    | PlaybackStateCompat.ACTION_STOP)
            .setState(
                playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                position,
                playing ? 1f : 0f,
                SystemClock.elapsedRealtime())
            .build());

    Listener target = listener;
    if (target != null) target.onPlaybackChanged();
  }

  /**
   * Fetch the cover off the main thread, once per track.
   *
   * The artwork usually comes from the service's own CDN rather than the engine,
   * so this is a real network call and must not block the page reporting its
   * state. A cover that will not load simply leaves the notification without
   * one.
   */
  private void loadArtwork(String url) {
    if (url == null || url.isEmpty() || url.equals(artworkLoaded)) return;
    artworkLoaded = url;

    artworkLoader.execute(
        () -> {
          Bitmap loaded = null;
          HttpURLConnection connection = null;
          try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            try (InputStream stream = connection.getInputStream()) {
              BitmapFactory.Options options = new BitmapFactory.Options();
              // A notification thumbnail never needs a full-size cover.
              options.inSampleSize = 2;
              loaded = BitmapFactory.decodeStream(stream, null, options);
            }
          } catch (Exception e) {
            Log.i(TAG, "no artwork for the notification: " + e.getMessage());
          } finally {
            if (connection != null) connection.disconnect();
          }

          if (loaded == null || !url.equals(artworkUrl)) return;
          artwork = loaded;
          publish();
        });
  }

  void release() {
    session.setActive(false);
    session.release();
    artworkLoader.shutdownNow();
    instance = null;
  }
}
