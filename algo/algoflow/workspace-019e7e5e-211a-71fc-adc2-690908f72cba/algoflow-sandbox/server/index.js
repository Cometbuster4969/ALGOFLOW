/**
 * ============================================================================
 * AlgoFlow — Express Server Entry Point
 * ============================================================================
 */

const express = require("express");
const { verifySandboxLimits } = require("./security");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: "30mb" }));

// ─── Routes ──────────────────────────────────────────────────────────────────

// Import and mount the execute router
const executeRouter = require("../api/execute.post");
app.use("/api", executeRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── Startup ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[AlgoFlow Sandbox] Listening on port ${PORT}`);

  // Verify ulimit support
  if (verifySandboxLimits()) {
    console.log("[AlgoFlow Sandbox] ulimit enforcement: ✓ verified");
  } else {
    console.warn(
      "[AlgoFlow Sandbox] WARNING: ulimit verification failed. " +
      "Sandbox may not enforce memory limits correctly."
    );
  }

  // Warn if running as root
  if (process.getuid && process.getuid() === 0) {
    console.warn(
      "[AlgoFlow Sandbox] WARNING: Running as root. " +
      "Use a non-root user in production."
    );
  }
});

module.exports = app;
