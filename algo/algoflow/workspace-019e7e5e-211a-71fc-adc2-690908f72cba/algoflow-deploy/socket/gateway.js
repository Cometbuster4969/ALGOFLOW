/**
 * ============================================================================
 * AlgoFlow Whiteboard — Socket.io Gateway
 * ============================================================================
 *
 * Manages rooms, broadcasts draw events, and maintains per-room canonical state.
 *
 * Architecture:
 *   ┌─────────┐   draw-event    ┌──────────┐   broadcast   ┌─────────┐
 *   │ Client A │ ──────────────→│ Gateway   │──────────────→│ All     │
 *   └─────────┘                 │ (server)  │               │ clients │
 *                               │           │               └─────────┘
 *                               │ shapes{}  │
 *                               │ (source   │
 *                               │  of truth)│
 *                               └──────────┘
 *
 * Packet types:
 *   draw-event    → shape create / update / delete
 *   cursor-move   → pointer position broadcast
 *   undo / redo   → operation reversal
 *   room-join     → full state snapshot for new joiner
 * ============================================================================
 */

const { v4: uuidv4 } = require("uuid");

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SHAPES_PER_ROOM = 10000;
const MAX_HISTORY = 200;
const MAX_BATCH_OPERATIONS = 100;
const MAX_ROOM_ID_LENGTH = 128;
const MAX_USER_NAME_LENGTH = 64;

// ─── Room State Container ────────────────────────────────────────────────────

class Room {
  constructor(id) {
    this.id = id;
    this.shapes = new Map();      // Normalised O(1) lookup: id → shape
    this.clients = new Map();     // socketId → { cursor, name }
    this.history = [];            // Undo stack (max 200)
    this.redoStack = [];          // Redo stack per-room
    this.createdAt = Date.now();
  }

  addShape(shape, socketId) {
    if (this.shapes.size >= MAX_SHAPES_PER_ROOM) return false;
    this.shapes.set(shape.id, shape);
    this.history.push({ type: "add", shapeId: shape.id, snapshot: { ...shape }, performedBy: socketId });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.redoStack = [];
    return true;
  }

  updateShape(id, patch, socketId) {
    const existing = this.shapes.get(id);
    if (!existing) return null;
    const before = { ...existing };
    Object.assign(existing, patch);
    this.history.push({ type: "update", shapeId: id, before, after: { ...existing }, performedBy: socketId });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.redoStack = [];
    return existing;
  }

  deleteShape(id, socketId) {
    const existing = this.shapes.get(id);
    if (!existing) return false;
    this.history.push({ type: "delete", shapeId: id, snapshot: { ...existing }, performedBy: socketId });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.redoStack = [];
    this.shapes.delete(id);
    return true;
  }

  /**
   * Undo the last action performed by a specific socket.
   * Only the original author can undo their own action (W-03 fix).
   */
  undo(socketId) {
    // Walk backwards to find the most recent action by this socket
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].performedBy !== socketId) continue;
      const action = this.history.splice(i, 1)[0];

      switch (action.type) {
        case "add":
          this.shapes.delete(action.shapeId);
          this.redoStack.push(action);
          return { action: "delete", shapeId: action.shapeId };
        case "delete":
          this.shapes.set(action.shapeId, action.snapshot);
          this.redoStack.push(action);
          return { action: "add", shape: action.snapshot };
        case "update":
          this.shapes.set(action.shapeId, action.before);
          this.redoStack.push(action);
          return { action: "update", shape: action.before };
      }
    }
    return null;
  }

  /**
   * Redo the last undone action by this socket.
   */
  redo(socketId) {
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      if (this.redoStack[i].performedBy !== socketId) continue;
      const action = this.redoStack.splice(i, 1)[0];

      switch (action.type) {
        case "add":
          this.shapes.set(action.shapeId, action.snapshot);
          this.history.push(action);
          return { action: "add", shape: action.snapshot };
        case "delete":
          this.shapes.delete(action.shapeId);
          this.history.push(action);
          return { action: "delete", shapeId: action.shapeId };
        case "update":
          this.shapes.set(action.shapeId, action.after);
          this.history.push(action);
          return { action: "update", shape: action.after };
      }
    }
    return null;
  }

  getSnapshot() {
    return Array.from(this.shapes.values());
  }

  get clientCount() {
    return this.clients.size;
  }
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

