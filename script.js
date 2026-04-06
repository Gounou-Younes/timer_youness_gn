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
  meetingTitle: "Revue mensuelle",
  startTime: "09:00",
  endTime: "10:00",
  warningThresholdMin: 5,
  status: "idle",
  isPaused: false,
  pausedPhase: null,
  pausedRemainingMs: null,
  targetStartAt: null,
  targetEndAt: null,
  plannedDurationMs: null,
  initialRunMs: null,
  sessionId: null,
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
  adminLeadMessage: document.getElementById("adminLeadMessage"),
  adminLiveTime: document.getElementById("adminLiveTime"),
  adminStatus: document.getElementById("adminStatus"),
  tvMeetingTitle: document.getElementById("tvMeetingTitle"),
  tvScheduleMeta: document.getElementById("tvScheduleMeta"),
  tvStatus: document.getElementById("tvStatus"),
  tvTimer: document.getElementById("tvTimer"),
  tvProgress: document.getElementById("tvProgress"),
  tvHint: document.getElementById("tvHint"),
  tvWarningOverlay: document.getElementById("tvWarningOverlay"),
  tvWarningText: document.getElementById("tvWarningText"),
};

let state = { ...defaultState };
let timerRef = null;
let tvScale = 1;
let isSavingForm = false;
let warningOverlayTimeoutId = null;
let lastWarningSessionKey = "";
let autoTransitionInFlight = false;

init();

