/**
 * ============================================================================
 * AlgoFlow — Electron Preload Script
 * ============================================================================
 *
 * Exposes a safe, typed API to the renderer process via contextBridge.
 * No Node.js access leaks to the web content.
 * ============================================================================
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("algoflow", {
  /** Get the local backend server URL */
  getBackendUrl: () => ipcRenderer.invoke("get-backend-url"),

  /** Get the app version */
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  /** Get the user data directory path */
  getDataPath: () => ipcRenderer.invoke("get-data-path"),

  /** Check compiler availability */
  checkCompilers: () => ipcRenderer.invoke("check-compilers"),

  /** Get the local network IP for tablet sync */
  getLocalIp: () => ipcRenderer.invoke("get-local-ip"),
});
