import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  onValue,
  ref,
  set,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const mode =
  new URLSearchParams(window.location.search).get("mode") === "tv"
    ? "tv"
    : "admin";
const timerPath = "timer_youness_gn/state";

const firebaseConfig = {
  apiKey: "AIzaSyAeUC224fUmuHXk9fj9s3c-KIAbR6PXYOQ",
  authDomain: "timer-youness-gn.firebaseapp.com",
  projectId: "timer-youness-gn",
  storageBucket: "timer-youness-gn.firebasestorage.app",
  messagingSenderId: "529418644158",
  appId: "1:529418644158:web:0bfd81060d6596a3ed8cef",
  measurementId: "G-7HVN671GPQ"
};

const defaultState = {
  durationMs: 30 * 60 * 1000,
  remainingMs: 30 * 60 * 1000,
  status: "idle",
  endAt: null,
  updatedAt: 0,
};

const dom = {
  modeLabel: document.getElementById("modeLabel"),
  adminView: document.getElementById("adminView"),
  tvView: document.getElementById("tvView"),
  durationInput: document.getElementById("durationInput"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resetBtn: document.getElementById("resetBtn"),
  adminLiveTime: document.getElementById("adminLiveTime"),
  adminStatus: document.getElementById("adminStatus"),
  tvStatus: document.getElementById("tvStatus"),
  tvTimer: document.getElementById("tvTimer"),
  tvProgress: document.getElementById("tvProgress"),
  tvHint: document.getElementById("tvHint"),
};

let state = { ...defaultState };
let database = null;
let timerRef = null;
let tvScale = 1;

init();

async function init() {
  setupMode();
  registerServiceWorker();
  setupRemoteControlSupport();

  const hasPlaceholders = Object.values(firebaseConfig).some((value) =>
    String(value).startsWith("PASTE_"),
  );

  if (hasPlaceholders) {
    renderCredentialWarning();
    startRenderLoop();
    return;
  }

  const app = initializeApp(firebaseConfig);
  database = getDatabase(app);
  timerRef = ref(database, timerPath);

  subscribeToTimerState();
  bindAdminActions();

  if (mode === "tv") {
    await requestWakeLock();
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  startRenderLoop();
}

function setupMode() {
  dom.modeLabel.textContent = mode === "tv" ? "TV Mode" : "Admin Mode";
  dom.adminView.classList.toggle("hidden", mode !== "admin");
  dom.tvView.classList.toggle("hidden", mode !== "tv");
}

function subscribeToTimerState() {
  onValue(timerRef, (snapshot) => {
    const remote = snapshot.val();

    if (!remote) {
      set(timerRef, { ...defaultState, updatedAt: Date.now() });
      return;
    }

    state = sanitizeState(remote);

    if (mode === "admin") {
      const nextMinutes = Math.max(1, Math.round(state.durationMs / 60000));
      dom.durationInput.value = String(nextMinutes);
    }

    render();
  });
}

function bindAdminActions() {
  if (mode !== "admin") {
    return;
  }

  dom.startBtn.addEventListener("click", handleStart);
  dom.pauseBtn.addEventListener("click", handlePause);
  dom.resetBtn.addEventListener("click", handleReset);

  dom.durationInput.addEventListener("change", async () => {
    if (!timerRef || state.status === "running") {
      return;
    }

    const minutes = clampMinutes(Number(dom.durationInput.value));
    const durationMs = minutes * 60000;
    await writeState({
      ...state,
      status: state.status === "paused" ? "paused" : "idle",
      durationMs,
      remainingMs: state.status === "paused" ? state.remainingMs : durationMs,
      updatedAt: Date.now(),
    });
  });
}

async function handleStart() {
  if (!timerRef) {
    return;
  }

  const minutes = clampMinutes(Number(dom.durationInput.value));
  const durationMs = minutes * 60000;

  const remainingMs =
    state.status === "paused" ? Math.max(1000, state.remainingMs) : durationMs;

  await writeState({
    durationMs,
    remainingMs,
    status: "running",
    endAt: Date.now() + remainingMs,
    updatedAt: Date.now(),
  });
}

async function handlePause() {
  if (!timerRef || state.status !== "running") {
    return;
  }

  const remaining = Math.max(0, Number(state.endAt || Date.now()) - Date.now());

  await writeState({
    ...state,
    remainingMs: remaining,
    endAt: null,
    status: "paused",
    updatedAt: Date.now(),
  });
}

async function handleReset() {
  if (!timerRef) {
    return;
  }

  const minutes = clampMinutes(Number(dom.durationInput.value));
  const durationMs = minutes * 60000;

  await writeState({
    durationMs,
    remainingMs: durationMs,
    status: "idle",
    endAt: null,
    updatedAt: Date.now(),
  });
}

async function writeState(nextState) {
  if (!timerRef) {
    state = sanitizeState(nextState);
    render();
    return;
  }

  await set(timerRef, sanitizeState(nextState));
}

function startRenderLoop() {
  render();
  window.setInterval(render, 250);
}

function render() {
  const live = computeLiveState(state);
  const text = formatDuration(live.remainingMs);
  const progress =
    live.durationMs > 0
      ? (100 * (live.durationMs - live.remainingMs)) / live.durationMs
      : 0;

  if (mode === "admin") {
    dom.adminLiveTime.textContent = text;
    dom.adminStatus.textContent = statusMessage(live.status);
  }

  if (mode === "tv") {
    dom.tvTimer.textContent = text;
    dom.tvStatus.textContent = statusMessage(live.status);
    dom.tvProgress.style.width = `${Math.max(0, Math.min(100, progress)).toFixed(1)}%`;
    document.body.classList.toggle(
      "tv-alert",
      live.remainingMs <= 5 * 60 * 1000 && live.status !== "idle",
    );
  }
}

function computeLiveState(sourceState) {
  const safe = sanitizeState(sourceState);

  if (safe.status !== "running" || !safe.endAt) {
    return safe;
  }

  const remainingMs = Math.max(0, safe.endAt - Date.now());

  if (remainingMs <= 0) {
    return {
      ...safe,
      remainingMs: 0,
      status: "idle",
      endAt: null,
    };
  }

  return {
    ...safe,
    remainingMs,
  };
}

function sanitizeState(raw) {
  const durationMs = Math.max(
    60000,
    Number(raw?.durationMs ?? defaultState.durationMs),
  );
  const remainingMs = Math.max(0, Number(raw?.remainingMs ?? durationMs));
  const status = ["idle", "running", "paused"].includes(raw?.status)
    ? raw.status
    : "idle";
  const endAt = raw?.endAt ? Number(raw.endAt) : null;

  return {
    durationMs,
    remainingMs,
    status,
    endAt,
    updatedAt: Number(raw?.updatedAt ?? Date.now()),
  };
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusMessage(status) {
  if (status === "running") {
    return "Running";
  }
  if (status === "paused") {
    return "Paused";
  }
  return "Idle";
}

function clampMinutes(value) {
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(600, Math.max(1, Math.round(value)));
}

function setupRemoteControlSupport() {
  document.addEventListener("keydown", (event) => {
    if (mode === "admin") {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        adjustDuration(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        adjustDuration(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (computeLiveState(state).status === "running") {
          handlePause();
        } else {
          handleStart();
        }
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      tvScale = Math.min(1.2, tvScale + 0.03);
      document.documentElement.style.setProperty("--tv-scale", String(tvScale));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      tvScale = Math.max(0.9, tvScale - 0.03);
      document.documentElement.style.setProperty("--tv-scale", String(tvScale));
    } else if (event.key === "Enter") {
      event.preventDefault();
      toggleFullscreen();
    }
  });
}

function adjustDuration(delta) {
  const current = clampMinutes(Number(dom.durationInput.value));
  const next = clampMinutes(current + delta);
  dom.durationInput.value = String(next);
  dom.adminStatus.textContent = `Duration set to ${next} minute(s)`;
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Ignore SW registration errors in unsupported environments.
    });
  }
}

function renderCredentialWarning() {
  const warning = "Firebase credentials missing: paste config in script.js";
  if (mode === "admin") {
    dom.adminStatus.textContent = warning;
  } else {
    dom.tvHint.textContent = warning;
  }
}

let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // Wake lock may be blocked by browser policy.
  }
}

async function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    await requestWakeLock();
  }
}
