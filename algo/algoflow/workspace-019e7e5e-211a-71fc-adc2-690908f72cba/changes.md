# MVP deployment readiness
_Exported on 5/31/2026 at 22:37:36 GMT+5:30 from Cursor (3.6.21)_

---

**User**

is the mvp ready for deployment

---

**Cursor**

Assessing MVP deployment readiness by exploring the project structure, configuration, and any deployment or readiness documentation.


**No — not as a single deployable MVP.** The repo has solid **module-level** work, but the **integrated product** described in `algoflow-deploy/README.md` and your app idea is not wired up yet.

## What’s in good shape (can run in isolation)

| Module | Status |
|--------|--------|
| **Spaced repetition (SM-2)** | Logic verified — 36/36 checks in `algoflow-srs/tests/sm2-verify.js` |
| **Whiteboard + WebSocket sync** | Server, gateway, canvas client, graph templates exist in `algoflow-whiteboard` |
| **Code sandbox** | Runner, security, Docker path, TLE/MLE/injection tests (once deps are installed) |
| **Browser extension** | LeetCode/Codeforces scraping, inject UI, local cache; security suite passes |
| **Deploy docs/scripts** | Firewall, compiler install, first-run wizard are documented |

## Blockers for “deployment ready”

### 1. No unified backend (critical)

`algoflow-deploy` documents one Electron app that starts **one** server with sandbox + SRS + whiteboard on port **3001**. In the repo:

- `algoflow-deploy` has only Electron + scripts — **no** `server/`, `public/`, `client/`, or `socket/` folders.
- `algoflow-sandbox` is its own app on port **3000**.
- `algoflow-whiteboard` is separate on port **3001**.

`electron/main.js` expects `../server/index.js` in dev — that path **does not exist** under `algoflow-deploy`.

### 2. Desktop build would fail or ship an empty shell

`algoflow-deploy/electron/package.json` bundles `server/**/*`, `public/**/*`, icons, etc., but those assets are missing (including `electron/icons/`). `"main": "electron/main.js"` is also wrong if you run from the `electron/` directory (should be `"main.js"`).

### 3. Sandbox API won’t start as-is

`server/index.js` does `require("../api/execute.post")`, but the only file is `execute.post.ts`. Node won’t load that without a build step or a `.js` implementation.

### 4. SRS is library-only, not a product surface

`algoflow-srs` has schema, scheduler, API routes, and a React `Queue.tsx`, but:

- No `package.json` / server entry
- No database adapter implementation
- Auth is a stub (`x-user-id` header)
- UI is not integrated into any running app

### 5. MVP features from the idea doc are missing or partial

From `uploads/AlgoFlow_App_Idea_and_Pointers.txt`:

| Feature | In repo? |
|---------|----------|
| Pattern-based spaced repetition | **Partial** — engine yes, end-to-end no |
| C++ template manager | **No** |
| Cross-device whiteboard | **Yes** (standalone) |
| Complexity profiler (Big-O) | **No** — sandbox reports time/memory, not Big-O |
| Monaco editor | **No** |
| Extension → AlgoFlow backend | **No** — problems stay in `chrome.storage.local` |

### 6. Extension packaging gaps

`manifest.json` references `icons/icon16.png` etc., but **no icon files** are present. DOM selector tests exist but need `npm install` in `algoflow-extension` (and `algoflow-sandbox` / `algoflow-whiteboard` for their tests).

---

## Practical verdict

- **Deploy as documented (Electron installer + one backend + extension + tablet sync):** **Not ready** — integration and packaging are incomplete.
- **Deploy individual pieces for dev/demo:**
  - Whiteboard: `cd algoflow-whiteboard && npm install && npm start` → `http://localhost:3001`
  - Sandbox: fix TS/JS route issue, `npm install`, then `npm start` → port 3000
  - Extension: load unpacked in Chrome (after adding icons)
  - SRS: run verification script only; no hosted API yet

**Rough readiness:** ~**40–50%** toward the full MVP vision; **~15%** toward the unified deployment path in `algoflow-deploy/README.md`.

## Minimum path to “deployable MVP”

1. **Merge** sandbox + whiteboard + SRS routes into one `server/index.js` (port 3001).
2. **Add** a minimal `public/` UI (whiteboard + review queue + run code), or wire existing UIs.
3. **Fix** `execute` route (compile TS or add `.js`), copy bundles into `algoflow-deploy` for `electron-builder`.
4. **Wire** extension export → `POST http://127.0.0.1:3001/api/...` and SQLite (or similar) for SRS.
5. **Add** icons, root `package.json`, CI that runs all test suites after `npm install`.

