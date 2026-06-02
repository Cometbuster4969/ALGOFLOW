# AlgoFlow — Deployment Guide

Complete guide to packaging, installing, and configuring AlgoFlow on your machine.

## Quick Start (unified backend)

```bash
cd algoflow-deploy
npm install
npm start
# → http://127.0.0.1:3001  (dashboard, sandbox, review queue, whiteboard)

# Load extension: chrome://extensions → Load unpacked → ../algoflow-extension
# Optional desktop shell:
npm run electron
```

Legacy per-module servers (`algoflow-sandbox` on :3000, `algoflow-whiteboard` on :3001) are superseded by the unified server above.

### First-time setup (compilers + firewall)

```bash
chmod +x scripts/first-run-setup.sh
./scripts/first-run-setup.sh
```

### Desktop installer build

```bash
npm run build:win   # or build:mac / build:linux
```

---

## 1. Desktop App Packaging

### What Happens

```
┌─────────────────────────────────────────────────────────┐
│  AlgoFlow.exe / AlgoFlow.app / AlgoFlow.AppImage        │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Electron Main Process                            │  │
│  │  ├─ Starts Express + Socket.io backend on launch  │  │
│  │  ├─ Opens BrowserWindow → http://127.0.0.1:3001   │  │
│  │  ├─ Validates compiler PATH on startup            │  │
│  │  └─ System tray + graceful shutdown               │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Bundled Backend (server/)                        │  │
│  │  ├─ SandboxRunner (g++/python3/javac execution)   │  │
│  │  ├─ Socket.io Gateway (whiteboard sync)           │  │
│  │  ├─ SchedulerService (spaced repetition)          │  │
│  │  └─ Express API (review endpoints)                │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Bundled Frontend (public/)                       │  │
│  │  ├─ Whiteboard canvas                             │  │
│  │  ├─ Review queue                                  │  │
│  │  └─ Dashboard                                     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Build Steps

```bash
cd electron/

# Install dependencies
npm install

# Build for your platform
npm run build:win     # → dist/AlgoFlow Setup.exe + AlgoFlow.exe
npm run build:mac     # → dist/AlgoFlow.dmg
npm run build:linux   # → dist/AlgoFlow.AppImage + .deb
```

### What the Build Produces

| Platform | Output | Size (approx) |
|----------|--------|---------------|
| Windows  | `AlgoFlow Setup.exe` (installer) + `AlgoFlow.exe` (portable) | ~120 MB |
| macOS    | `AlgoFlow.dmg` | ~130 MB |
| Linux    | `AlgoFlow.AppImage` + `.deb` | ~110 MB |

### First Launch Behavior

1. **Compiler check** — detects g++, python3, javac in PATH
2. **Missing compilers** — shows dialog with install options
3. **Backend starts** — splash screen while Express boots
4. **Main window opens** — loads `http://127.0.0.1:3001`
5. **System tray** — app stays running when window is closed

---

## 2. Compiler Installation

The sandbox needs compilers installed **on the host OS** (not inside Docker/Electron).

### Automatic (Recommended)

```bash
./scripts/install-compilers.sh
```

This detects your OS and installs via the native package manager.

### Manual

