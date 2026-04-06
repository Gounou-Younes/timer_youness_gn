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
  meetingTitle: "Monthly Review",
  startTime: "09:00",
  endTime: "10:00",
  warningThresholdMin: 5,
  status: "idle",
  pausedRemainingMs: null,
  updatedAt: 0,
};

const dom = {
  modeLabel: document.getElementById("modeLabel"),
  adminView: document.getElementById("adminView"),
  tvView: document.getElementById("tvView"),
  meetingTitleInput: document.getElementById("meetingTitleInput"),
  startTimeInput: document.getElementById("startTimeInput"),
  endTimeInput: document.getElementById("endTimeInput"),
  warningThresholdInput: document.getElementById("warningThresholdInput"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resetBtn: document.getElementById("resetBtn"),
  adminLiveTime: document.getElementById("adminLiveTime"),
  adminStatus: document.getElementById("adminStatus"),
  tvMeetingTitle: document.getElementById("tvMeetingTitle"),
  tvScheduleMeta: document.getElementById("tvScheduleMeta"),
  tvStatus: document.getElementById("tvStatus"),
  tvTimer: document.getElementById("tvTimer"),
  tvProgress: document.getElementById("tvProgress"),
  tvHint: document.getElementById("tvHint"),
};

let state = { ...defaultState };
let timerRef = null;
let tvScale = 1;
let isSavingForm = false;

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
    bindAdminActions();
    startRenderLoop();
    return;
  }

  const app = initializeApp(firebaseConfig);
  const database = getDatabase(app);
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
  if (!timerRef) {
    return;
  }

  onValue(timerRef, async (snapshot) => {
    const remote = snapshot.val();

    if (!remote) {
      await set(timerRef, { ...defaultState, updatedAt: Date.now() });
      return;
    }

    state = sanitizeState(remote);

    if (mode === "admin") {
      syncInputsFromState(state);
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

  dom.meetingTitleInput.addEventListener("input", handleSchedulerInputChange);
  dom.startTimeInput.addEventListener("change", handleSchedulerInputChange);
  dom.endTimeInput.addEventListener("change", handleSchedulerInputChange);
  dom.warningThresholdInput.addEventListener(
    "change",
    handleSchedulerInputChange,
  );
}

async function handleSchedulerInputChange() {
  if (isSavingForm) {
    return;
  }

  const formState = readSchedulerInputs();
  await writeState({
    ...state,
    ...formState,
    updatedAt: Date.now(),
  });
}

async function handleStart() {
  const formState = readSchedulerInputs();

  await writeState({
    ...state,
    ...formState,
    status: "running",
    pausedRemainingMs: null,
    updatedAt: Date.now(),
  });
}

async function handlePause() {
  if (state.status !== "running") {
    return;
  }

  const live = computeLiveState(state);

  await writeState({
    ...state,
    ...readSchedulerInputs(),
    status: "paused",
    pausedRemainingMs: live.remainingMs,
    updatedAt: Date.now(),
  });
}

async function handleReset() {
  await writeState({
    ...state,
    ...readSchedulerInputs(),
    status: "idle",
    pausedRemainingMs: null,
    updatedAt: Date.now(),
  });
}

function readSchedulerInputs() {
  return {
    meetingTitle: sanitizeMeetingTitle(dom.meetingTitleInput.value),
    startTime: sanitizeTime(dom.startTimeInput.value, defaultState.startTime),
    endTime: sanitizeTime(dom.endTimeInput.value, defaultState.endTime),
    warningThresholdMin: clampWarningMinutes(Number(dom.warningThresholdInput.value)),
  };
}

function syncInputsFromState(currentState) {
  isSavingForm = true;
  dom.meetingTitleInput.value = currentState.meetingTitle;
  dom.startTimeInput.value = currentState.startTime;
  dom.endTimeInput.value = currentState.endTime;
  dom.warningThresholdInput.value = String(currentState.warningThresholdMin);
  isSavingForm = false;
}

async function writeState(nextState) {
  const safeState = sanitizeState(nextState);

  if (!timerRef) {
    state = safeState;
    render();
    return;
  }

  await set(timerRef, safeState);
}

function startRenderLoop() {
  render();
  window.setInterval(render, 250);
}

function render() {
  const live = computeLiveState(state);
  const remainingText = live.timeUp ? "TIME'S UP" : formatDuration(live.remainingMs);

  if (mode === "admin") {
    dom.adminLiveTime.textContent = live.timeUp ? "00:00" : formatDuration(live.remainingMs);
    dom.adminStatus.textContent = live.statusLabel;
  }

  if (mode === "tv") {
    dom.tvMeetingTitle.textContent = live.meetingTitle;
    dom.tvScheduleMeta.textContent = `Start ${formatClockLabel(live.startTime)} - End ${formatClockLabel(live.endTime)}`;
    dom.tvStatus.textContent = live.statusLabel;
    dom.tvTimer.textContent = remainingText;
    dom.tvProgress.style.width = `${live.progressPercent.toFixed(1)}%`;
    document.querySelector(".tv-progress-wrap")?.setAttribute("aria-valuenow", String(Math.round(live.progressPercent)));

    document.body.classList.toggle("tv-warning", live.isWarning);
    document.body.classList.toggle("tv-timeup", live.timeUp);
  }
}

function computeLiveState(sourceState) {
  const safe = sanitizeState(sourceState);
  const now = Date.now();
  const schedule = buildScheduleWindow(safe.startTime, safe.endTime, now);

  let remainingMs;
  let statusLabel;
  let timeUp = false;

  if (safe.status === "paused") {
    remainingMs = Math.max(0, Number(safe.pausedRemainingMs ?? schedule.endMs - now));
    statusLabel = "Paused";
  } else if (safe.status === "running") {
    remainingMs = Math.max(0, schedule.endMs - now);

    if (remainingMs === 0) {
      timeUp = true;
      statusLabel = "Time's Up";
    } else if (now < schedule.startMs) {
      statusLabel = "Scheduled";
    } else {
      statusLabel = "In Progress";
    }
  } else {
    remainingMs = Math.max(0, schedule.endMs - now);
    statusLabel = now < schedule.startMs ? "Ready" : "Idle";
  }

  const warningMs = safe.warningThresholdMin * 60000;
  const isWarning =
    !timeUp &&
    safe.status === "running" &&
    remainingMs > 0 &&
    remainingMs <= warningMs;

  const elapsed = Math.max(
    0,
    Math.min(schedule.durationMs, schedule.durationMs - Math.min(remainingMs, schedule.durationMs)),
  );
  const progressPercent = schedule.durationMs > 0 ? (elapsed / schedule.durationMs) * 100 : 0;

  return {
    ...safe,
    ...schedule,
    remainingMs,
    statusLabel,
    isWarning,
    timeUp,
    progressPercent,
  };
}

function sanitizeState(raw) {
  const status = ["idle", "running", "paused"].includes(raw?.status)
    ? raw.status
    : "idle";

  return {
    meetingTitle: sanitizeMeetingTitle(raw?.meetingTitle),
    startTime: sanitizeTime(raw?.startTime, defaultState.startTime),
    endTime: sanitizeTime(raw?.endTime, defaultState.endTime),
    warningThresholdMin: clampWarningMinutes(Number(raw?.warningThresholdMin ?? defaultState.warningThresholdMin)),
    status,
    pausedRemainingMs:
      raw?.pausedRemainingMs == null
        ? null
        : Math.max(0, Number(raw.pausedRemainingMs)),
    updatedAt: Number(raw?.updatedAt ?? Date.now()),
  };
}

function sanitizeMeetingTitle(value) {
  const title = String(value ?? "").trim();
  return title || defaultState.meetingTitle;
}

function sanitizeTime(value, fallback) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return fallback;
  }
  return `${match[1]}:${match[2]}`;
}

