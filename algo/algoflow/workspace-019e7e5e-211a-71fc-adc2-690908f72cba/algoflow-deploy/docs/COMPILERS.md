# Installing compilers for AlgoFlow

AlgoFlow runs code with your **local** compilers (not bundled in the app).

## Windows

1. **C++** — Install [MSYS2](https://www.msys2.org/) or MinGW-w64, then:
   ```powershell
   pacman -S mingw-w64-ucrt-x86_64-gcc
   ```
   Add `C:\msys64\ucrt64\bin` to your PATH.

2. **Python** — Install from [python.org](https://www.python.org/downloads/) and check **“Add python.exe to PATH”**.

3. **Java** (optional) — Install JDK 17+ and ensure `javac` is on PATH.

Verify:
```powershell
g++ --version
python --version
```

## macOS

```bash
xcode-select --install
brew install python
```

## Linux

```bash
sudo apt update
sudo apt install -y g++ python3 default-jdk
```

Or run from `algoflow-deploy`:
```bash
./scripts/install-compilers.sh
```

## Firewall (tablet whiteboard sync)

- **Windows:** Run `scripts\setup-firewall.bat` as Administrator (auto-detects active server port).
- **Linux/macOS:** Run `scripts/setup-firewall.sh` (auto-detects active server port, or pass a port).
