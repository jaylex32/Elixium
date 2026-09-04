package com.elixium.client;

/**
 * The Elixium engine, running inside this process.
 *
 * The desktop build spawns the same engine as a child process. Android has no
 * node binary to spawn, so the runtime is linked into the app and started on a
 * thread instead — the arguments below are the ones the desktop shell passes,
 * unchanged, which is what keeps the two builds running the same program.
 */
final class NodeRuntime {

  /** Loopback only. Nothing outside the phone can reach the engine. */
  static final String HOST = "127.0.0.1";
  static final int PORT = 9977;

  static {
    // libnode first: the bridge links against it.
    System.loadLibrary("node");
    System.loadLibrary("elixiumnode");
  }

  private NodeRuntime() {}

  /**
   * Blocks for as long as the engine runs, so callers must give it a thread.
   *
   * @param arguments argv, starting with the program name.
   */
  static native int nativeStart(String[] arguments, String workingDirectory);

  static String url() {
    return "http://" + HOST + ":" + PORT;
  }
}
