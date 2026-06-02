/**
 * ============================================================================
 * AlgoFlow Whiteboard — Server Entry Point
 * ============================================================================
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { Gateway } = require("./socket/gateway");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e6, // 1MB max payload
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ...gateway.getStats() });
});

// Initialise gateway
const gateway = new Gateway(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[AlgoFlow Whiteboard] Listening on http://localhost:${PORT}`);
});
