'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- Electron's main process is CommonJS. */

/**
 * Electron shell for Elixium.
 *
 * The download engine is unchanged: this starts the existing server on
 * loopback and points a native window at it. Nothing about the CLI, the
 * packaged server binaries or the Android client is affected, which is the
 * whole reason for running it rather than reimplementing it — the services in
 * src/ are wired at module scope in elixium.ts, tangled with CLI argument
 * parsing, so importing them here would fight that.
 *
 * The server is a child process rather than in-process for the same reason,
 * plus one benefit: if it dies, the window survives and can restart it instead
 * of the whole app disappearing.
 */

const {app, BrowserWindow, Menu, shell, dialog} = require('electron');
const {spawn} = require('child_process');
const {createServer} = require('net');
const path = require('path');
const fs = require('fs');
const http = require('http');

/**
 * Where the server's config, downloads and state live.
 *
 * Resolved lazily: app.getPath is unavailable until the app object exists, and
 * reading it at module scope crashes before any error handler is installed.
 */
let dataDir = '';

let serverProcess = null;
let serverPort = 0;
let mainWindow = null;
/** Set during quit so the exit handler does not treat it as a crash. */
let quitting = false;

/**
 * Ask the OS for a free port.
 *
 * Binding to 127.0.0.1 rather than a fixed port avoids colliding with an
 * Elixium server the user may already run, and loopback-only binds do not
 * raise a Windows firewall prompt.
 */
const findFreePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Is this exact port free right now? */
const isPortFree = (port) =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

/**
 * Reuse the same port between launches.
 *
 * This is not a nicety. The window loads http://127.0.0.1:<port>, and every
 * browser storage API is scoped to the origin — which includes the port. A
 * fresh port each launch therefore means a fresh, empty localStorage each
 * launch, so the theme, the download history, recent searches and everything
 * else the interface remembers silently reset every time the app was reopened.
 * It looked like settings "not saving"; nothing was ever loaded to begin with.
 *
 * The port is remembered in app data and reused whenever it is still free,
 * falling back to a new one only if something else has taken it — which keeps
 * the origin stable in practice without hardcoding a port that could collide
 * with an Elixium server the user already runs.
 */
const resolveStablePort = async () => {
  const portFile = path.join(dataDir, 'port.json');

  try {
    const saved = Number(JSON.parse(fs.readFileSync(portFile, 'utf8')).port);
    if (Number.isInteger(saved) && saved > 1024 && saved < 65536 && (await isPortFree(saved))) {
      return saved;
    }
  } catch {
    // No remembered port yet, or it is unusable — fall through and pick one.
  }

  const port = await findFreePort();
  try {
    fs.writeFileSync(portFile, JSON.stringify({port}), 'utf8');
  } catch {
    // Not fatal: the app still runs, it just will not remember state next time.
  }
  return port;
};

/**
 * Locate the compiled server.
 *
 * Unpacked in a build (asar cannot be executed from), alongside the repo in
 * development.
 */
const resolveServerEntry = () => {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'server', 'elixium.js'),
    path.join(process.resourcesPath || '', 'server', 'elixium.js'),
    path.join(__dirname, '..', 'dist', 'src', 'elixium.js'),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
};

/** Poll /health until the server answers, so the window never shows a dead page. */
const waitForServer = (port, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      const request = http.get({host: '127.0.0.1', port, path: '/api/v1/health', timeout: 2000}, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      request.on('error', retry);
      request.on('timeout', () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('The Elixium engine did not start in time.'));
      setTimeout(attempt, 300);
    };

    attempt();
  });

