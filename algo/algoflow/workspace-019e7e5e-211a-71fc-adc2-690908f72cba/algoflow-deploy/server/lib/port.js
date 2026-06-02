const net = require("net");

function isPortAvailable(port, host = "0.0.0.0") {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, host);
  });
}

async function findAvailablePort(preferred = 3001, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(
    `No free port in range ${preferred}–${preferred + maxAttempts - 1}`
  );
}

module.exports = { findAvailablePort, isPortAvailable };
