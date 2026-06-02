# AlgoFlow MVP — Deployment Status

## Quick start

```bash
cd algoflow-deploy
npm install
npm start
```

Open http://127.0.0.1:3001 (or the port printed if 3001 was busy).

**Windows first-time:** `scripts\first-run-setup.bat`  
**Compilers:** `docs/COMPILERS.md`  
**LAN API key (optional):** `set ALGOFLOW_API_KEY=your-secret` then pass `x-api-key` from the extension settings.

## Integrated services

| Service | URL |
|---------|-----|
| Dashboard (tabs) | `/` — Review, Sandbox, Templates, Problems |
| Whiteboard | `/whiteboard.html` |
| Health | `/health` |
| Execute | `POST /api/execute` |
| Complexity profiler | `POST /api/analyze/complexity` |
| Review | `/api/review/*` |
| Templates | `/api/templates` |
| Users / profiles | `/api/users` |
| Import | `POST /api/problems/import` |

## Extension

Load `algoflow-extension/` unpacked in Chrome. Scrapes sync to the backend when it is running.

## Electron

```bash
npm run electron        # dev
npm run build:win       # installer (validate locally)
```

See `DEPLOYMENT_REMAINING.md` for what is still outstanding.