function buildScheduleWindow(startTime, endTime, baseMs) {
  const baseDate = new Date(baseMs);
  const startMs = timeToDateMs(baseDate, startTime);
  let endMs = timeToDateMs(baseDate, endTime);

  if (endMs <= startMs) {
    endMs += 24 * 60 * 60 * 1000;
  }

  return {
    startTime,
    endTime,
    startMs,
    endMs,
    durationMs: endMs - startMs,
  };
}

function timeToDateMs(baseDate, hhmm) {
  const [hh, mm] = hhmm.split(":").map((part) => Number(part));
  const next = new Date(baseDate);
  next.setHours(hh, mm, 0, 0);
  return next.getTime();
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

function formatClockLabel(hhmm) {
  return sanitizeTime(hhmm, "00:00");
}

function clampWarningMinutes(value) {
  if (!Number.isFinite(value)) {
    return defaultState.warningThresholdMin;
  }
  return Math.min(120, Math.max(1, Math.round(value)));
}

function setupRemoteControlSupport() {
  document.addEventListener("keydown", (event) => {
    if (mode === "admin") {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        adjustWarningThreshold(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        adjustWarningThreshold(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (state.status === "running") {
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

function adjustWarningThreshold(delta) {
  const current = clampWarningMinutes(Number(dom.warningThresholdInput.value));
  const next = clampWarningMinutes(current + delta);
  dom.warningThresholdInput.value = String(next);
  handleSchedulerInputChange();
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