If you want, I can turn that into a ordered implementation plan or start with step 1 (unified server skeleton).

---

**User**

yes pls do so

---

**Cursor**

Implementing the unified deployment path: exploring key modules, then building the integrated server, fixes, and wiring.


Implementing the unified deployment stack: creating the integrated server, SQLite layer, public UI, and extension wiring.


The unified MVP deployment path is in place. Here’s what was built and how to use it.

## What’s new

**Unified backend** at `algoflow-deploy/` (port **3001**):

- **Sandbox** — `POST /api/execute`
- **Spaced repetition** — `GET/PUT /api/review/*` with **SQLite** (`data/algoflow.db`)
- **Extension import** — `POST /api/problems/import`
- **Whiteboard** — `/whiteboard.html` + Socket.io
- **Dashboard** — `/` (review queue, ratings, code runner, problem list)

**Other fixes**

- `algoflow-sandbox/api/execute.post.js` — Node can load the execute route
- Extension syncs to `http://127.0.0.1:3001` on scrape and via **Sync to AlgoFlow** in the popup
- Placeholder extension icons generated on `npm install`
- Electron starts the backend with `fork()` + `ELECTRON_RUN_AS_NODE` for packaged builds

## Run it

```bash
cd algoflow-deploy
npm install
npm start
```

Then open **http://127.0.0.1:3001**

**Extension:** `chrome://extensions` → Load unpacked → `algoflow-extension/`

**Optional desktop shell:** `npm run electron`

## Verify (already tested)

- `GET /health` — OK  
- `POST /api/problems/import` — imports “Two Sum”  
- `GET /api/review/due` — shows the imported problem in the queue  

## Still post-MVP

C++ template vault, Big-O profiler, Monaco editor, real multi-user auth, and signed installers — see `algoflow-deploy/MVP.md`.

The server is running in the background on port 3001 from this session; you can use the dashboard and load the extension against it now.

---

**User**

@c:\Users\ayush\.cursor\projects\c-Users-ayush-projects-helloworld-algo-algoflow-workspace-019e7e5e-211a-71fc-adc2-690908f72cba\terminals\5.txt:32-75 

---

**Cursor**

`better-sqlite3` was built for Node 22 (ABI 127) but you're on Node 24 (ABI 137). Replacing it with Node's built-in `node:sqlite` to avoid native module version mismatches.


The crash came from **`better-sqlite3`**: its native binary was built for Node 22 (ABI 127), while you're on **Node 24** (ABI 137).

**Fix:** SQLite now uses Node’s built-in **`node:sqlite`** module, so there’s no native addon to rebuild when you change Node versions.

### What you should do

```powershell
cd algoflow-deploy
npm install
npm start
```

If port 3001 is still in use from an old run, stop that process first (or close the other terminal), then run `npm start` again.

You may see a one-time warning: `SQLite is an experimental feature` — that’s normal on Node 22+ and the server still runs.

**Requirement:** Node **≥ 22.5** (you’re on 24, so you’re fine). The existing `data/algoflow.db` file is still used as-is.

---

**User**

<system_notification>
The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.

<task>
kind: shell
status: error
task_id: 206834
title: Reinstall deps and verify server starts on Node 24
detail: exit_code=1
output_path: C:\Users\ayush\.cursor\projects\c-Users-ayush-projects-helloworld-algo-algoflow-workspace-019e7e5e-211a-71fc-adc2-690908f72cba\terminals\206834.txt
</task>
</system_notification>
<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed). If there's no follow-ups needed, don't explicitly say that.</user_query>

---

**Cursor**

The verification run **partially succeeded**:

- **`npm install` completed** — `better-sqlite3` was removed; dependencies are updated.
- **SQLite fix works** — the DB opened with built-in `node:sqlite` (no more ABI mismatch).
- **Server start failed** only because **port 3001 was already in use** (`EADDRINUSE`) from an earlier AlgoFlow instance.

Stop the process on port 3001 (or close the other terminal), then run `npm start` again — it should come up cleanly. You can also use http://127.0.0.1:3001 if that older instance is still running.

---

**User**

so now what are hurdles in deployment

---

**Cursor**

Reviewing the current deployment state after the recent integration work.


Here’s an updated picture after the unified server and SQLite fix.

## What’s no longer a blocker

