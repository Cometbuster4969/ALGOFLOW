/**
 * ============================================================================
 * AlgoFlow — Secure SandboxRunner
 * ============================================================================
 *
 * Core sandbox class for executing competitive-programming submissions
 * (C++, Python, Java) inside an isolated child process.
 *
 * Security layers:
 *   1. `ulimit` via shell wrapper  → hard memory + CPU caps
 *   2. Non-privileged `sandbox` UID → no root escalation
 *   3. Temporary work-dir per run   → wiped with fs-extra after completion
 *   4. Strict input sanitisation    → code & stdin written to temp files,
 *                                     never interpolated into shell strings
 *
 * Returns: { status, time, memory, output }
 * ============================================================================
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

// ─── Language profiles ───────────────────────────────────────────────────────

function resolvePythonCommand() {
  if (process.platform !== "win32") return "python3";
  const { spawnSync } = require("child_process");
  if (
    spawnSync("python", ["--version"], {
      encoding: "utf8",
      timeout: 3000,
      shell: true,
    }).status === 0
  ) {
    return "python";
  }
  return "python3";
}

const PYTHON_CMD = resolvePythonCommand();

const LANG_PROFILES = {
  cpp: {
    sourceFile: "main.cpp",
    compile: (dir) => [
      "g++",
      [
        "-O2",
        "-std=c++17",
        "-o",
        path.join(dir, "main"),
        path.join(dir, "main.cpp"),
      ],
    ],
    run: (dir) => [path.join(dir, "main"), []],
    extension: ".cpp",
  },
  python: {
    sourceFile: "main.py",
    compile: null, // interpreted
    run: (dir) => [PYTHON_CMD, [path.join(dir, "main.py")]],
    extension: ".py",
  },
  java: {
    sourceFile: "Main.java",
    compile: (dir) => [
      "javac",
      [path.join(dir, "Main.java"), "-d", dir],
    ],
    run: (dir) => ["java", ["-cp", dir, "Main"]],
    extension: ".java",
  },
};

// ─── Verdict constants ───────────────────────────────────────────────────────

const Verdict = Object.freeze({
  AC: "AC",   // Accepted
  TLE: "TLE", // Time Limit Exceeded
  MLE: "MLE", // Memory Limit Exceeded
  RE: "RE",   // Runtime Error
  CE: "CE",   // Compile Error
});

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_MEMORY_LIMIT_KB = 256 * 1024; // 256 MB in KB
const DEFAULT_TIME_LIMIT_MS = 2000;         // 2 seconds
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;  // 16 MB stdout cap

/**
 * Virtual memory overhead per language runtime.
 * ulimit -v caps TOTAL virtual memory (binary + libs + heap + stack).
 * These buffers account for the runtime's own footprint so the user's
 * code gets the advertised amount of usable memory.
 */
const RUNTIME_OVERHEAD_KB = {
  cpp: 20 * 1024,    // libc + libstdc++ + linker ≈ 20 MB
  python: 15 * 1024, // CPython interpreter ≈ 15 MB
  java: 80 * 1024,   // JVM base footprint ≈ 80 MB
};

// ─── SandboxRunner ───────────────────────────────────────────────────────────

class SandboxRunner {
  /**
   * @param {Object} opts
   * @param {string} opts.language        - "cpp" | "python" | "java"
   * @param {string} opts.sourceCode      - full source code text
   * @param {string} opts.stdinData       - test-case input
   * @param {string} [opts.expectedOutput]- expected answer (for diffing)
   * @param {number} [opts.memoryLimitKB] - default 262144 (256 MB)
   * @param {number} [opts.timeLimitMs]   - default 2000 (2 s)
   * @param {string} [opts.runAsUser]     - non-privileged user (default "nobody")
   */
  constructor(opts = {}) {
    this.language = opts.language;
    this.sourceCode = opts.sourceCode;
    this.stdinData = opts.stdinData ?? "";
    this.expectedOutput = opts.expectedOutput ?? null;
    this.memoryLimitKB = opts.memoryLimitKB ?? DEFAULT_MEMORY_LIMIT_KB;
    this.timeLimitMs = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
    this.runAsUser = opts.runAsUser ?? "nobody";
    this.workDir = path.join(
      os.tmpdir(),
      "algoflow_sandbox",
      uuidv4()
    );
  }

  // ── Public entry point ──────────────────────────────────────────────────

