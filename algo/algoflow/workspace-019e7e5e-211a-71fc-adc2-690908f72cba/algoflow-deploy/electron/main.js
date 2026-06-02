/**
 * AlgoFlow — Electron Main Process
 */

const { app, BrowserWindow, dialog, shell, Tray, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork, execSync } = require("child_process");
const Store = require("electron-store");

const store = new Store();
const isDev = !app.isPackaged || process.argv.includes("--dev");

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let backendReady = false;
let activeBackendPort = store.get("backendPort", 3001);

function getProjectRoot() {
  return isDev ? path.join(__dirname, "..") : process.resourcesPath;
}

function getNodeModulesPath() {
  if (isDev) return path.join(__dirname, "..", "node_modules");
  return path.join(path.dirname(app.getAppPath()), "node_modules");
}

function getCompilersDocPath() {
  const doc = path.join(getProjectRoot(), "docs", "COMPILERS.md");
  if (fs.existsSync(doc)) return doc;
  return path.join(__dirname, "..", "docs", "COMPILERS.md");
}

app.whenReady().then(async () => {
  const compilerStatus = await checkCompilers();
  if (!compilerStatus.allPresent) {
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "AlgoFlow — Missing Compilers",
      message: "Some compilers are not installed or not in PATH.",
      detail: compilerStatus.detail,
      buttons: ["Continue Anyway", "Open Install Guide", "Quit"],
      defaultId: 1,
    });

    if (choice === 1) {
      const docPath = getCompilersDocPath();
      if (fs.existsSync(docPath)) {
        shell.openPath(docPath);
      } else {
        shell.openExternal("file://" + path.join(__dirname, "..", "README.md"));
      }
      app.quit();
      return;
    }
    if (choice === 2) {
      app.quit();
      return;
    }
  }

  showSplash();
  activeBackendPort = await startBackend();
  store.set("backendPort", activeBackendPort);
  createMainWindow();
  createTray();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  gracefulShutdown();
});

function showSplash() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.center();
}

function closeSplash() {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
}

function createMainWindow() {
  const windowState = store.get("windowState", {
    width: 1280,
    height: 800,
    maximized: false,
  });

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "AlgoFlow",
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (windowState.maximized) {
    mainWindow.maximize();
  }

  mainWindow.loadURL(`http://127.0.0.1:${activeBackendPort}`);

  mainWindow.once("ready-to-show", () => {
    closeSplash();
    mainWindow.show();
    backendReady = true;
  });

  const saveBounds = () => {
    if (!mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      store.set("windowState", mainWindow.getBounds());
    }
    store.set("windowState.maximized", mainWindow.isMaximized());
  };

  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function startBackend() {
  const preferredPort = store.get("backendPort", 3001);
  const serverPath = path.join(getProjectRoot(), "server", "index.js");

  if (!fs.existsSync(serverPath)) {
    dialog.showErrorBox(
      "AlgoFlow — Missing Server",
      `Backend not found at:\n${serverPath}`
    );
    return preferredPort;
  }

  const env = {
    ...process.env,
    PORT: String(preferredPort),
    NODE_ENV: isDev ? "development" : "production",
    ALGOFLOW_DATA_DIR: app.getPath("userData"),
    NODE_PATH: getNodeModulesPath(),
  };

  if (!isDev) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  return new Promise((resolve) => {
    let resolvedPort = preferredPort;

    serverProcess = fork(serverPath, [], {
      env,
      cwd: getProjectRoot(),
      stdio: "pipe",
      execPath: isDev ? process.env.npm_node_execpath || "node" : undefined,
    });

    const tryResolve = () => resolve(resolvedPort);

    serverProcess.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log(`[Backend] ${msg.trim()}`);
      const m = /Listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(msg);
      if (m) {
        resolvedPort = parseInt(m[1], 10);
        tryResolve();
      }
    });

    serverProcess.stderr.on("data", (data) => {
      console.error(`[Backend] ${data.toString().trim()}`);
    });

    serverProcess.on("error", (err) => {
      dialog.showErrorBox(
        "AlgoFlow — Backend Error",
        `Failed to start the backend server:\n${err.message}`
      );
      tryResolve();
    });

    serverProcess.on("exit", (code) => {
      if (backendReady && code !== 0) {
        dialog.showErrorBox(
          "AlgoFlow — Server Crashed",
          `The backend exited unexpectedly (code ${code}).`
        );
      }
    });

    setTimeout(() => {
      const portFile = path.join(app.getPath("userData"), "server-port.txt");
      if (fs.existsSync(portFile)) {
        resolvedPort = parseInt(fs.readFileSync(portFile, "utf8"), 10) || resolvedPort;
      }
      tryResolve();
    }, 6000);
  });
}

function gracefulShutdown() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    setTimeout(() => {
      if (serverProcess) serverProcess.kill("SIGKILL");
    }, 3000);
  }
}

function createTray() {
  const iconPath = path.join(__dirname, "icons", "tray-icon.png");
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show AlgoFlow",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      },
    },
    {
      label: `Backend: http://127.0.0.1:${activeBackendPort}`,
      click: () => shell.openExternal(`http://127.0.0.1:${activeBackendPort}`),
    },
    { type: "separator" },
    {
      label: "Compiler Status",
      click: async () => {
        const status = await checkCompilers();
        dialog.showMessageBox({
          type: "info",
          title: "Compiler Status",
          message: status.detail,
        });
      },
    },
    { type: "separator" },
    {
      label: "Quit AlgoFlow",
      click: () => {
        gracefulShutdown();
        app.quit();
      },
    },
  ]);

  tray.setToolTip("AlgoFlow");
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

async function checkCompilers() {
  const isWin = process.platform === "win32";
  const checks = [
    { name: "g++ (C++)", cmd: "g++ --version", required: true },
    {
      name: isWin ? "python (Python)" : "python3 (Python)",
      cmd: isWin ? "python --version" : "python3 --version",
      required: true,
    },
    { name: "javac (Java)", cmd: "javac -version", required: false },
  ];

  const results = [];
  let allPresent = true;

  for (const check of checks) {
    try {
      const output = execSync(check.cmd, {
        timeout: 5000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: isWin,
      });
      results.push(`✓ ${check.name}: ${output.trim().split("\n")[0]}`);
    } catch {
      results.push(`${check.required ? "✗" : "⚠"} ${check.name}: NOT FOUND`);
      if (check.required) allPresent = false;
    }
  }

  return { allPresent, detail: results.join("\n") };
}

ipcMain.handle("get-backend-url", () => `http://127.0.0.1:${activeBackendPort}`);
ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("get-data-path", () => app.getPath("userData"));
ipcMain.handle("check-compilers", async () => await checkCompilers());
ipcMain.handle("get-local-ip", () => {
  const interfaces = require("os").networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
});