- Split backends (sandbox vs whiteboard on different ports)
- Missing `server/` / APIs for Electron
- `better-sqlite3` ABI mismatch on Node 24 (now uses `node:sqlite`)
- Extension → backend wiring (import + sync exists)

**Local “run on your machine” deployment** is basically: `cd algoflow-deploy && npm install && npm start`, load the extension, open http://127.0.0.1:3001.

---

## Remaining hurdles (by category)

### 1. Desktop installer (Electron) — not fully proven

| Issue | Why it matters |
|--------|----------------|
| **Packaged build untested** | `npm run build:win` hasn’t been validated end-to-end; `extraResources` + `fork()` + `ELECTRON_RUN_AS_NODE` may break paths or module resolution in the `.exe`. |
| **Electron 28 vs Node 24** | Dev uses system Node 24; packaged app embeds older Chromium/Node — `node:sqlite` must work inside the forked child (likely OK on Electron 28’s Node, but needs a real build test). |
| **No code signing / notarization** | Windows SmartScreen and macOS Gatekeeper will warn or block unsigned apps. |
| **Placeholder icons** | 1×1 PNGs work for dev; not acceptable for store-quality branding. |
| **Install guide URL** | `main.js` still points at `https://algoflow.dev/docs/install-compilers` (doesn’t exist). |

### 2. Environment & sandbox (especially Windows)

| Issue | Why it matters |
|--------|----------------|
| **Compilers on PATH** | Users need `g++`, `python3`, optional `javac` installed locally; not bundled. |
| **`ulimit` on Windows** | Memory/time limits are weak or skipped; sandbox is less isolated than on Linux. |
| **Node ≥ 22.5** | Required for `node:sqlite`; documented in `engines`, but no friendly check in `npm start` for older Node. |
| **Port 3001 conflicts** | No auto-pick or clear “already running” UX (you hit `EADDRINUSE`). |

### 3. Browser extension distribution

| Issue | Why it matters |
|--------|----------------|
| **Unpacked only** | Chrome Web Store listing, review, privacy policy, and host permissions (`127.0.0.1`) need a proper submission story. |
| **LeetCode/Codeforces DOM drift** | Selector tests need `npm install` in `algoflow-extension`; scrapers can break when sites change. |
| **Backend must be running** | Sync fails silently if AlgoFlow isn’t up; no install-time pairing flow. |

### 4. Security & “real” production

| Issue | Why it matters |
|--------|----------------|
| **No real auth** | Single hardcoded user (`x-user-id: 1`); API is open on LAN if firewall allows 3001. |
| **HTTP only** | Fine for localhost; not for exposing on a network without TLS. |
| **Code execution risk** | Local sandbox runs user code with host compilers — acceptable for personal use, risky if exposed publicly. |

### 5. Product gaps vs original vision (not deployment blockers, but “MVP incomplete”)

- C++ template manager  
- Big-O complexity profiler  
- Monaco editor  
- Full React review UI (only a simple HTML dashboard today)  
- CI pipeline running all module tests on every push  

### 6. Ops / polish

- No automated release pipeline (build → sign → publish)  
- `first-run-setup.sh` is Unix-oriented; Windows path is mostly manual (`setup-firewall.bat`)  
- Leftover `better-sqlite3` folders in `node_modules` may need a clean delete if `EPERM` warnings persist  

---

## Practical readiness tiers

| Tier | Status |
|------|--------|
| **Personal local use** (you + extension + tablet on LAN) | **Ready** after `npm start` and firewall/port setup |
| **Share with friends** (zip + instructions) | **Mostly ready** — document Node version, compilers, extension load steps |
| **Installer (.exe / .dmg)** | **Hurdles remain** — build, test packaged app, signing, icons |
| **Chrome Web Store + public backend** | **Not ready** — auth, HTTPS, store listing, hardened sandbox |

**Bottom line:** deployment for **local/desktop MVP** is largely unblocked; hurdles are now **packaging/signing**, **Windows sandbox hardening**, **extension store distribution**, and **anything beyond single-user localhost**.

---

**User**

fix all that u can fix and list what all are left

---

**Cursor**

Fixing deployment hurdles we can address in code: reviewing key files, then implementing fixes.


Fixed everything that can be solved in code/docs/CI. Summary:

## Fixed

