/**
 * ============================================================================
 * AlgoFlow — Security Middleware
 * ============================================================================
 *
 * Express-compatible middleware that enforces CPU / memory limits and
 * validates incoming execution requests before they reach the SandboxRunner.
 *
 * Layers:
 *   1. Source-code sanitisation  → reject null bytes, oversized payloads
 *   2. Shell-injection detection → block suspicious patterns in source
 *   3. Rate limiting             → simple in-memory sliding-window
 *   4. Resource-limit clamping   → ensure limits stay within safe bounds
 * ============================================================================
 */

const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  MAX_SOURCE_BYTES: 256 * 1024,       // 256 KB source limit
  MAX_INPUT_BYTES: 10 * 1024 * 1024,  // 10 MB stdin limit
  MAX_MEMORY_KB: 512 * 1024,          // 512 MB absolute cap
  MIN_MEMORY_KB: 16 * 1024,           // 16 MB floor
  MAX_TIME_MS: 10_000,                // 10 s hard ceiling
  MIN_TIME_MS: 500,                   // 500 ms floor
  ALLOWED_LANGUAGES: ["cpp", "python", "java"],
};

// ─── Shell-injection patterns ────────────────────────────────────────────────

// These regexes detect common shell-escape / code-injection attempts that
// should never appear in legitimate competitive-programming source.

