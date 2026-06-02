# Deployment — fixed vs still remaining

## Fixed in this pass

| Item | Fix |
|------|-----|
| Port 3001 conflicts | Auto-picks 3001–3010; logs actual port; writes `data/server-port.txt` |
| Node version errors | `scripts/preflight.js` before `npm start` |
| `better-sqlite3` ABI | Built-in `node:sqlite` (Node ≥ 22.5) |
| Broken compiler URL | Opens local `docs/COMPILERS.md` |
| Windows Python | Sandbox uses `python` on Windows, `python3` elsewhere |
| Windows compilers check | Electron + preflight detect `python` / `g++` on Windows |
| Electron packaged paths | `NODE_PATH`, `cwd`, parses port from server log |
| Optional LAN API key | Set `ALGOFLOW_API_KEY` → require `x-api-key` on `/api/*` |
| Extension offline UX | Red badge `!` on sync fail; popup pings `/health` |
| Extension port drift | Updates `backendUrl` if server moved to another port |
| Windows first-run | `scripts/first-run-setup.bat` |
| CI | `.github/workflows/algoflow-ci.yml` |
| ulimit on Windows | Clear log: timeouts used instead of ulimit |

## Still remaining (cannot fully automate here)

### Requires your machine / store accounts

| Item | What you need to do |
|------|---------------------|
| **Code signing** | Windows Authenticode + Apple notarization certificates (~$100+/yr) |
| **Chrome Web Store** | Developer account, listing, privacy policy, review (1–3 days) |
| **Production icons** | Replace placeholder PNGs with designed assets |
| **`npm run build:win` validation** | Run locally; fix any electron-builder issues on your OS |
| **Compilers on user PCs** | Users install g++/Python (documented in `docs/COMPILERS.md`) |

### Product scope

| Item | Status |
|------|--------|
| C++ template manager | **Built** — `/api/templates`, Templates tab, seeded defaults |
| Big-O complexity profiler | **Built** — `POST /api/analyze/complexity` (static + empirical) |
| Monaco editor | **Built** — Sandbox tab (CDN) |
| Review UI | **Built** — Queue, forecast, guided rating flow (vanilla JS, not React) |
| Multi-user | **Built** — Profiles in header (local SQLite users, not login/password) |
| HTTPS / public cloud host | Not built — localhost / LAN only |
| LeetCode/CF DOM changes | Extra selector fallbacks added; may still need updates |
| Tag-based decay (pattern SRS) | Not built — tags stored but no tag-level scheduling |

### Platform limits

| Item | Notes |
|------|--------|
| Windows sandbox isolation | Weaker than Linux (`ulimit` unavailable); rely on timeouts |
| `node:sqlite` experimental flag | Harmless warning on Node 22+; monitor Node release notes |
| Electron vs system Node | Packaged app uses Electron’s embedded Node for the forked server — test after `build:win` |

### Optional hardening (future)

- Auto-update channel (electron-updater + signed releases)
- Installer that bundles MSYS2 / Python (large download)
- PostgreSQL instead of SQLite for multi-device sync
- Operational Transformation for whiteboard (currently last-write-wins style gateway)
