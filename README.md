<div align="center">

# ⏱️ timer_youness_gn

### Real-Time Meeting Timer & TV Overlay

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-Open_App-4FC3F7?style=for-the-badge)](https://gounou-younes.github.io/timer_youness_gn/)
[![GitHub Pages](https://img.shields.io/badge/Deployed_on-GitHub_Pages-222222?style=for-the-badge&logo=github&logoColor=white)](https://gounou-younes.github.io/timer_youness_gn/)
[![Firebase](https://img.shields.io/badge/Sync-Firebase_Realtime_DB-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com)
[![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

> A **zero-dependency, PWA-ready meeting timer** with a real-time Firebase-powered **Admin ↔ TV dual-screen architecture**.  
> Control the clock from your phone while the countdown projects live on any screen or TV.

</div>

---

## 🎬 Live Demo

| URL | Mode |
|---|---|
| [https://gounou-younes.github.io/timer_youness_gn/](https://gounou-younes.github.io/timer_youness_gn/) | **Admin** (control panel) |
| [https://gounou-younes.github.io/timer_youness_gn/?mode=tv](https://gounou-younes.github.io/timer_youness_gn/?mode=tv) | **TV** (audience display) |

Open the **Admin** URL on your phone or laptop. Open the **TV** URL on a projector or screen. Changes sync instantly via Firebase.

---

## ✨ Key Features

| Feature | Detail |
|---|---|
| 📡 **Real-Time Multi-Device Sync** | Firebase Realtime Database pushes state changes to all connected clients with sub-second latency |
| 📺 **Dual-Mode Architecture** | `?mode=admin` for the control panel; `?mode=tv` for the full-screen audience display |
| ⏸️ **Full Timer Lifecycle** | Start → Pre-meeting countdown → Running → Pause / Resume → Cancel / Reset |
| ⚠️ **Configurable Warning Alerts** | Overlay flashes on the TV display N minutes before the meeting ends (configurable 1–120 min) |
| 📊 **Live Progress Bar** | Animated progress bar on the TV view tracks elapsed vs planned duration |
| 🔄 **Auto Pre-Meeting Transition** | When start time is in the future, the timer enters a pre-meeting countdown and auto-transitions to running |
| 🔒 **Screen Wake Lock** | TV mode requests a Wake Lock to prevent the display from sleeping during long sessions |
| 📱 **Progressive Web App** | Service Worker caches all assets for offline resilience; fully installable on mobile & desktop |
| 🖥️ **Electron Desktop Build** | Package as a portable Windows `.exe` using Electron for use without a browser |
| ⌨️ **Remote Control Keyboard Shortcuts** | `Enter` → Start/Pause, `ArrowUp/Down` → adjust warning threshold |
| 📴 **Local Fallback Mode** | If Firebase is unreachable, the app seamlessly falls back to local-only state |
| ♿ **Accessible** | `aria-live` regions, `role="progressbar"`, and `aria-valuenow` for screen readers |

---

## 🏗️ Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│    Admin Mode            │  reads  │    TV Mode               │
│  (phone / laptop)        │◄───────►│  (projector / screen)    │
│                          │  writes │                          │
│  • Set meeting title     │         │  • Meeting title & times │
│  • Start / Pause / Reset │         │  • Live countdown timer  │
│  • Configure warning     │         │  • Progress bar          │
│  • Live timer preview    │         │  • Warning overlay       │
└──────────┬───────────────┘         └──────────────────────────┘
           │                                     ▲
           │         Firebase                    │
           └──────►  Realtime DB  ───────────────┘
                    timer_youness_gn/state
```

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5, CSS3, ES Modules (no build step) |
| Real-Time Sync | Firebase Realtime Database v10 (CDN import) |
| Offline / PWA | Service Worker (`sw.js`) + `manifest.json` |
| Desktop | Electron 41 + `electron-builder` (portable `.exe`) |
| Hosting | GitHub Pages (static) |

---

## 🚀 Quickstart

### Option A — Use the Live Demo (no setup)

👉 **[https://gounou-younes.github.io/timer_youness_gn/](https://gounou-younes.github.io/timer_youness_gn/)**

The app uses a shared Firebase project. Works instantly in any modern browser.

---

### Option B — Run Locally with Your Own Firebase

> [!IMPORTANT]
> You need a free [Firebase](https://console.firebase.google.com) project with **Realtime Database** enabled.

**1. Clone the repository**
```bash
git clone https://github.com/Gounou-Younes/timer_youness_gn.git
cd timer_youness_gn
```

**2. Set up Firebase**

Go to [console.firebase.google.com](https://console.firebase.google.com), create a project, enable **Realtime Database** (start in test mode), and copy your config object.

**3. Paste your Firebase config into `script.js`**

Replace the `firebaseConfig` block near the top of [`script.js`](script.js):

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
```

**4. Serve the app**

Because the app uses ES Modules (`type="module"`), it must be served over HTTP — not opened as a raw file.

```bash
# Using Node.js (npx, no install needed)
npx serve .

# Or using Python
python -m http.server 8080
```

Open `http://localhost:5000` (or `8080`) in your browser.

**5. Open both modes**

| Tab | URL |
|---|---|
| Admin | `http://localhost:5000/` |
| TV Display | `http://localhost:5000/?mode=tv` |

---

### Option C — Desktop App (Electron, Windows)

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build a portable Windows .exe
npm run build:portable
# → Output in: dist/
```

---

## ⌨️ Keyboard Shortcuts (Admin Mode)

| Key | Action |
|---|---|
| `Enter` | Toggle Start / Pause |
| `Arrow Up` | Increase warning threshold by 1 min |
| `Arrow Down` | Decrease warning threshold by 1 min |

---

## 📋 Timer Lifecycle

```
  [idle]
    │  Start pressed
    ▼
  [pre_meeting]  ──── start time reached (auto) ──►  [running]
    │                                                     │
    │  Pause                                         Pause│
    ▼                                                     ▼
  [paused] ──────────────── Resume ────────────────► [running]
                                                          │
                                             time up or  │  Cancel / Reset
                                             elapsed      ▼
                                                       [idle]
```

---

## ⚙️ Configuration Reference

All configurable values are set via the **Admin panel UI** and persisted to Firebase:

| Field | Default | Description |
|---|---|---|
| Meeting Title | `Revue mensuelle` | Displayed on the TV screen |
| Start Time | `09:00` | 24-hour format; drives pre-meeting countdown |
| End Time | `10:00` | Hard deadline for the session |
| Warning Threshold | `5 min` | Minutes before end to trigger the TV warning overlay |

---

## 📁 File Structure

```
timer_youness_gn/
├── index.html          # App shell — Admin view + TV view (toggled by URL param)
├── script.js           # All application logic (Firebase, state machine, rendering)
├── style.css           # CSS — mobile-first, dark theme, TV-optimised typography
├── sw.js               # Service Worker — cache-first PWA strategy
├── manifest.json       # PWA manifest — name, icons, display mode
├── icon.svg            # App icon
├── main.js             # Electron main process (desktop build only)
└── package.json        # npm / Electron builder config
```

---

## 🤝 Contributing

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Commit your changes: `git commit -m 'feat: add my feature'`
3. Push and open a Pull Request

> [!NOTE]
> No build step is required. Just edit HTML/CSS/JS and refresh.

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

<div align="center">

Built with ❤️ by [Younes Gounou](https://github.com/Gounou-Younes)

⭐ **Star this repo if it helps you run tighter meetings!**

</div>