const INJECTION_PATTERNS = [
  // Fork-bombs & shell escapes inside source strings
  /;\s*rm\s+-rf/i,
  /\|\s*rm\s+-rf/i,
  /\bexec\s*\(/i,              // child_process.exec calls
  /\bchild_process\b/i,        // direct require
  /\bfork\s*\(/i,
  /\bspawnSync?\s*\(/i,        // trying to spawn from within user code
  /\bsystem\s*\(/,             // C system() call
  /\bpopen\s*\(/,              // C popen()
  /\b__import__\s*\(/,         // Python dynamic import
  /\bimportlib\b/,             // Python importlib abuse
  /\bos\.(system|popen|exec)/, // Python os module execution
  /\bsubprocess\b/,            // Python subprocess
  /\bruntime\.exec\b/i,        // Java Runtime.exec
  /\bProcessBuilder\b/i,      // Java ProcessBuilder
  /`[^`]*`/,                   // backtick command substitution
  /\$\([^)]*\)/,               // $(...) command substitution
  /\/proc\/self\//i,           // /proc/self access
  /\/etc\/passwd/i,            // sensitive file access
  /\.\.\//,                    // directory traversal
];

// ─── Express-Validator rules ─────────────────────────────────────────────────

const validateExecutionRequest = [
  body("source_code")
    .isString()
    .notEmpty()
    .withMessage("source_code is required")
    .isLength({ max: CONFIG.MAX_SOURCE_BYTES })
    .withMessage(`source_code exceeds ${CONFIG.MAX_SOURCE_BYTES} bytes`)
    .custom((val) => {
      if (val.includes("\0")) {
        throw new Error("source_code contains null bytes");
      }
      return true;
    }),

  body("language")
    .isString()
    .isIn(CONFIG.ALLOWED_LANGUAGES)
    .withMessage(`language must be one of: ${CONFIG.ALLOWED_LANGUAGES.join(", ")}`),

  body("test_cases")
    .isArray({ min: 1, max: 50 })
    .withMessage("test_cases must be a non-empty array (max 50)"),

  body("test_cases.*.input")
    .isString()
    .isLength({ max: CONFIG.MAX_INPUT_BYTES })
    .withMessage("Each test input exceeds size limit"),

  body("test_cases.*.expected_output")
    .optional()
    .isString()
    .isLength({ max: CONFIG.MAX_INPUT_BYTES }),

  body("memory_limit_kb")
    .optional()
    .isInt({ min: CONFIG.MIN_MEMORY_KB, max: CONFIG.MAX_MEMORY_KB })
    .withMessage(
      `memory_limit_kb must be between ${CONFIG.MIN_MEMORY_KB} and ${CONFIG.MAX_MEMORY_KB}`
    ),

  body("time_limit_ms")
    .optional()
    .isInt({ min: CONFIG.MIN_TIME_MS, max: CONFIG.MAX_TIME_MS })
    .withMessage(
      `time_limit_ms must be between ${CONFIG.MIN_TIME_MS} and ${CONFIG.MAX_TIME_MS}`
    ),
];

// ─── Validation-result handler ───────────────────────────────────────────────

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: errors.array().map((e) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
}

// ─── Source-code injection scanner ───────────────────────────────────────────

function scanForInjection(req, res, next) {
  const { source_code } = req.body;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(source_code)) {
      // Log for audit trail
      console.warn(
        `[SECURITY] Injection pattern detected: ${pattern} | ` +
        `IP: ${req.ip} | Lang: ${req.body.language}`
      );

      return res.status(403).json({
        error: "SECURITY_VIOLATION",
        message: "Source code contains disallowed patterns. If this is a false positive, please review your code.",
        pattern_hint: pattern.toString(),
      });
    }
  }

  next();
}

// ─── Resource-limit clamping ─────────────────────────────────────────────────

function clampResourceLimits(req, res, next) {
  // Ensure memory and time limits are within safe bounds, regardless of
  // what the client sent (or omitted).

  if (!req.body.memory_limit_kb) {
    req.body.memory_limit_kb = 256 * 1024; // default 256 MB
  } else {
    req.body.memory_limit_kb = Math.min(
      Math.max(req.body.memory_limit_kb, CONFIG.MIN_MEMORY_KB),
      CONFIG.MAX_MEMORY_KB
    );
  }

  if (!req.body.time_limit_ms) {
    req.body.time_limit_ms = 2000; // default 2 s
  } else {
    req.body.time_limit_ms = Math.min(
      Math.max(req.body.time_limit_ms, CONFIG.MIN_TIME_MS),
      CONFIG.MAX_TIME_MS
    );
  }

  next();
}

// ─── Rate limiter ────────────────────────────────────────────────────────────

const executionRateLimiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute
  max: 30,                // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "RATE_LIMIT_EXCEEDED",
    message: "Too many execution requests. Please wait before retrying.",
  },
});

// ─── Sandbox health check (ulimit verification) ─────────────────────────────

function verifySandboxLimits() {
  /**
   * Spawns a trivial child process under ulimit to confirm the OS
   * respects our constraints. Returns true if everything works.
   * Windows has no ulimit — runner still enforces wall-clock timeouts.
   */
  if (process.platform === "win32") {
    return false;
  }

  const testMemoryKB = 64 * 1024; // 64 MB
  const testCpuSec = 1;

  try {
    const result = spawnSync(
      "sh",
      [
        "-c",
        `ulimit -v ${testMemoryKB} && ulimit -t ${testCpuSec} && echo "sandbox_ok"`,
      ],
      {
        timeout: 5000,
        encoding: "utf8",
      }
    );

    return result.stdout && result.stdout.trim() === "sandbox_ok";
  } catch {
    return false;
  }
}

// ─── Non-root check ─────────────────────────────────────────────────────────

function assertNonRoot(req, res, next) {
  if (process.getuid && process.getuid() === 0) {
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      console.error("[SECURITY] Blocking request — server running as root in production.");
      return res.status(500).json({
        error: "SERVER_MISCONFIGURATION",
        message: "Execution server must not run as root in production.",
      });
    }
    console.warn("[SECURITY] Server is running as root — this is discouraged.");
  }
  next();
}

module.exports = {
  CONFIG,
  validateExecutionRequest,
  handleValidationErrors,
  scanForInjection,
  clampResourceLimits,
  executionRateLimiter,
  verifySandboxLimits,
  assertNonRoot,
  INJECTION_PATTERNS,
};