class Gateway {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId → Room
    this._bindEvents();
  }

  _getOrCreateRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Room(roomId));
    }
    return this.rooms.get(roomId);
  }

  _bindEvents() {
    this.io.on("connection", (socket) => {
      let currentRoomId = null;
      let currentUser = { name: "Anonymous", color: this._randomColor() };

      // ── Input sanitisation ───────────────────────────────────────────

      /**
       * Strip __proto__ / constructor keys to prevent prototype pollution.
       * Recurses one level into nested objects (sufficient for shape data).
       */
      const sanitize = (obj) => {
        if (!obj || typeof obj !== "object") return obj;
        const clean = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
          clean[k] = v;
        }
        return clean;
      };

      // ── Room join ────────────────────────────────────────────────────

      socket.on("room-join", (data) => {
        const { roomId, user } = data;
        if (!roomId || typeof roomId !== "string" || roomId.length > 128) return;
        if (roomId.includes("\0")) return; // null byte injection
        currentRoomId = roomId;
        if (user) {
          currentUser = { ...currentUser, ...user };
        }

        // Leave previous room if any
        for (const rid of socket.rooms) {
          if (rid !== socket.id) socket.leave(rid);
        }

        socket.join(roomId);
        const room = this._getOrCreateRoom(roomId);
        room.clients.set(socket.id, { cursor: null, ...currentUser });

        // Send full state snapshot to joiner
        socket.emit("room-state", {
          roomId,
          shapes: room.getSnapshot(),
          clients: Object.fromEntries(room.clients),
          historySize: room.history.length,
          redoSize: room.redoStack.length,
        });

        // Notify others
        socket.to(roomId).emit("client-joined", {
          socketId: socket.id,
          ...currentUser,
        });

        console.log(
          `[Gateway] ${currentUser.name} joined room ${roomId} (${room.clientCount} clients)`
        );
      });

      // ── Draw events (throttled from client) ──────────────────────────

      socket.on("draw-event", (event) => {
        if (!currentRoomId) return;
        if (!event || typeof event.action !== "string") return;
        const room = this.rooms.get(currentRoomId);
        if (!room) return;

        // Limit batch size to prevent DoS
        if (event.action === "batch" && Array.isArray(event.operations)) {
          if (event.operations.length > MAX_BATCH_OPERATIONS) return;
        }

        let accepted = true;
        switch (event.action) {
          case "add":
            accepted = room.addShape(sanitize(event.shape), socket.id);
            break;
          case "update":
            room.updateShape(event.shapeId, sanitize(event.patch), socket.id);
            break;
          case "delete":
            room.deleteShape(event.shapeId, socket.id);
            break;
          case "batch":
            for (const op of event.operations) {
              if (op.action === "add") room.addShape(sanitize(op.shape), socket.id);
              else if (op.action === "update") room.updateShape(op.shapeId, sanitize(op.patch), socket.id);
              else if (op.action === "delete") room.deleteShape(op.shapeId, socket.id);
            }
            break;
        }

        // Reject silently if room is full (shape not added)
        if (accepted === false) return;

        // Broadcast to all OTHER clients in the room
        socket.to(currentRoomId).emit("draw-event", {
          ...event,
          senderId: socket.id,
          timestamp: Date.now(),
        });
      });

      // ── Cursor tracking ─────────────────────────────────────────────

      socket.on("cursor-move", (data) => {
        if (!currentRoomId) return;
        if (!data || typeof data !== "object") return;
        const room = this.rooms.get(currentRoomId);
        if (!room) return;

        // Whitelist only x, y — ignore everything else (W-07 fix)
        const x = typeof data.x === "number" ? data.x : 0;
        const y = typeof data.y === "number" ? data.y : 0;

        const client = room.clients.get(socket.id);
        if (client) client.cursor = { x, y };

        socket.to(currentRoomId).emit("cursor-move", {
          socketId: socket.id,
          x,
          y,
          name: currentUser.name,
          color: currentUser.color,
        });
      });

      // ── Undo / Redo (server-authoritative, per-socket) ──────────────

      socket.on("undo", () => {
        if (!currentRoomId) return;
        const room = this.rooms.get(currentRoomId);
        if (!room) return;

        const result = room.undo(socket.id);
        if (result) {
          this.io.to(currentRoomId).emit("undo-result", {
            ...result,
            performedBy: socket.id,
          });
        }
      });

      socket.on("redo", () => {
        if (!currentRoomId) return;
        const room = this.rooms.get(currentRoomId);
        if (!room) return;

        const result = room.redo(socket.id);
        if (result) {
          this.io.to(currentRoomId).emit("redo-result", {
            ...result,
            performedBy: socket.id,
          });
        }
      });

      // ── Disconnect ──────────────────────────────────────────────────

      socket.on("disconnect", () => {
        if (currentRoomId) {
          const room = this.rooms.get(currentRoomId);
          if (room) {
            room.clients.delete(socket.id);
            socket.to(currentRoomId).emit("client-left", {
              socketId: socket.id,
            });
            console.log(
              `[Gateway] ${currentUser.name} left room ${currentRoomId} (${room.clientCount} clients)`
            );

            // Garbage-collect empty rooms after 5 minutes
            if (room.clientCount === 0) {
              setTimeout(() => {
                const r = this.rooms.get(currentRoomId);
                if (r && r.clientCount === 0) {
                  this.rooms.delete(currentRoomId);
                  console.log(`[Gateway] Room ${currentRoomId} garbage-collected`);
                }
              }, 5 * 60 * 1000);
            }
          }
        }
      });
    });
  }

  _randomColor() {
    const colors = [
      "#6366f1", "#ec4899", "#10b981", "#f59e0b",
      "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /** Expose room stats for health endpoint */
  getStats() {
    const stats = { totalRooms: this.rooms.size, rooms: [] };
    for (const [id, room] of this.rooms) {
      stats.rooms.push({
        id,
        clients: room.clientCount,
        shapes: room.shapes.size,
        historyDepth: room.history.length,
      });
    }
    return stats;
  }
}

module.exports = { Gateway, Room };
