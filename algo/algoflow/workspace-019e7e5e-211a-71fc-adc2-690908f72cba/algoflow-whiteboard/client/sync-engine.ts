/**
 * ============================================================================
 * AlgoFlow Whiteboard — Sync Engine
 * ============================================================================
 *
 * Reconciliation layer between the local canvas and remote clients.
 *
 * Responsibilities:
 *   1. Maintain the canonical shapes map (single source of truth locally)
 *   2. Apply local edits and broadcast via ThrottledBuffer
 *   3. Apply remote edits and resolve conflicts (last-write-wins by timestamp)
 *   4. Manage undo/redo stacks (client-side + server-side)
 *   5. Handle room join/leave lifecycle
 *
 * Conflict resolution:
 *   • Each shape has an `updatedAt` timestamp.
 *   • When a remote update arrives for a shape we've locally modified more
 *     recently, we keep the local version and send a corrective update.
 *   • When we receive a snapshot on join, we merge it into our local state.
 * ============================================================================
 */

import { io, Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import { CanvasRenderer } from "./canvas";
import { ThrottledBuffer, createCursorBuffer, createDrawBuffer } from "./throttled-buffer";
import {
  Shape, NodeShape, EdgeShape, DrawEvent, RemoteCursor,
  RoomState, UndoAction, UndoResult, ToolMode, Point,
} from "./types";

// ─── SyncEngine ─────────────────────────────────────────────────────────────

export class SyncEngine {
  // Core state
  shapes = new Map<string, Shape>();
  selection = new Set<string>();
  remoteCursors = new Map<string, RemoteCursor>();
  tempShape: Shape | null = null;
  selectionBox: { x: number; y: number; w: number; h: number } | null = null;

  // Tool state
  activeTool: ToolMode = "select";
  activeColor = "#6366f1";
  edgeSourceId: string | null = null;

  // Undo / Redo (client-side mirror)
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private maxHistory = 200;

  // Networking
  socket: Socket;
  renderer: CanvasRenderer;
  private drawBuffer: ThrottledBuffer<string, DrawEvent>;
  private cursorBuffer: ThrottledBuffer<string, { x: number; y: number }>;
  private roomId: string | null = null;

  // Drag state
  private dragging = false;
  private dragStart: Point | null = null;
  private dragShapeStart: Map<string, { x: number; y: number }> = new Map();
  private panning = false;
  private panStart: Point | null = null;

  // Animation
  private animFrame: number | null = null;

  constructor(serverUrl: string, canvas: HTMLCanvasElement) {
    this.renderer = new CanvasRenderer(canvas);
    this.socket = io(serverUrl, { transports: ["websocket"] });

    // Create throttled buffers (60 fps)
    this.drawBuffer = createDrawBuffer(this.socket, 16.67);
    this.cursorBuffer = createCursorBuffer(this.socket, 16.67);

    this._bindSocketEvents();
    this._bindCanvasEvents(canvas);
    this._bindKeyboardEvents();

    // Start buffers and render loop
    this.drawBuffer.start();
    this.cursorBuffer.start();
    this._startRenderLoop();
  }

  // ── Room management ────────────────────────────────────────────────────

  joinRoom(roomId: string, userName: string): void {
    this.roomId = roomId;
    this.socket.emit("room-join", {
      roomId,
      user: { name: userName },
    });
  }

  // ── Shape operations (local) ───────────────────────────────────────────

  addShape(shape: Shape): void {
    this.shapes.set(shape.id, shape);
    this._pushUndo({ type: "add", shapeId: shape.id, snapshot: { ...shape } });
    this._emitDraw({ action: "add", shape });
  }

  updateShape(id: string, patch: Partial<Shape>): void {
    const existing = this.shapes.get(id);
    if (!existing) return;

    const before = { ...existing };
    Object.assign(existing, patch, { updatedAt: Date.now() });
    this._pushUndo({ type: "update", shapeId: id, before, after: { ...existing } });
    this._emitDraw({ action: "update", shapeId: id, patch });
  }

  deleteShape(id: string): void {
    const existing = this.shapes.get(id);
    if (!existing) return;

    this._pushUndo({ type: "delete", shapeId: id, snapshot: { ...existing } });
    this.shapes.delete(id);
    this.selection.delete(id);
    this._emitDraw({ action: "delete", shapeId: id });
  }

  deleteSelection(): void {
    for (const id of this.selection) {
      this.deleteShape(id);
    }
  }

  // ── Undo / Redo ────────────────────────────────────────────────────────

  undo(): void {
    // Try client-side undo first
    const action = this.undoStack.pop();
    if (!action) {
      // Ask server for server-side undo
      this.socket.emit("undo");
      return;
    }

    switch (action.type) {
      case "add":
        this.shapes.delete(action.shapeId);
        this.redoStack.push(action);
        this._emitDraw({ action: "delete", shapeId: action.shapeId });
        break;
      case "delete":
        if (action.snapshot) {
          this.shapes.set(action.shapeId, action.snapshot);
          this.redoStack.push(action);
          this._emitDraw({ action: "add", shape: action.snapshot });
        }
        break;
      case "update":
        if (action.before) {
          this.shapes.set(action.shapeId, action.before);
          this.redoStack.push(action);
          this._emitDraw({ action: "update", shapeId: action.shapeId, patch: action.before });
        }
        break;
    }
  }

  redo(): void {
    const action = this.redoStack.pop();
    if (!action) {
      this.socket.emit("redo");
      return;
    }

    switch (action.type) {
      case "add":
        if (action.snapshot) {
          this.shapes.set(action.shapeId, action.snapshot);
          this.undoStack.push(action);
          this._emitDraw({ action: "add", shape: action.snapshot });
        }
        break;
      case "delete":
        this.shapes.delete(action.shapeId);
        this.undoStack.push(action);
        this._emitDraw({ action: "delete", shapeId: action.shapeId });
        break;
      case "update":
        if (action.after) {
          this.shapes.set(action.shapeId, action.after);
          this.undoStack.push(action);
          this._emitDraw({ action: "update", shapeId: action.shapeId, patch: action.after });
        }
        break;
    }
  }

  private _pushUndo(action: UndoAction): void {
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  // ── Socket event handling ──────────────────────────────────────────────

  private _bindSocketEvents(): void {
    // Full state snapshot on room join
    this.socket.on("room-state", (state: RoomState) => {
      this.shapes.clear();
      for (const shape of state.shapes) {
        this.shapes.set(shape.id, shape);
      }
      for (const [id, client] of Object.entries(state.clients)) {
        if (client.cursor) {
          this.remoteCursors.set(id, { ...client.cursor, socketId: id, lastSeen: Date.now() });
        }
      }
    });

    // Remote draw events
    this.socket.on("draw-event", (event: DrawEvent & { senderId: string }) => {
      this._applyRemoteDraw(event);
    });

    // Remote cursor moves
    this.socket.on("cursor-move", (data: RemoteCursor) => {
      this.remoteCursors.set(data.socketId, { ...data, lastSeen: Date.now() });
    });

    // Undo / redo results from server
    this.socket.on("undo-result", (result: UndoResult) => {
      this._applyUndoRedoResult(result);
    });

    this.socket.on("redo-result", (result: UndoResult) => {
      this._applyUndoRedoResult(result);
    });

    // Client lifecycle
    this.socket.on("client-left", (data: { socketId: string }) => {
      this.remoteCursors.delete(data.socketId);
      // Unlock shapes locked by this client
      for (const shape of this.shapes.values()) {
        if (shape.lockedBy === data.socketId) {
          shape.locked = false;
          shape.lockedBy = null;
        }
      }
    });
  }

  private _applyRemoteDraw(event: DrawEvent & { senderId: string }): void {
    switch (event.action) {
      case "add":
        if (event.shape) {
          this.shapes.set(event.shape.id, event.shape);
        }
        break;
      case "update":
        if (event.shapeId && event.patch) {
          const local = this.shapes.get(event.shapeId);
          // Only apply if remote is newer (or we don't have it)
          if (!local || (event.timestamp && event.timestamp > local.updatedAt)) {
            if (local) {
              Object.assign(local, event.patch);
            } else {
              // We don't have this shape — create it from patch
              this.shapes.set(event.shapeId, event.patch as Shape);
            }
          }
        }
        break;
      case "delete":
        if (event.shapeId) {
          this.shapes.delete(event.shapeId);
          this.selection.delete(event.shapeId);
        }
        break;
      case "batch":
        if (event.operations) {
          for (const op of event.operations) {
            this._applyRemoteDraw({ ...op, senderId: event.senderId });
          }
        }
        break;
    }
  }

  private _applyUndoRedoResult(result: UndoResult): void {
    switch (result.action) {
      case "add":
        if (result.shape) this.shapes.set(result.shape.id, result.shape);
        break;
      case "delete":
        if (result.shapeId) this.shapes.delete(result.shapeId);
        break;
      case "update":
        if (result.shape) this.shapes.set(result.shape.id, result.shape);
        break;
    }
  }

  // ── Canvas event handling ──────────────────────────────────────────────

  private _bindCanvasEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousedown", this._onMouseDown.bind(this));
    canvas.addEventListener("mousemove", this._onMouseMove.bind(this));
    canvas.addEventListener("mouseup", this._onMouseUp.bind(this));
    canvas.addEventListener("wheel", this._onWheel.bind(this), { passive: false });
    canvas.addEventListener("dblclick", this._onDblClick.bind(this));

    // Resize observer
    const ro = new ResizeObserver(() => this.renderer.resize());
    ro.observe(canvas);
  }

  private _onMouseDown(e: MouseEvent): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.renderer.screenToWorld(sx, sy);

    // Middle mouse or space+click → pan
    if (e.button === 1 || this.activeTool === "pan") {
      this.panning = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button !== 0) return;

    switch (this.activeTool) {
      case "select":
        this._handleSelectDown(world, e);
        break;
      case "node":
        this._handleNodeDown(world);
        break;
      case "edge":
        this._handleEdgeDown(world);
        break;
      case "eraser":
        this._handleEraserDown(world);
        break;
    }
  }

  private _onMouseMove(e: MouseEvent): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.renderer.screenToWorld(sx, sy);

    // Broadcast cursor
    this.cursorBuffer.push("local", { x: world.x, y: world.y });

    // Panning
    if (this.panning && this.panStart) {
      this.renderer.pan(e.clientX - this.panStart.x, e.clientY - this.panStart.y);
      this.panStart = { x: e.clientX, y: e.clientY };
      return;
    }

    // Dragging shapes
    if (this.dragging && this.dragStart) {
      const dx = world.x - this.dragStart.x;
      const dy = world.y - this.dragStart.y;

      for (const id of this.selection) {
        const startPos = this.dragShapeStart.get(id);
        if (!startPos) continue;
        this.updateShape(id, {
          x: startPos.x + dx,
          y: startPos.y + dy,
        });

        // If this is a node, update connected edges
        this._updateConnectedEdges(id);
      }
      return;
    }

    // Edge tool: update temp edge endpoint
    if (this.activeTool === "edge" && this.edgeSourceId && this.tempShape) {
      const snapped = this.renderer.snapToGrid(world);
      (this.tempShape as EdgeShape).targetAnchor = snapped;

      // Snap to nearby node center
      const nearNode = this._findNodeAt(snapped);
      if (nearNode && nearNode.id !== this.edgeSourceId) {
        const center = this._nodeCenter(nearNode as NodeShape);
        (this.tempShape as EdgeShape).targetAnchor = center;
      }
    }
  }

  private _onMouseUp(_e: MouseEvent): void {
    if (this.panning) {
      this.panning = false;
      this.panStart = null;
      return;
    }

    if (this.dragging) {
      this.dragging = false;
      this.dragStart = null;
      this.dragShapeStart.clear();
      return;
    }

    // Edge tool: finalize edge
    if (this.activeTool === "edge" && this.edgeSourceId && this.tempShape) {
      const edge = this.tempShape as EdgeShape;
      const target = this._findNodeAt(edge.targetAnchor);
      if (target && target.id !== this.edgeSourceId) {
        edge.targetId = target.id;
        edge.targetAnchor = this._nodeCenter(target as NodeShape);
        this.addShape(edge);
      }
      this.tempShape = null;
      this.edgeSourceId = null;
    }
  }

  private _onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.renderer.canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    this.renderer.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  private _onDblClick(e: MouseEvent): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    const world = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = this.renderer.hitTest(world.x, world.y, this.shapes);

    if (hit && hit.type === "node") {
      const label = prompt("Node label:", (hit as NodeShape).label || "");
      if (label !== null) {
        this.updateShape(hit.id, { label });
      }
    }
  }

  private _bindKeyboardEvents(): void {
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); this.undo(); }
        if (e.key === "z" && e.shiftKey)  { e.preventDefault(); this.redo(); }
        if (e.key === "y")                { e.preventDefault(); this.redo(); }
        if (e.key === "a")                { e.preventDefault(); this.selectAll(); }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.deleteSelection();
      }

      if (e.key === "Escape") {
        this.selection.clear();
        this.tempShape = null;
        this.edgeSourceId = null;
      }
    });
  }

  // ── Tool handlers ──────────────────────────────────────────────────────

  private _handleSelectDown(world: Point, e: MouseEvent): void {
    const hit = this.renderer.hitTest(world.x, world.y, this.shapes);

    if (hit) {
      if (e.shiftKey) {
        // Toggle selection
        if (this.selection.has(hit.id)) {
          this.selection.delete(hit.id);
        } else {
          this.selection.add(hit.id);
        }
      } else if (!this.selection.has(hit.id)) {
        this.selection.clear();
        this.selection.add(hit.id);
      }

      // Start drag
      this.dragging = true;
      this.dragStart = { ...world };
      for (const id of this.selection) {
        const shape = this.shapes.get(id);
        if (shape) {
          this.dragShapeStart.set(id, { x: shape.x, y: shape.y });
        }
      }
    } else {
      // Click on empty space — clear selection or start selection box
      if (!e.shiftKey) this.selection.clear();
    }
  }

  private _handleNodeDown(world: Point): void {
    const snapped = this.renderer.snapToGrid(world);
    const node: NodeShape = {
      id: uuidv4(),
      type: "node",
      x: snapped.x - 25,
      y: snapped.y - 25,
      width: 50,
      height: 50,
      radius: 25,
      fill: this.activeColor,
      stroke: this._darken(this.activeColor),
      strokeWidth: 2,
      label: "",
      shape: "circle",
      fontSize: 14,
      locked: false,
      lockedBy: null,
      zIndex: this.shapes.size,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.addShape(node);
  }

  private _handleEdgeDown(world: Point): void {
    const hit = this.renderer.hitTest(world.x, world.y, this.shapes);
    if (hit && hit.type === "node") {
      this.edgeSourceId = hit.id;
      const center = this._nodeCenter(hit as NodeShape);
      const tempEdge: EdgeShape = {
        id: "temp-edge",
        type: "edge",
        x: 0, y: 0, width: 0, height: 0,
        sourceId: hit.id,
        targetId: "",
        sourceAnchor: center,
        targetAnchor: { ...world },
        weight: "",
        directed: true,
        style: "solid",
        fill: this.activeColor,
        stroke: this.activeColor,
        strokeWidth: 2,
        locked: false,
        lockedBy: null,
        zIndex: 9999,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.tempShape = tempEdge;
    }
  }

  private _handleEraserDown(world: Point): void {
    const hit = this.renderer.hitTest(world.x, world.y, this.shapes);
    if (hit) {
      // Also delete connected edges
      if (hit.type === "node") {
        for (const shape of this.shapes.values()) {
          if (shape.type === "edge") {
            const edge = shape as EdgeShape;
            if (edge.sourceId === hit.id || edge.targetId === hit.id) {
              this.deleteShape(edge.id);
            }
          }
        }
      }
      this.deleteShape(hit.id);
    }
  }

  // ── Edge-node sticking ─────────────────────────────────────────────────

  private _updateConnectedEdges(nodeId: string): void {
    const node = this.shapes.get(nodeId);
    if (!node || node.type !== "node") return;
    const center = this._nodeCenter(node as NodeShape);

    for (const shape of this.shapes.values()) {
      if (shape.type !== "edge") continue;
      const edge = shape as EdgeShape;
      let changed = false;

      if (edge.sourceId === nodeId) {
        edge.sourceAnchor = { ...center };
        changed = true;
      }
      if (edge.targetId === nodeId) {
        edge.targetAnchor = { ...center };
        changed = true;
      }

      if (changed) {
        edge.updatedAt = Date.now();
        this._emitDraw({
          action: "update",
          shapeId: edge.id,
          patch: { sourceAnchor: edge.sourceAnchor, targetAnchor: edge.targetAnchor },
        });
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private _emitDraw(event: DrawEvent): void {
    const key = event.shapeId || event.shape?.id || uuidv4();
    this.drawBuffer.push(key, event);
  }

  private _nodeCenter(node: NodeShape): Point {
    return {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    };
  }

  private _findNodeAt(point: Point): Shape | null {
    for (const shape of this.shapes.values()) {
      if (shape.type !== "node") continue;
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      const r = (shape as NodeShape).radius || Math.max(shape.width, shape.height) / 2;
      if (Math.hypot(point.x - cx, point.y - cy) < r + 10) {
        return shape;
      }
    }
    return null;
  }

  selectAll(): void {
    for (const id of this.shapes.keys()) {
      this.selection.add(id);
    }
  }

  private _darken(hex: string): string {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.max(0, r - 40);
    g = Math.max(0, g - 40);
    b = Math.max(0, b - 40);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // ── Render loop ────────────────────────────────────────────────────────

  private _startRenderLoop(): void {
    const loop = () => {
      this.renderer.render(
        this.shapes,
        this.selection,
        this.remoteCursors,
        this.tempShape,
        this.selectionBox
      );
      this.animFrame = requestAnimationFrame(loop);
    };
    loop();
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.drawBuffer.stop();
    this.cursorBuffer.stop();
    this.socket.disconnect();
  }
}
