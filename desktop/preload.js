'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- Electron preload is CommonJS. */

const {contextBridge, ipcRenderer} = require('electron');

/**
 * The only bridge between the page and the desktop shell.
 *
 * Deliberately tiny. The window loads the same interface the web server does,
 * so anything exposed here is reachable by page code — three named calls with
 * no arbitrary path or command surface is the whole point. contextIsolation
 * stays on; this object is the entire API.
 *
 * Native dialogs live here rather than on the server because the desktop app is
 * a local program: the folders it offers are the folders its own engine writes
 * to. The server build has no equivalent and must not grow one — a filesystem
 * browser reachable over HTTP would let anyone on the network enumerate the
 * host's drives.
 */
contextBridge.exposeInMainWorld('elixium', {
  /** Marks this as the desktop build, so the UI can offer native affordances. */
  isDesktop: true,

  /** Native folder chooser. Resolves to the chosen path, or null if cancelled. */
  pickFolder: (currentPath) => ipcRenderer.invoke('elixium:pick-folder', currentPath),

  /** Reveal a folder in Explorer/Finder/the Linux file manager. */
  openFolder: (target) => ipcRenderer.invoke('elixium:open-folder', target),
});