const startServer = async () => {
  const entry = resolveServerEntry();
  if (!entry) throw new Error('Could not find the Elixium engine inside this build.');

  serverPort = await resolveStablePort();

  /*
   * No --openssl-legacy-provider here, deliberately.
   *
   * Deezer streams are Blowfish-encrypted, and on Node 17+ that cipher lives
   * behind OpenSSL 3's legacy provider — which is why the standalone server
   * re-execs itself with the flag. Electron links BoringSSL instead, where
   * bf-cbc is simply available, so the flag is unnecessary; and Electron
   * rejects it outright as an unknown option, which is what made the engine
   * fail to start at all. Verified directly: bf-cbc constructs under Electron
   * and throws ERR_OSSL_EVP_UNSUPPORTED under plain Node 20.
   */
  serverProcess = spawn(
    process.execPath,
    [
      entry,
      '--web',
      '--port',
      String(serverPort),
      // Local-only: an app on someone's laptop has no business listening on
      // their network, and this is what keeps that true rather than assumed.
      '--host',
      '127.0.0.1',
      '--config-file',
      path.join(dataDir, 'elixium.config.json'),
    ],
    {
      cwd: dataDir,
      // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node,
      // so no separate Node install is required on the user's machine.
      env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const logPath = path.join(dataDir, 'engine.log');
  const logStream = fs.createWriteStream(logPath, {flags: 'a'});
  serverProcess.stdout.pipe(logStream);
  serverProcess.stderr.pipe(logStream);

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (quitting || !mainWindow) return;
    // A crash after startup should say so rather than leaving a blank window.
    dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'Elixium stopped',
        message: 'The Elixium engine stopped unexpectedly.',
        detail: `Exit code ${code}. Details were written to:\n${logPath}`,
        buttons: ['Quit'],
      })
      .then(() => app.quit());
  });

  await waitForServer(serverPort);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0f1116',
    show: false,
    title: 'Elixium',
    /*
     * Windows takes the window icon from the executable and macOS from the
     * bundle, but Linux takes it from here — and so does `npm start` on every
     * platform, which is otherwise the bare Electron logo.
     */
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      // The page is our own UI over loopback, but there is no reason to grant
      // it Node access it does not use.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Anything not served by the app itself belongs in the user's browser, not
  // in a frameless Electron window they cannot navigate out of.
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    shell.openExternal(url);
    return {action: 'deny'};
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
};

/**
 * Where downloads actually land, read fresh from the config each time.
 *
 * A hardcoded folder would be wrong the moment someone changes the path in
 * Settings, and relative paths in the config resolve against the engine's
 * working directory — which is the app data folder, not wherever Electron was
 * launched from.
 */
const resolveDownloadDir = (service) => {
  let configured = '';
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'elixium.config.json'), 'utf8');
    configured = String(JSON.parse(raw)?.paths?.[service] || '');
  } catch {
    // No config yet, or unreadable — fall back to the engine's own default.
  }

  const fallback = path.join('Music', service === 'qobuz' ? 'Qobuz' : 'Deezer');
  const target = configured || fallback;
  return path.isAbsolute(target) ? target : path.join(dataDir, target);
};

/**
 * Open a folder, creating it first.
 *
 * shell.openPath on a path that does not exist fails silently, which reads as
 * a dead menu item. Downloads folders do not exist until the first download.
 */
const openFolder = async (target) => {
  try {
    fs.mkdirSync(target, {recursive: true});
  } catch {
    // If it cannot be created, openPath will report the problem below.
  }
  const error = await shell.openPath(target);
  if (error && mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Could not open folder',
      message: 'Elixium could not open that folder.',
      detail: `${target}\n\n${error}`,
      buttons: ['OK'],
    });
  }
};

const buildMenu = () => {
  const template = [
    ...(process.platform === 'darwin' ? [{role: 'appMenu'}] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Qobuz downloads',
          click: () => openFolder(resolveDownloadDir('qobuz')),
        },
        {
          label: 'Open Deezer downloads',
          click: () => openFolder(resolveDownloadDir('deezer')),
        },
        {
          label: 'Open app data folder',
          click: () => openFolder(dataDir),
        },
        {
          label: 'Open settings file',
          click: () => shell.openPath(path.join(dataDir, 'elixium.config.json')),
        },
        {type: 'separator'},
        {role: process.platform === 'darwin' ? 'close' : 'quit'},
      ],
    },
    {role: 'editMenu'},
    {
      label: 'View',
      submenu: [
        {role: 'reload'},
        {role: 'toggleDevTools'},
        {type: 'separator'},
        {role: 'resetZoom'},
        {role: 'zoomIn'},
        {role: 'zoomOut'},
        {type: 'separator'},
        {role: 'togglefullscreen'},
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open engine log',
          click: () => shell.openPath(path.join(dataDir, 'engine.log')),
        },
        {
          label: 'Open in browser',
          click: () => shell.openExternal(`http://127.0.0.1:${serverPort}`),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

// A second launch should focus the existing window rather than start a second
// engine against the same config and download folder.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    dataDir = app.getPath('userData');
    fs.mkdirSync(dataDir, {recursive: true});
    try {
      await startServer();
      buildMenu();
      createWindow();
    } catch (error) {
      dialog.showErrorBox('Elixium could not start', String(error && error.message ? error.message : error));
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/*
 * Kill the engine on the way out.
 *
 * Without this the child survives the window closing and keeps holding its
 * port and the download queue — the classic orphaned-process bug where the app
 * "won't start again" because a previous copy is still running.
 */
const stopServer = () => {
  quitting = true;
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
    else child.kill('SIGTERM');
  } catch {
    // Nothing useful to do if it is already gone.
  }
};

app.on('before-quit', stopServer);
process.on('exit', stopServer);
