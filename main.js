const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");

let adminWindow = null;
let timerWindow = null;
let timerConfig = null;
let isDragUnlocked = true;
let currentOverlayMode = null;

const ACTIVE_BOUNDS = { width: 420, height: 100 };
const WAITING_BOUNDS = { width: 700, height: 180 };

function normalizeConfig(rawConfig) {
  const startTimeMs = Number(rawConfig?.startTimeMs ?? Date.now());
  const durationMinutes = Math.max(1, Number(rawConfig?.durationMinutes ?? 60));
  const alertThresholdMinutes = Math.max(
    1,
    Number(rawConfig?.alertThresholdMinutes ?? 10),
  );

  return {
    startTimeMs,
    durationMinutes,
    alertThresholdMinutes,
  };
}

function getWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function boundsForMode(mode) {
  const workArea = getWorkArea();

  if (mode === "waiting") {
    return {
      x: workArea.x + Math.round((workArea.width - WAITING_BOUNDS.width) / 2),
      y: workArea.y + Math.round((workArea.height - WAITING_BOUNDS.height) / 2),
      width: WAITING_BOUNDS.width,
      height: WAITING_BOUNDS.height,
    };
  }

  return {
    x: workArea.x + 20,
    y: workArea.y + workArea.height - 120,
    width: ACTIVE_BOUNDS.width,
    height: ACTIVE_BOUNDS.height,
  };
}

function applyClickThrough() {
  if (!timerWindow || timerWindow.isDestroyed()) {
    return;
  }

  // Keep overlay non-blocking while timer is running and drag is locked.
  const ignoreMouse = !isDragUnlocked;
  if (ignoreMouse) {
    timerWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    timerWindow.setIgnoreMouseEvents(false);
  }
  timerWindow.webContents.send("timer:click-through", { ignoreMouse });
}

function moveTimerWindow(mode) {
  if (!timerWindow || timerWindow.isDestroyed()) {
    return;
  }

  if (currentOverlayMode === mode) {
    return;
  }

  currentOverlayMode = mode;
  const nextBounds = boundsForMode(mode);
  timerWindow.setBounds(nextBounds, true);
}

function createAdminWindow() {
  adminWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 700,
    minHeight: 500,
    center: true,
    frame: true,
    backgroundColor: "#0b1115",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  adminWindow.setMenuBarVisibility(false);
  adminWindow.loadFile(path.join(__dirname, "index.html"), {
    query: { mode: "admin" },
  });

  adminWindow.on("closed", () => {
    adminWindow = null;
  });
}

function createTimerWindow(config) {
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.close();
  }

  const initialMode = Date.now() < config.startTimeMs ? "waiting" : "active";
  const initialBounds = boundsForMode(initialMode);
  currentOverlayMode = initialMode;

  timerWindow = new BrowserWindow({
    ...initialBounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: isDragUnlocked,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  timerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  timerWindow.setAlwaysOnTop(true, "screen-saver");

  timerWindow.loadFile(path.join(__dirname, "index.html"), {
    query: { mode: "timer" },
  });

  timerWindow.once("ready-to-show", () => {
    timerWindow.showInactive();
    timerWindow.webContents.send("timer:config", config);
    timerWindow.webContents.send("timer:drag-state", {
      unlocked: isDragUnlocked,
    });
    applyClickThrough();
  });

  timerWindow.on("closed", () => {
    timerWindow = null;
    currentOverlayMode = null;
    isDragUnlocked = true;
  });
}

ipcMain.on("admin:start-timer", (_event, incomingConfig) => {
  timerConfig = normalizeConfig(incomingConfig);
  isDragUnlocked = true;
  createTimerWindow(timerConfig);

  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.webContents.send("admin:status", { running: true });
  }
});

ipcMain.on("admin:stop-timer", () => {
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.close();
  }

  timerConfig = null;
  isDragUnlocked = true;

  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.webContents.send("admin:status", { running: false });
  }
});

ipcMain.on("admin:set-draggable", (_event, unlocked) => {
  isDragUnlocked = Boolean(unlocked);

  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.setFocusable(isDragUnlocked);
    timerWindow.webContents.send("timer:drag-state", {
      unlocked: isDragUnlocked,
    });
    applyClickThrough();
  }
});

ipcMain.on("set-ignore-mouse", (event, ignore, forward = false) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) {
    return;
  }

  const shouldIgnoreMouse = Boolean(ignore);
  const shouldForward = Boolean(forward);
  isDragUnlocked = !shouldIgnoreMouse;
  win.setFocusable(!shouldIgnoreMouse);

  if (shouldIgnoreMouse) {
    win.setIgnoreMouseEvents(true, { forward: shouldForward });
  } else {
    win.setIgnoreMouseEvents(false);
  }
});

ipcMain.on("timer:mode-changed", (_event, mode) => {
  if (mode !== "waiting" && mode !== "active" && mode !== "alert") {
    return;
  }

  // Alert mode shares the same bottom-left placement as active mode.
  moveTimerWindow(mode === "waiting" ? "waiting" : "active");
});

ipcMain.on("timer:request-config", (event) => {
  if (timerConfig) {
    event.sender.send("timer:config", timerConfig);
    event.sender.send("timer:drag-state", { unlocked: isDragUnlocked });
    event.sender.send("timer:click-through", { ignoreMouse: !isDragUnlocked });
  }
});

app.whenReady().then(() => {
  createAdminWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAdminWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
