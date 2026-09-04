# Elixium for Android

A small native wrapper around the Elixium web interface, built for one reason:
**audio that keeps playing when the screen goes off.**

## Why this exists

Adding the web interface to a phone's home screen makes a shortcut, and a
shortcut is still a browser tab. Once the phone locks, that tab is a background
tab, and Android is free to stop giving it work — so playback died after a few
songs with no explanation.

An app can hold a *foreground service* while audio is playing. That is the
documented way to tell the system this process is doing something the user can
hear, and it is the entire reason for wrapping the page rather than linking to
it. Everything else here is the minimum needed to get a WebView onto the screen.

## What it is not

It is not a rewrite of the interface. The page you see is the same web UI the
server already serves, so it stays current when you update the server and there
is no second client to keep in step.

The lock-screen controls — title, artwork, play, skip — come from the web
interface's own MediaSession, not from this app. The app's own notification
carries no buttons on purpose: two sets of controls for one stream of audio is
worse than one.

## Using it

On first launch it asks where your server is. Enter the address you would type
in a browser:

```
music.example.com
https://music.example.com
192.168.1.20:9999
```

A missing `https://` is filled in, and trailing slashes are trimmed. The answer
is remembered, so this happens once.

To point it somewhere else, press back at the top level of the interface and
choose **Change server**. If the address stops resolving, the setup screen comes
back with the reason rather than a blank page.

## Building it

Requires a JDK 17 and the Android SDK (platform 34, build-tools 34).

```sh
cd android
./gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`.

`local.properties` points Gradle at your SDK and is deliberately not committed —
it is a path on one machine. Create it if the build cannot find the SDK:

```properties
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

Use forward slashes even on Windows. A Java properties file treats a backslash
as an escape, so `C:\Users\flexx\...` silently becomes a path containing a
formfeed, and Gradle fails with "the filename, directory name, or volume label
syntax is incorrect".

### Release builds

`assembleDebug` signs with the debug key, which is fine for installing on your
own devices and is what the build above produces. A release build needs a
keystore of your own:

```sh
./gradlew assembleRelease
```

Keystores and `keystore.properties` are gitignored. Never commit either.

## Permissions, and why each is here

| Permission | Reason |
|---|---|
| `INTERNET` | Reach your server. |
| `ACCESS_NETWORK_STATE` | Let the WebView see whether it is online. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Keep playing with the screen off. |
| `POST_NOTIFICATIONS` | Android requires a notification to accompany a foreground service. |
| `WAKE_LOCK` | Held by the media stack while audio plays. |

`usesCleartextTraffic` is enabled so a server on a local address over plain HTTP
still works. Over the internet, use HTTPS.