async function init() {
  setupMode();
  registerServiceWorker();
  setupRemoteControlSupport();
  bindAdminActions();
  applyInitialUiState();

  const hasPlaceholders = Object.values(firebaseConfig).some((value) =>
    String(value).startsWith("PASTE_"),
  );

  if (hasPlaceholders) {
    renderCredentialWarning();
    startRenderLoop();
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    const database = resolveRealtimeDatabase(app);
    timerRef = ref(database, timerPath);
    subscribeToTimerState();
  } catch {
    timerRef = null;
    if (mode === "admin" && dom.adminStatus) {
      dom.adminStatus.textContent =
        "Base temps réel indisponible. Mode local activé.";
    }
  }

  if (mode === "tv") {
    await requestWakeLock();
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  startRenderLoop();
}

function applyInitialUiState() {
  if (mode === "admin" && dom.adminStatus) {
    dom.adminStatus.textContent = "En attente...";
  }
}

function resolveRealtimeDatabase(app) {
  if (firebaseConfig.databaseURL) {
    return getDatabase(app, firebaseConfig.databaseURL);
  }

  if (firebaseConfig.projectId) {
    const inferredUrl = `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com`;
    return getDatabase(app, inferredUrl);
  }

  return getDatabase(app);
}

function setupMode() {
  if (dom.modeLabel) {
    dom.modeLabel.textContent =
      mode === "tv" ? "Mode TV" : "Mode administrateur";
  }

  dom.adminView?.classList.toggle("hidden", mode !== "admin");
  dom.tvView?.classList.toggle("hidden", mode !== "tv");
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

  if (!dom.startBtn || !dom.pauseBtn || !dom.resetBtn) {
    return;
  }

  dom.startBtn.addEventListener("click", handleStart);
  dom.pauseBtn.addEventListener("click", handlePause);
  dom.resetBtn.addEventListener("click", handleReset);

  dom.meetingTitleInput?.addEventListener("input", handleSchedulerInputChange);
  dom.startTimeInput?.addEventListener("change", handleSchedulerInputChange);
  dom.endTimeInput?.addEventListener("change", handleSchedulerInputChange);
  dom.warningThresholdInput?.addEventListener(
    "change",
    handleSchedulerInputChange,
  );
}

async function handleSchedulerInputChange() {
  if (isSavingForm) {
    return;
  }

  const formState = readSchedulerInputs();

  const nextState = {
    ...state,
    meetingTitle: formState.meetingTitle,
    warningThresholdMin: formState.warningThresholdMin,
    updatedAt: Date.now(),
  };

  if (state.status === "idle") {
    nextState.startTime = formState.startTime;
    nextState.endTime = formState.endTime;
  }

  await writeState(nextState);
}

async function handleStart() {
  const formState = readSchedulerInputs();
  const now = Date.now();
  const schedule = buildScheduleWindow(formState.startTime, formState.endTime, now);

  const resuming = state.status === "paused" || state.isPaused;
  let status;
  let pausedPhase = null;
  let targetStartAt = null;
  let targetEndAt;
  let plannedDurationMs;
  let initialRunMs;
  let sessionId;

  if (resuming && Number.isFinite(state.pausedRemainingMs)) {
    const pausedRemaining = Math.max(0, Number(state.pausedRemainingMs));
    const resumePhase = state.pausedPhase === "pre_meeting" ? "pre_meeting" : "running";

    if (resumePhase === "pre_meeting") {
      status = "pre_meeting";
      pausedPhase = null;
      targetStartAt = now + pausedRemaining;
      plannedDurationMs =
        Number.isFinite(state.plannedDurationMs) && state.plannedDurationMs > 0
          ? state.plannedDurationMs
          : schedule.hasValidSchedule
            ? schedule.durationMs
            : 60 * 60 * 1000;
      targetEndAt = targetStartAt + plannedDurationMs;
      initialRunMs =
        Number.isFinite(state.initialRunMs) && state.initialRunMs > 0
          ? state.initialRunMs
          : Math.max(plannedDurationMs, 60000);
    } else {
      status = "running";
      pausedPhase = null;
      targetEndAt = now + pausedRemaining;
      plannedDurationMs =
        Number.isFinite(state.plannedDurationMs) && state.plannedDurationMs > 0
          ? state.plannedDurationMs
          : Math.max(pausedRemaining, 60000);
      initialRunMs =
        Number.isFinite(state.initialRunMs) && state.initialRunMs > 0
          ? state.initialRunMs
          : Math.max(plannedDurationMs, 60000);
    }

    sessionId = state.sessionId || String(now);
  } else {
    plannedDurationMs = schedule.hasValidSchedule
      ? Math.max(schedule.durationMs, 60000)
      : 60 * 60 * 1000;

    if (schedule.hasValidSchedule && now < schedule.startMs) {
      status = "pre_meeting";
      targetStartAt = schedule.startMs;
      targetEndAt = schedule.startMs + plannedDurationMs;
      initialRunMs = plannedDurationMs;
    } else {
      status = "running";
      targetStartAt = null;
      targetEndAt = schedule.hasValidSchedule ? schedule.endMs : now + plannedDurationMs;
      initialRunMs = plannedDurationMs;
    }

    sessionId = String(now);
    lastWarningSessionKey = "";
  }

  await writeState({
    ...state,
    ...formState,
    status,
    isPaused: false,
    pausedPhase,
    pausedRemainingMs: null,
    targetStartAt,
    targetEndAt,
    plannedDurationMs,
    initialRunMs,
    sessionId,
    updatedAt: now,
  });
}

async function handlePause() {
  if (state.status !== "running" && state.status !== "pre_meeting") {
    return;
  }

  const live = computeLiveState(state);
  const formState = readSchedulerInputs();

  const pausedPhase = state.status === "pre_meeting" ? "pre_meeting" : "running";
  const pausedRemainingMs =
    pausedPhase === "pre_meeting"
      ? live.remainingToStartMs
      : live.remainingMs;

  await writeState({
    ...state,
    meetingTitle: formState.meetingTitle,
    warningThresholdMin: formState.warningThresholdMin,
    status: "paused",
    isPaused: true,
    pausedPhase,
    pausedRemainingMs,
    targetEndAt: null,
    updatedAt: Date.now(),
  });
}

async function handleReset() {
  if (mode === "admin") {
    if (dom.meetingTitleInput) {
      dom.meetingTitleInput.value = "";
    }
    if (dom.startTimeInput) {
      dom.startTimeInput.value = "";
    }
    if (dom.endTimeInput) {
      dom.endTimeInput.value = "";
    }
    if (dom.warningThresholdInput) {
      dom.warningThresholdInput.value = "";
    }
  }

  hideWarningOverlay(true);
  lastWarningSessionKey = "";

  await writeState({
    meetingTitle: "",
    startTime: "",
    endTime: "",
    warningThresholdMin: null,
    status: "idle",
    isPaused: false,
    pausedPhase: null,
    pausedRemainingMs: null,
    targetStartAt: null,
    targetEndAt: null,
    plannedDurationMs: null,
    initialRunMs: null,
    sessionId: null,
    updatedAt: Date.now(),
  });
}

function readSchedulerInputs() {
  return {
    meetingTitle: sanitizeMeetingTitle(
      readInputValue(dom.meetingTitleInput, defaultState.meetingTitle),
      defaultState.meetingTitle,
      false,
    ),
    startTime: sanitizeTime(
      readInputValue(dom.startTimeInput, defaultState.startTime),
      defaultState.startTime,
      false,
    ),
    endTime: sanitizeTime(
      readInputValue(dom.endTimeInput, defaultState.endTime),
      defaultState.endTime,
      false,
    ),
    warningThresholdMin: sanitizeWarningThreshold(
      readInputValue(
        dom.warningThresholdInput,
        String(defaultState.warningThresholdMin),
      ),
      false,
    ),
  };
}

function readInputValue(input, fallback) {
  if (!input || typeof input.value !== "string") {
    return fallback;
  }

  const value = input.value.trim();
  return value === "" ? fallback : value;
}

function syncInputsFromState(currentState) {
  isSavingForm = true;

  if (dom.meetingTitleInput) {
    dom.meetingTitleInput.value = currentState.meetingTitle;
  }
  if (dom.startTimeInput) {
    dom.startTimeInput.value = currentState.startTime;
  }
  if (dom.endTimeInput) {
    dom.endTimeInput.value = currentState.endTime;
  }
  if (dom.warningThresholdInput) {
    dom.warningThresholdInput.value =
      currentState.warningThresholdMin == null
        ? ""
        : String(currentState.warningThresholdMin);
  }

  isSavingForm = false;
}

async function writeState(nextState) {
  const safeState = sanitizeState(nextState);

  if (!timerRef) {
    state = safeState;
    render();
    return;
  }

  try {
    await set(timerRef, safeState);
  } catch {
    state = safeState;
    render();
  }
}

function startRenderLoop() {
  render();
  window.setInterval(render, 250);
}

function render() {
  maybeAutoTransitionFromPreMeeting();

  const live = computeLiveState(state);
  const timerText = live.timeUp ? "TEMPS ÉCOULÉ" : formatDuration(live.remainingMs);

  if (mode === "admin" && dom.adminLiveTime && dom.adminStatus) {
    if (dom.adminLeadMessage) {
      dom.adminLeadMessage.textContent =
        live.status === "pre_meeting"
          ? "La réunion commence dans :"
          : "Temps restant :";
    }

    dom.adminLiveTime.textContent =
      live.timeUp || live.status === "idle" ? "00:00" : formatDuration(live.remainingMs);
    dom.adminStatus.textContent = live.statusLabel;
  }

  if (
    mode === "tv" &&
    dom.tvMeetingTitle &&
    dom.tvScheduleMeta &&
    dom.tvStatus &&
    dom.tvTimer &&
    dom.tvProgress
  ) {
    dom.tvMeetingTitle.textContent = live.meetingTitleDisplay;
    dom.tvScheduleMeta.textContent = `Début ${live.startLabel} - Fin ${live.endLabel}`;
    dom.tvStatus.textContent =
      live.status === "pre_meeting"
        ? "La réunion commence dans :"
        : live.statusLabel;
    dom.tvTimer.textContent = timerText;
    dom.tvProgress.style.width = `${live.progressPercent.toFixed(1)}%`;
    document
      .querySelector(".tv-progress-wrap")
      ?.setAttribute("aria-valuenow", String(Math.round(live.progressPercent)));

    document.body.classList.toggle("tv-warning", live.isWarning);
    document.body.classList.toggle("tv-timeup", live.timeUp);
    document.body.classList.toggle("tv-premeeting", live.status === "pre_meeting");

    maybeShowWarningOverlay(live);
  }
}

function maybeAutoTransitionFromPreMeeting() {
  if (autoTransitionInFlight) {
    return;
  }

  if (state.status !== "pre_meeting" || state.isPaused) {
    return;
  }

  if (!Number.isFinite(state.targetStartAt) || Date.now() < state.targetStartAt) {
    return;
  }

  autoTransitionInFlight = true;

  const now = Date.now();
  const plannedDurationMs =
    Number.isFinite(state.plannedDurationMs) && state.plannedDurationMs > 0
      ? state.plannedDurationMs
      : 60 * 60 * 1000;

  const nextState = {
    ...state,
    status: "running",
    isPaused: false,
    pausedPhase: null,
    pausedRemainingMs: null,
    targetStartAt: null,
    targetEndAt: Number.isFinite(state.targetEndAt)
      ? Math.max(Number(state.targetEndAt), now)
      : now + plannedDurationMs,
    plannedDurationMs,
    initialRunMs:
      Number.isFinite(state.initialRunMs) && state.initialRunMs > 0
        ? state.initialRunMs
        : plannedDurationMs,
    updatedAt: now,
  };

  writeState(nextState)
    .finally(() => {
      autoTransitionInFlight = false;
    });
}

function maybeShowWarningOverlay(live) {
  if (mode !== "tv" || !dom.tvWarningOverlay || !dom.tvWarningText) {
    return;
  }

  if (live.isWarning && live.sessionId) {
    const key = `${live.sessionId}|${live.warningThresholdMin}`;
    if (lastWarningSessionKey !== key) {
      lastWarningSessionKey = key;
      showWarningOverlay(live.warningThresholdMin);
    }
    return;
  }

  if (live.status !== "running") {
    lastWarningSessionKey = "";
    hideWarningOverlay(true);
  }
}

function showWarningOverlay(minutes) {
  if (!dom.tvWarningOverlay || !dom.tvWarningText) {
    return;
  }

  if (warningOverlayTimeoutId) {
    clearTimeout(warningOverlayTimeoutId);
    warningOverlayTimeoutId = null;
  }

  dom.tvWarningText.textContent =
    `⚠️ Attention : Il ne reste que ${minutes} minutes pour conclure la réunion !`;
  dom.tvWarningOverlay.classList.add("is-visible");

  warningOverlayTimeoutId = window.setTimeout(() => {
    hideWarningOverlay(false);
  }, 10000);
}

function hideWarningOverlay(immediate) {
  if (!dom.tvWarningOverlay) {
    return;
  }

  if (immediate && warningOverlayTimeoutId) {
    clearTimeout(warningOverlayTimeoutId);
    warningOverlayTimeoutId = null;
  }

  dom.tvWarningOverlay.classList.remove("is-visible");
}

function computeLiveState(sourceState) {
  const safe = sanitizeState(sourceState);
  const now = Date.now();

  const startForCalc = safe.startTime || defaultState.startTime;
  const endForCalc = safe.endTime || defaultState.endTime;
  const schedule = buildScheduleWindow(startForCalc, endForCalc, now);

  let remainingMs = 0;
  let remainingToStartMs = 0;
  let statusLabel = "En attente...";
  let timeUp = false;

  if (safe.status === "paused" || safe.isPaused) {
    const pausedPhase = safe.pausedPhase === "pre_meeting" ? "pre_meeting" : "running";
    remainingMs = Math.max(0, Number(safe.pausedRemainingMs ?? deriveRunningRemaining(safe, schedule, now)));
    remainingToStartMs = pausedPhase === "pre_meeting" ? remainingMs : 0;
    statusLabel = "EN PAUSE";
  } else if (safe.status === "pre_meeting") {
    remainingToStartMs = Math.max(
      0,
      Number(
        Number.isFinite(safe.targetStartAt)
          ? safe.targetStartAt - now
          : schedule.hasValidSchedule
            ? schedule.startMs - now
            : 0,
      ),
    );
    remainingMs = remainingToStartMs;
    statusLabel = "La réunion commence dans :";
  } else if (safe.status === "running") {
    remainingMs = Math.max(0, deriveRunningRemaining(safe, schedule, now));

    if (remainingMs <= 0) {
      remainingMs = 0;
      timeUp = true;
      statusLabel = "TEMPS ÉCOULÉ";
    } else {
      statusLabel = "EN COURS";
    }
  }

  const warningThresholdMin =
    safe.warningThresholdMin == null
      ? defaultState.warningThresholdMin
      : safe.warningThresholdMin;

  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const isWarning =
    safe.status === "running" &&
    !safe.isPaused &&
    !timeUp &&
    remainingMinutes <= warningThresholdMin;

  const baselineMs =
    Number.isFinite(safe.initialRunMs) && safe.initialRunMs > 0
      ? safe.initialRunMs
      : schedule.hasValidSchedule
        ? Math.max(60000, schedule.durationMs)
        : Math.max(60000, remainingMs || 60000);

  const progressPercent =
    safe.status === "idle"
      ? 0
      : safe.status === "pre_meeting"
        ? 0
      : clampPercent(((baselineMs - remainingMs) / baselineMs) * 100);

  return {
    ...safe,
    ...schedule,
    remainingMs,
    remainingToStartMs,
    remainingMinutes,
    statusLabel,
    timeUp,
    isWarning,
    progressPercent,
    warningThresholdMin,
    meetingTitleDisplay: safe.meetingTitle || "Aucune réunion",
    startLabel: safe.startTime || "--:--",
    endLabel: safe.endTime || "--:--",
  };
}

function deriveRunningRemaining(safe, schedule, now) {
  if (Number.isFinite(safe.targetEndAt)) {
    return safe.targetEndAt - now;
  }

  if (schedule.hasValidSchedule) {
    return schedule.endMs - now;
  }

  return 0;
}

function sanitizeState(raw) {
  const status = ["idle", "pre_meeting", "running", "paused"].includes(raw?.status)
    ? raw.status
    : "idle";

  return {
    meetingTitle: sanitizeMeetingTitle(
      raw?.meetingTitle,
      defaultState.meetingTitle,
      true,
    ),
    startTime: sanitizeTime(raw?.startTime, defaultState.startTime, true),
    endTime: sanitizeTime(raw?.endTime, defaultState.endTime, true),
    warningThresholdMin: sanitizeWarningThreshold(raw?.warningThresholdMin, true),
    status,
    isPaused: Boolean(raw?.isPaused ?? status === "paused"),
    pausedPhase: ["pre_meeting", "running"].includes(raw?.pausedPhase)
      ? raw.pausedPhase
      : null,
    pausedRemainingMs:
      raw?.pausedRemainingMs == null
        ? null
        : Math.max(0, Number(raw.pausedRemainingMs)),
    targetStartAt:
      raw?.targetStartAt == null || !Number.isFinite(Number(raw.targetStartAt))
        ? null
        : Number(raw.targetStartAt),
    targetEndAt:
      raw?.targetEndAt == null || !Number.isFinite(Number(raw.targetEndAt))
        ? null
        : Number(raw.targetEndAt),
    plannedDurationMs:
      raw?.plannedDurationMs == null || !Number.isFinite(Number(raw.plannedDurationMs))
        ? null
        : Math.max(0, Number(raw.plannedDurationMs)),
    initialRunMs:
      raw?.initialRunMs == null || !Number.isFinite(Number(raw.initialRunMs))
        ? null
        : Math.max(0, Number(raw.initialRunMs)),
    sessionId: raw?.sessionId ? String(raw.sessionId) : null,
    updatedAt: Number(raw?.updatedAt ?? Date.now()),
  };
}

function sanitizeMeetingTitle(value, fallback, allowEmpty) {
  const title = String(value ?? "").trim();
  if (!title) {
    return allowEmpty ? "" : fallback;
  }
  return title.slice(0, 100);
}

function sanitizeTime(value, fallback, allowEmpty) {
  const raw = String(value ?? "").trim();

  if (raw === "") {
    return allowEmpty ? "" : fallback;
  }

  return isValidTime(raw) ? raw : fallback;
}

function sanitizeWarningThreshold(value, allowEmpty) {
  if (value == null || String(value).trim() === "") {
    return allowEmpty ? null : defaultState.warningThresholdMin;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return allowEmpty ? null : defaultState.warningThresholdMin;
  }

  return clampWarningMinutes(parsed);
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value));
}