  async execute() {
    const startTime = Date.now();

    try {
      // 1. Prepare isolated work directory
      await fs.ensureDir(this.workDir);
      await fs.chmod(this.workDir, 0o777);

      // 2. Write source + stdin to files (never pass via shell args)
      await this._writeSourceFiles();

      // 3. Compile (if needed)
      const compileResult = await this._compile();
      if (compileResult) return compileResult;

      // 4. Run in sandboxed child process
      const result = await this._run();

      result.time = Date.now() - startTime;
      return result;
    } catch (err) {
      return {
        status: Verdict.RE,
        time: Date.now() - startTime,
        memory: 0,
        output: `Sandbox error: ${err.message}`,
      };
    } finally {
      // 5. Always wipe temp directory
      await this._cleanup();
    }
  }

  // ── Private: write source & stdin ───────────────────────────────────────

  async _writeSourceFiles() {
    const profile = LANG_PROFILES[this.language];
    if (!profile) throw new Error(`Unsupported language: ${this.language}`);

    // Sanitise: reject null bytes in source
    if (this.sourceCode.includes("\0")) {
      throw new Error("Source code contains null bytes");
    }

    await fs.writeFile(
      path.join(this.workDir, profile.sourceFile),
      this.sourceCode,
      { mode: 0o644 }
    );

    await fs.writeFile(
      path.join(this.workDir, "input.txt"),
      this.stdinData,
      { mode: 0o644 }
    );
  }

  // ── Private: compile step ───────────────────────────────────────────────

