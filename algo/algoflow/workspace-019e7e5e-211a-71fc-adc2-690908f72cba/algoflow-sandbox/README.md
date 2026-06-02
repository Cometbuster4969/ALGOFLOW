# AlgoFlow — Secure Execution Sandbox

A hardened Node.js sandbox for running competitive-programming submissions (C++, Python, Java) with strict resource enforcement.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    POST /api/execute                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Rate     │→ │ Validate │→ │  Scan    │→ │  Clamp Limits    │ │
│  │  Limiter  │  │  Body    │  │Injection │  │  mem/time        │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
│                                                     ↓            │
│              ┌───────────────────────────────────────────────┐  │
│              │            SandboxRunner.execute()             │  │
│              │  ┌─────────┐  ┌──────────┐  ┌──────────────┐  │  │
│              │  │ Write    │→ │ Compile   │→ │  spawn("sh") │  │  │
│              │  │ source + │  │ (g++/javac)│  │  ulimit -v   │  │  │
│              │  │ stdin to │  │           │  │  ulimit -t   │  │  │
│              │  │ tmpfile  │  └──────────┘  │  uid=nobody   │  │  │
│              │  └─────────┘                 └──────────────┘  │  │
│              │                                     ↓           │  │
│              │  ┌──────────────────────────────────────────┐  │  │
│              │  │  Parse /proc/<pid>/status → peak memory  │  │  │
│              │  │  Detect: AC | TLE | MLE | RE | CE        │  │  │
│              │  └──────────────────────────────────────────┘  │  │
│              │                     ↓                           │  │
│              │  fs-extra.remove(workDir)  ← ALWAYS runs       │  │
│              └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Security Layers

| Layer | Mechanism | Prevents |
|-------|-----------|----------|
| **1. Input validation** | express-validator | Malformed requests, oversized payloads |
| **2. Injection scanning** | Regex pattern matching | Shell injection, process spawning, file access |
| **3. Rate limiting** | express-rate-limit (30/min) | DoS, resource exhaustion |
| **4. Resource limits** | `ulimit -v` (memory) + `ulimit -t` (CPU) | MLE, TLE |
| **5. Non-root execution** | `uid=65534` (nobody) | Privilege escalation |
| **6. Sanitised env** | Minimal PATH, no secrets | Environment leakage |
| **7. Temp file cleanup** | `fs-extra.remove()` in `finally` block | Disk exhaustion, data leakage |
| **8. Docker isolation** | `--cap-drop=ALL --network=none` | Network exfiltration, kernel exploits |

## Quick Start

```bash
# Install dependencies
npm install

# Run verification tests
npm test

# Start server
npm start
```

## API

### `POST /api/execute`

```json
{
  "language": "cpp",
  "source_code": "#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n+1;}",
  "test_cases": [
    { "input": "5", "expected_output": "6" },
    { "input": "0", "expected_output": "1" }
  ],
  "memory_limit_kb": 262144,
  "time_limit_ms": 2000
}
```

**Response:**

```json
{
  "overall_status": "AC",
  "results": [
    { "status": "AC", "time": 87, "memory": 3200, "output": "6" },
    { "status": "AC", "time": 45, "memory": 3100, "output": "1" }
  ],
  "summary": {
    "total": 2,
    "passed": 2,
    "total_time_ms": 132,
    "peak_memory_kb": 3200
  }
}
```

### Verdicts

| Status | Meaning |
|--------|---------|
| `AC`   | Accepted — output matches expected |
| `TLE`  | Time Limit Exceeded — CPU time > limit |
| `MLE`  | Memory Limit Exceeded — RSS > limit |
| `RE`   | Runtime Error — non-zero exit / wrong output |
| `CE`   | Compile Error — g++/javac failed |

## Docker Deployment

```bash
# Build
docker build -t algoflow-sandbox .

# Run with full hardening
docker run --rm -p 3000:3000 \
  --memory=512m \
  --cpus=2 \
  --network=none \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  algoflow-sandbox
```

## Test Suite

| Test | Verifies |
|------|----------|
| `test-mle.js` | 10⁷ array allocation triggers MLE at 16 MB limit |
| `test-tle.js` | `while(true)` returns TLE after 2 seconds |
| `test-injection.js` | 15 malicious payloads (rm -rf, exec, etc.) are blocked |
| `test-batch.js` | 10 test cases execute with < 100ms average overhead |