#### Windows
1. **g++**: Install [MSYS2](https://www.msys2.org), then `pacman -S mingw-w64-x86_64-gcc`
2. Add `C:\msys64\mingw64\bin` to System PATH
3. **Python**: Download from [python.org](https://python.org), check "Add to PATH"
4. **Java**: Download from [adoptium.net](https://adoptium.net)

#### macOS
```bash
xcode-select --install        # g++
brew install python3           # python3
brew install openjdk           # javac
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt install build-essential python3 default-jdk
```

### Verify Installation

```bash
g++ --version     # Should print version
python3 --version # Should print version
javac -version    # Should print version
```

---

## 3. Browser Extension Deployment

### Install (Developer Mode — Free, No Store Required)

```bash
# Run the helper script
./scripts/install-extension.sh
```

Or manually:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The AlgoFlow icon appears in your toolbar

### How It Works

```
LeetCode / Codeforces Problem Page
  ┌─────────────────────────────────────────────┐
  │  [Submit]  [Export to AlgoFlow] ← injected  │
  │                                             │
  │  Problem: Two Sum                           │
  │  Difficulty: Easy                           │
  │  Input: nums = [2,7,11,15], target = 9      │
  │  Output: [0,1]                              │
  └─────────────────────────────────────────────┘
          ↓ click Export
  chrome.storage.local ← cached locally
          ↓
  AlgoFlow Desktop App ← reads from storage
```

### Permissions (Minimal)

| Permission | Why |
|-----------|-----|
| `activeTab` | Access current tab only when clicked |
| `storage` | Cache scraped problems locally |
| `scripting` | Inject content scripts on demand |

### Updating the Extension

After pulling new code:
1. Go to `chrome://extensions`
2. Click the refresh icon (↻) on the AlgoFlow card

---

## 4. Local Network Syncing (Laptop ↔ Tablet)

### Architecture

```
┌──────────┐     WebSocket (ws://192.168.1.100:3001)     ┌──────────┐
│  Laptop  │◄──────────────────────────────────────────►│  Tablet  │
│ (server) │     Whiteboard sync, cursor positions       │ (client) │
│          │     Review queue sync                       │          │
│  g++ ✓   │                                             │  Browser │
│  python3 ✓│                                            │  or App  │
└──────────┘                                             └──────────┘
     │
     │ Same Wi-Fi network
     │ (192.168.1.x)
     │
  ┌──┴──┐
  │Router│
  └─────┘
```

### Step 1: Find Your Laptop's Local IP

```bash
# Linux/Mac
ip addr show | grep "inet " | grep -v 127.0.0.1
# or
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig | findstr "IPv4"
```

Example output: `192.168.1.100`

### Step 2: Configure Firewall

```bash
# Linux (ufw)
sudo ufw allow 3001/tcp

# Linux (firewalld)
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload

# macOS — the app firewall prompt will appear on first launch

# Windows — run as Administrator
scripts/setup-firewall.bat
```

Or use the automated script:
```bash
sudo ./scripts/setup-firewall.sh
```

### Step 3: Set Static IP (Recommended)

Without a static IP, your router may assign a different address after a reboot.

**Option A: Router DHCP Reservation (Easiest)**
1. Open your router admin page (usually `192.168.1.1` or `192.168.0.1`)
2. Find DHCP settings → Address Reservation
3. Add your laptop's MAC address with a fixed IP (e.g., `192.168.1.100`)

**Option B: Static IP on Laptop**

Linux (NetworkManager):
```bash
nmcli con mod "Wi-Fi" ipv4.addresses 192.168.1.100/24
nmcli con mod "Wi-Fi" ipv4.gateway 192.168.1.1
nmcli con mod "Wi-Fi" ipv4.dns "1.1.1.1,8.8.8.8"
nmcli con mod "Wi-Fi" ipv4.method manual
nmcli con up "Wi-Fi"
```

Windows:
```
Settings → Network → Wi-Fi → Properties → IP Settings → Manual
  IP:      192.168.1.100
  Gateway: 192.168.1.1
  DNS:     1.1.1.1
```

### Step 4: Configure Tablet

In the AlgoFlow tablet app (or browser), set the sync server URL:

```
ws://192.168.1.100:3001
```

If mDNS works on your network, you can use:
```
ws://algoflow.local:3001
```

### Step 5: Verify Connection

```bash
# From the tablet (or another machine on the same network):
curl http://192.168.1.100:3001/health
# Should return: {"status":"ok",...}
```

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Connection refused | Firewall blocking port | Run `setup-firewall.sh` |
| Connection timeout | Wrong IP or different network | Verify both devices on same Wi-Fi |
| Intermittent drops | Router DHCP lease renewal | Set static IP |
| Works locally but not from tablet | Firewall or NAT | Check `sudo ufw status` |
| `ERR_CONNECTION_REFUSED` | Server not running | Launch AlgoFlow desktop app |

---

## 5. Complete Deployment Checklist

```
┌─────────────────────────────────────────────────────────────────┐
│                    AlgoFlow Deployment Checklist                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  □  Node.js 18+ installed                                      │
│  □  g++ installed and in PATH                                   │
│  □  python3 installed and in PATH                               │
│  □  javac installed (optional)                                  │
│  □  Desktop app built (npm run build)                           │
│  □  Desktop app launched — backend starts automatically         │
│  □  Browser extension loaded via chrome://extensions            │
│  □  Firewall port 3001 opened                                   │
│  □  Laptop IP identified (e.g., 192.168.1.100)                  │
│  □  Static IP configured in router (recommended)                │
│  □  Tablet configured with ws://IP:3001                         │
│  □  Tablet can reach http://IP:3001/health                      │
│  □  Whiteboard syncs between devices                            │
│  □  LeetCode "Export to AlgoFlow" button appears                │
│  □  Code execution sandbox runs C++/Python/Java                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
algoflow-deploy/
├── electron/
│   ├── main.js              ← Electron main process (auto-starts backend)
│   ├── preload.js           ← Secure IPC bridge
│   ├── splash.html          ← Loading screen
│   ├── package.json         ← Build config (electron-builder)
│   └── icons/               ← App icons (.ico, .icns, .png)
├── scripts/
│   ├── first-run-setup.sh   ← One-command setup wizard
│   ├── install-compilers.sh ← OS-specific compiler installer
│   ├── setup-firewall.sh    ← Linux/Mac firewall config
│   ├── setup-firewall.bat   ← Windows firewall config
│   └── install-extension.sh ← Chrome extension loader helper
├── config/
│   └── sync-config.json     ← Network sync configuration
└── README.md                ← This file
```
