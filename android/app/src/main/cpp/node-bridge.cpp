/*
 * Starts the Elixium engine inside the app.
 *
 * The desktop build runs the same engine as a child process and points a window
 * at it. Android has no Node to spawn, so the runtime is linked in and started
 * on a thread of its own instead — but the shape is identical: node::Start with
 * the arguments the desktop shell would have passed, an HTTP server on
 * loopback, and a WebView pointed at it.
 *
 * Node's own output already reaches logcat under the tag "nodejs"; an earlier
 * version redirected stdout and stderr here as well, and the two redirections
 * raced each other into an abort on a destroyed mutex. Use
 * `adb logcat -s nodejs ElixiumEngine` to watch both sides.
 */

#include <jni.h>
#include <android/log.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <string>
#include <vector>

#include "node.h"

static const char *TAG = "ElixiumEngine";

extern "C" JNIEXPORT jint JNICALL
Java_com_elixium_client_NodeRuntime_nativeStart(
        JNIEnv *env, jclass, jobjectArray arguments, jstring workingDirectory) {

    /*
     * Run from the app's own directory.
     *
     * The engine resolves its downloads and its state relative to the working
     * directory, exactly as the desktop shell does by spawning it with cwd set
     * to the app data folder. A process started from "/" would try to write
     * into the root of the filesystem instead.
     */
    const char *cwd = env->GetStringUTFChars(workingDirectory, nullptr);
    if (chdir(cwd) != 0) {
        __android_log_print(ANDROID_LOG_WARN, TAG, "could not change directory to %s", cwd);
    }
    env->ReleaseStringUTFChars(workingDirectory, cwd);

    int count = env->GetArrayLength(arguments);
    std::vector<std::string> values;
    values.reserve(count);

    size_t total = 0;
    for (int i = 0; i < count; i++) {
        auto argument = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *text = env->GetStringUTFChars(argument, nullptr);
        values.emplace_back(text);
        total += values.back().size() + 1;
        env->ReleaseStringUTFChars(argument, text);
        env->DeleteLocalRef(argument);
    }

    /*
     * argv has to be one contiguous allocation, not an array of separate
     * strings.
     *
     * Node rewrites the memory argv points into while it parses options and
     * sets the process title, and it assumes that memory is a single block.
     * Handing it separately allocated strings gives a runtime that starts,
     * reads nothing, and exits without a word — which is exactly how this
     * failed before: no output, no error, no listening socket.
     */
    char *block = (char *) calloc(total > 0 ? total : 1, sizeof(char));
    if (block == nullptr) {
        __android_log_write(ANDROID_LOG_ERROR, TAG, "out of memory building arguments");
        return 1;
    }

    std::vector<char *> argv(count + 1);
    size_t offset = 0;
    for (int i = 0; i < count; i++) {
        memcpy(block + offset, values[i].c_str(), values[i].size() + 1);
        argv[i] = block + offset;
        offset += values[i].size() + 1;
    }
    argv[count] = nullptr;

    __android_log_print(ANDROID_LOG_INFO, TAG, "starting engine with %d arguments", count);
    int status = node::Start(count, argv.data());
    __android_log_print(ANDROID_LOG_WARN, TAG, "engine returned %d", status);

    free(block);
    return status;
}
