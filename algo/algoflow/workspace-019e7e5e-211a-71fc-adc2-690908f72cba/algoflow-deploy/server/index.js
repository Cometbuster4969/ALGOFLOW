/**
 * AlgoFlow — Unified backend (sandbox + SRS + whiteboard)
 */

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const { createAdapter, openDatabase, getDataDir } = require("./db/sqlite");
const { Gateway } = require("../socket/gateway");
const { verifySandboxLimits } = require("./sandbox/security");
const { findAvailablePort } = require("./lib/port");
const { optionalApiKey } = require("./middleware/auth");

const executeRouter = require("./api/execute");
const reviewRouter = require("./api/review");
const problemsRouter = require("./api/problems");
const templatesRouter = require("./api/templates");
const usersRouter = require("./api/users");
const analyzeRouter = require("./api/analyze");

const PREFERRED_PORT = parseInt(process.env.PORT || "3001", 10);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e6,
});

openDatabase();
const dbAdapter = createAdapter();

app.use(express.json({ limit: "30mb" }));

app.use((req, _res, next) => {
  req.db = dbAdapter;
  next();
});

app.use(express.static(PUBLIC_DIR));

const gateway = new Gateway(io);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    port: activePort,
    uptime: process.uptime(),
    node: process.version,
    services: {
      sandbox: true,
      review: true,
      whiteboard: gateway.getStats(),
    },
  });
});

app.use("/api", optionalApiKey);
app.use("/api", executeRouter);
app.use("/api/review", reviewRouter);
app.use("/api/problems", problemsRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/users", usersRouter);
app.use("/api/analyze", analyzeRouter);

let activePort = PREFERRED_PORT;

function writePortFile(port) {
  try {
    const portFile = path.join(getDataDir(), "server-port.txt");
    fs.writeFileSync(portFile, String(port), "utf8");
  } catch {
    // non-fatal
  }
}

async function start() {
  activePort = await findAvailablePort(PREFERRED_PORT);
  if (activePort !== PREFERRED_PORT) {
    console.warn(
      `[AlgoFlow] Port ${PREFERRED_PORT} in use — using ${activePort} instead`
    );
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(activePort, "0.0.0.0", () => {
      server.off("error", reject);
      writePortFile(activePort);
      console.log(`[AlgoFlow] Listening on http://127.0.0.1:${activePort}`);

      if (verifySandboxLimits()) {
        console.log("[AlgoFlow] ulimit enforcement: verified");
      } else if (process.platform === "win32") {
        console.log(
          "[AlgoFlow] Sandbox uses process timeouts on Windows (ulimit not available)"
        );
      } else {
        console.warn(
          "[AlgoFlow] WARNING: ulimit verification failed — memory caps may be weaker"
        );
      }

      resolve(activePort);
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("[AlgoFlow] Failed to start:", err.message);
    process.exit(1);
  });
}

module.exports = { app, server, start };