function buildScheduleWindow(startTime, endTime, baseMs) {
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return {
      hasValidSchedule: false,
      startTime,
      endTime,
      startDate: null,
      endDate: null,
      startMs: null,
      endMs: null,
      durationMs: 0,
    };
  }

  const startDate = parseTimeToTodayDate(startTime, baseMs);
  const endDate = parseTimeToTodayDate(endTime, baseMs);

  if (endDate.getTime() <= startDate.getTime()) {
    endDate.setDate(endDate.getDate() + 1);
  }

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  return {
    hasValidSchedule: true,
    startTime,
    endTime,
    startDate,
    endDate,
    startMs,
    endMs,
    durationMs: endMs - startMs,
  };
}

function parseTimeToTodayDate(hhmm, baseMs) {
  const [hh, mm] = hhmm.split(":").map((part) => Number(part));
  const baseDate = new Date(baseMs);
  const next = new Date(baseDate);
  next.setHours(hh, mm, 0, 0);
  return next;
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

function clampWarningMinutes(value) {
  if (!Number.isFinite(value)) {
    return defaultState.warningThresholdMin;
  }

  return Math.min(120, Math.max(1, Math.round(value)));
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
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
  const current = clampWarningMinutes(
    Number(
      readInputValue(
        dom.warningThresholdInput,
        String(defaultState.warningThresholdMin),
      ),
    ),
  );
  const next = clampWarningMinutes(current + delta);
  if (dom.warningThresholdInput) {
    dom.warningThresholdInput.value = String(next);
  }
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
      // Ignorer les erreurs de service worker selon l'environnement.
    });
  }
}

function renderCredentialWarning() {
  const warning = "Configuration Firebase manquante : renseignez script.js";
  if (mode === "admin" && dom.adminStatus) {
    dom.adminStatus.textContent = warning;
  } else if (dom.tvHint) {
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
    // Le wake lock peut être bloqué par le navigateur.
  }
}

async function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    await requestWakeLock();
  }
}