  async _compile() {
    const profile = LANG_PROFILES[this.language];
    if (!profile.compile) return null; // e.g. Python

    const [cmd, args] = profile.compile(this.workDir);

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: this.workDir,
        timeout: 30_000, // 30 s compile timeout
        uid: this._resolveUid(),
        env: this._sanitisedEnv(),
        detached: true, // allow process-group kill for runaway compilers
      });

      const killCompileTree = () => {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch { try { child.kill("SIGKILL"); } catch {} }
      };

      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += d.toString();
        if (stderr.length > MAX_OUTPUT_BYTES) killCompileTree();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          resolve({
            status: Verdict.CE,
            time: 0,
            memory: 0,
            output: stderr.slice(0, 4096),
          });
        } else {
          resolve(null); // success → proceed to run
        }
      });

      child.on("error", (err) => {
        resolve({
          status: Verdict.CE,
          time: 0,
          memory: 0,
          output: `Compile spawn error: ${err.message}`,
        });
      });
    });
  }

  // ── Private: run step (with ulimit enforcement) ─────────────────────────

  _run() {
    const profile = LANG_PROFILES[this.language];
    const [cmd, args] = profile.run(this.workDir);

    return new Promise((resolve) => {
      // Build a ulimit-wrapped shell command for memory & CPU enforcement.
      //
      // ulimit -v  → max virtual memory (KB)
      // ulimit -t  → max CPU seconds
      //
      // The actual program command is never interpolated with raw user input;
      // stdin is piped from a file descriptor instead.

      // Add per-language runtime overhead so user code gets full memory budget
      const overhead = RUNTIME_OVERHEAD_KB[this.language] || 0;
      const ulimitMemoryKB = this.memoryLimitKB + overhead;

      const ulimitCmd = [
        `ulimit -v ${ulimitMemoryKB}`,
        `ulimit -t ${Math.ceil(this.timeLimitMs / 1000)}`,
        // Use exec to replace shell with the child (no lingering wrapper)
        `exec ${this._shellEscape(cmd)} ${args.map(this._shellEscape).join(" ")}`,
      ].join(" && ");

      const child = spawn("sh", ["-c", ulimitCmd], {
        cwd: this.workDir,
        stdio: ["pipe", "pipe", "pipe"],
        uid: this._resolveUid(),
        env: this._sanitisedEnv(),
        // Detach into a new process group so we can kill the entire tree
        detached: true,
      });

      const killTree = () => {
        try {
          // Kill the entire process group (negative PID = kill group)
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Fallback: kill just the child
          try { child.kill("SIGKILL"); } catch {}
        }
      };

      // Sample peak memory while the process is still alive (before close fires)
      let peakMemoryKB = 0;
      const memSampler = setInterval(() => {
        try {
          const mem = this._readVmHWM(child.pid);
          if (mem > peakMemoryKB) peakMemoryKB = mem;
        } catch {
          // Process may have exited between checks
        }
      }, 50); // sample every 50ms

      // Pipe stdin from file (avoids shell interpolation of user data)
      const inputPath = path.join(this.workDir, "input.txt");
      const inputStream = fs.createReadStream(inputPath);
      inputStream.pipe(child.stdin);
      inputStream.on("error", () => killTree());

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => {
        stdout += d.toString();
        if (stdout.length > MAX_OUTPUT_BYTES) {
          killTree();
        }
      });

      child.stderr.on("data", (d) => {
        stderr += d.toString();
        if (stderr.length > MAX_OUTPUT_BYTES) {
          killTree();
        }
      });

      // Hard wall-clock timeout as a safety net (2× the CPU limit)
      const wallTimeout = setTimeout(() => {
        killTree();
      }, this.timeLimitMs * 2 + 500);

      child.on("close", (code, signal) => {
        clearTimeout(wallTimeout);
        clearInterval(memSampler);

        // Use the peak sampled while alive, or try one last read
        const memKB = peakMemoryKB || this._measurePeakMemory(child.pid);

        // Determine verdict
        let status = Verdict.AC;

        if (signal === "SIGKILL" || code === 137) {
          // SIGKILL → either TLE or MLE; heuristics:
          if (memKB > this.memoryLimitKB * 0.9) {
            status = Verdict.MLE;
          } else {
            status = Verdict.TLE;
          }
        } else if (signal === "SIGXCPU" || code === 152) {
          status = Verdict.TLE;
        } else if (code !== 0) {
          status = Verdict.RE;
        }

        // Optional: check against expected output
        if (status === Verdict.AC && this.expectedOutput !== null) {
          const actual = stdout.trim();
          const expected = this.expectedOutput.trim();
          if (actual !== expected) {
            status = Verdict.RE; // Wrong answer → treat as RE for simplicity
            stdout = `Expected:\n${expected}\n\nGot:\n${actual}`;
          }
        }

        resolve({
          status,
          time: 0, // caller overwrites
          memory: memKB,
          output: (status === Verdict.RE ? stderr || stdout : stdout).slice(
            0,
            MAX_OUTPUT_BYTES
          ),
        });
      });

      child.on("error", (err) => {
        clearTimeout(wallTimeout);
        resolve({
          status: Verdict.RE,
          time: 0,
          memory: 0,
          output: `Execution spawn error: ${err.message}`,
        });
      });
    });
  }

  // ── Private: measure peak RSS ───────────────────────────────────────────

  /**
   * Read VmHWM (peak RSS) from /proc/<pid>/status.
   * Returns 0 if /proc is unavailable (macOS, Windows, or process exited).
   */
  _readVmHWM(pid) {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const match = status.match(/VmHWM:\s+(\d+)\s+kB/);
    if (match) return parseInt(match[1], 10);
    const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return rssMatch ? parseInt(rssMatch[1], 10) : 0;
  }

  /**
   * Last-resort memory read (process may already be dead).
   */
  _measurePeakMemory(pid) {
    try {
      return this._readVmHWM(pid);
    } catch {
      return 0;
    }
  }

  // ── Private: cleanup temp dir ───────────────────────────────────────────

  async _cleanup() {
    try {
      await fs.remove(this.workDir);
    } catch {
      // Best-effort: directory may already be gone
    }
  }

  // ── Private: resolve non-privileged UID ─────────────────────────────────

  _resolveUid() {
    // On Linux the "nobody" user typically has UID 65534.
    // If the process is running as root we can drop privileges.
    if (process.getuid && process.getuid() === 0) {
      try {
        // Dynamic import of the OS module for uid lookup is overkill;
        // just use the well-known nobody UID.
        return 65534;
      } catch {
        return undefined; // fallback: inherit current UID
      }
    }
    return undefined; // not root → can't change uid, skip
  }

  // ── Private: minimal environment ────────────────────────────────────────

  _sanitisedEnv() {
    return {
      PATH: "/usr/bin:/bin",
      HOME: this.workDir,
      LANG: "en_US.UTF-8",
      TMPDIR: this.workDir,
    };
  }

  // ── Private: shell-safe quoting ─────────────────────────────────────────

  /**
   * Wraps a string in single quotes, escaping embedded single quotes.
   * Used ONLY for program paths that we ourselves generate (never raw user input).
   */
  _shellEscape(str) {
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }
}

module.exports = { SandboxRunner, Verdict, LANG_PROFILES };