| Area | Change |
|------|--------|
| **Port conflicts** | Tries 3001→3010; logs chosen port; writes `data/server-port.txt` |
| **Node version** | `npm start` runs `scripts/preflight.js` first (requires Node ≥ 22.5) |
| **Windows Python** | Sandbox uses `python` on Windows |
| **Windows compilers** | Electron + preflight check `g++` / `python` correctly |
| **Compiler guide** | Opens `docs/COMPILERS.md` instead of dead URL |
| **Electron packaging** | `NODE_PATH`, `cwd`, reads port from server log / port file |
| **LAN security** | Optional `ALGOFLOW_API_KEY` + `x-api-key` on `/api/*` |
| **Extension** | Health ping, red `!` badge on sync fail, auto-updates URL if port changes |
| **Windows setup** | `scripts/first-run-setup.bat` |
| **CI** | `.github/workflows/algoflow-ci.yml` |
| **Docs** | `DEPLOYMENT_REMAINING.md`, updated `MVP.md` |

Verified: preflight passes; server starts on **3002** when 3001 is busy.

---

## Still left (needs you / external steps)

**Distribution & signing**
- Run and validate `npm run build:win` on your machine
- Code signing (Windows SmartScreen / macOS notarization)
- Real app icons (replace placeholders)
- Chrome Web Store account, listing, privacy policy, review

**User environment**
- Users install **g++** and **Python** locally (`docs/COMPILERS.md`)
- Firewall for tablet sync (`setup-firewall.bat` as Admin)

**Product gaps (not deployment bugs)**
- C++ template manager, Big-O profiler, Monaco editor
- Full React review UI
- Multi-user accounts (still single user; API key is LAN-only)
- HTTPS / public cloud hosting
- LeetCode/Codeforces DOM changes breaking the extension

**Platform limits**
- Weaker sandbox isolation on Windows vs Linux
- `node:sqlite` experimental warning on Node 22+
- Packaged Electron app must be tested after `build:win` (embedded Node vs your system Node)

Full checklist: `algoflow-deploy/DEPLOYMENT_REMAINING.md`

**To run now:** stop any old server on 3001, then `cd algoflow-deploy && npm start`.

---

**User**

<system_notification>
The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.

<task>
kind: shell
status: aborted
task_id: 929574
title: Run preflight and test server start
output_path: C:\Users\ayush\.cursor\projects\c-Users-ayush-projects-helloworld-algo-algoflow-workspace-019e7e5e-211a-71fc-adc2-690908f72cba\terminals\929574.txt
</task>
</system_notification>
<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed). If there's no follow-ups needed, don't explicitly say that.</user_query>

---

**Cursor**

The verification run **succeeded** before it was stopped in the background.

- **Preflight:** passed on Node v22.22.0  
- **Server:** started cleanly; port **3001 was busy**, so it bound to **3002** and logged `Listening on http://127.0.0.1:3002`  
- **SQLite / Windows:** experimental SQLite warning is expected; sandbox correctly reports Windows timeout-based limits (no `ulimit`)

Use **http://127.0.0.1:3002** if 3001 is still taken by an older instance, or stop that process and restart with `npm start` to get 3001 again.

---

## 2026-06-02 — Deployment hardening changes

- Expanded root `.gitignore` to cover nested `node_modules`, build artifacts, logs, env files, and editor/OS junk.
- Added a root `README.md` so onboarding and launch steps are discoverable from repository root.
- Added extension packaging workflow:
  - `algoflow-extension/scripts/package-extension.js`
  - `npm run pack` in `algoflow-extension/package.json`
  - outputs zip files under `algoflow-extension/dist/` for store upload prep.
- Added extension popup settings for:
  - backend URL
  - optional API key
  - sync enable/disable toggle
  - save action + backend status hint
- Added missing `"alarms"` permission in extension manifest for badge-sync alarm usage.
- Improved dynamic-port deployment behavior:
  - `algoflow-deploy/scripts/run-tests.js` now reads `ALGOFLOW_PORT` or `data/server-port.txt` for health checks.
  - `algoflow-deploy/scripts/setup-firewall.sh` now auto-detects port from `data/server-port.txt` (or accepts explicit port arg).
  - `algoflow-deploy/scripts/setup-firewall.bat` now auto-detects port from `data/server-port.txt` (or accepts explicit port arg).
- Updated docs for correctness:
  - fixed extension folder reference in deploy README (`algoflow-extension/`)
  - updated deploy README node requirement to `22.5+`
  - documented firewall scripts’ dynamic port behavior
  - updated extension README URL detection strategy count and added packaging instructions
  - updated compiler docs to reflect firewall script behavior.
