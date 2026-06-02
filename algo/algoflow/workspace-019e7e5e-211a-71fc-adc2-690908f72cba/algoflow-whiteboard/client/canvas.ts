/**
 * ============================================================================
 * AlgoFlow Whiteboard — Canvas Renderer
 * ============================================================================
 *
 * Low-level drawing logic. Owns the HTMLCanvasElement and its 2D context.
 *
 * Responsibilities:
 *   1. Transform between screen coords ↔ world coords (viewport pan/zoom)
 *   2. Render shapes from the normalised shapes map
 *   3. Draw grid, selection box, remote cursors
 *   4. Handle resize without distortion (DPR-aware)
 *
 * The renderer is "dumb" — it does NOT own state. The SyncEngine pushes
 * shapes in, and the renderer draws them.
 * ============================================================================
 */

import {
  Shape, NodeShape, EdgeShape, TextShape,
  Viewport, GridSettings, RemoteCursor, Point,
} from "./types";

// ─── Constants ──────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const GRID_COLOR = "rgba(99, 102, 241, 0.08)";
const GRID_DOT_COLOR = "rgba(99, 102, 241, 0.25)";

// ─── Renderer ───────────────────────────────────────────────────────────────

export class CanvasRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  viewport: Viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
  grid: GridSettings = { enabled: true, size: 20, snapToGrid: true, showGrid: true };

  private dpr = 1;
  private _width = 0;
  private _height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
  }

  // ── Resize (DPR-aware) ─────────────────────────────────────────────────

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this._width = rect.width;
    this._height = rect.height;

    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  get width(): number { return this._width; }
  get height(): number { return this._height; }

  // ── Coordinate transforms ──────────────────────────────────────────────

  screenToWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.viewport.offsetX) / this.viewport.zoom,
      y: (sy - this.viewport.offsetY) / this.viewport.zoom,
    };
  }

  worldToScreen(wx: number, wy: number): Point {
    return {
      x: wx * this.viewport.zoom + this.viewport.offsetX,
      y: wy * this.viewport.zoom + this.viewport.offsetY,
    };
  }

  snapToGrid(p: Point): Point {
    if (!this.grid.snapToGrid) return p;
    const s = this.grid.size;
    return {
      x: Math.round(p.x / s) * s,
      y: Math.round(p.y / s) * s,
    };
  }

  // ── Viewport controls ──────────────────────────────────────────────────

  pan(dx: number, dy: number): void {
    this.viewport.offsetX += dx;
    this.viewport.offsetY += dy;
  }

  zoomAt(factor: number, cx: number, cy: number): void {
    const oldZoom = this.viewport.zoom;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
    const ratio = newZoom / oldZoom;

    // Zoom towards cursor position
    this.viewport.offsetX = cx - (cx - this.viewport.offsetX) * ratio;
    this.viewport.offsetY = cy - (cy - this.viewport.offsetY) * ratio;
    this.viewport.zoom = newZoom;
  }

  resetView(): void {
    this.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
  }

  // ── Main render loop ───────────────────────────────────────────────────

  render(
    shapes: Map<string, Shape>,
    selection: Set<string>,
    remoteCursors: Map<string, RemoteCursor>,
    tempShape: Shape | null,
    selectionBox: { x: number; y: number; w: number; h: number } | null
  ): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this._width, this._height);

    ctx.save();
    ctx.translate(this.viewport.offsetX, this.viewport.offsetY);
    ctx.scale(this.viewport.zoom, this.viewport.zoom);

    // Grid (drawn in world space)
    if (this.grid.showGrid) {
      this._drawGrid();
    }

    // Shapes (sorted by zIndex)
    const sorted = Array.from(shapes.values()).sort((a, b) => a.zIndex - b.zIndex);
    for (const shape of sorted) {
      this._drawShape(shape, selection.has(shape.id));
    }

    // Temporary shape (e.g., edge being drawn)
    if (tempShape) {
      this._drawShape(tempShape, false, true);
    }

    // Selection box
    if (selectionBox) {
      ctx.strokeStyle = "rgba(99, 102, 241, 0.6)";
      ctx.fillStyle = "rgba(99, 102, 241, 0.08)";
      ctx.lineWidth = 1 / this.viewport.zoom;
      ctx.setLineDash([4 / this.viewport.zoom, 4 / this.viewport.zoom]);
      ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
      ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Remote cursors (drawn in screen space)
    this._drawCursors(remoteCursors);
  }

  // ── Grid ───────────────────────────────────────────────────────────────

  private _drawGrid(): void {
    const ctx = this.ctx;
    const s = this.grid.size;
    const z = this.viewport.zoom;

    // Calculate visible world bounds
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this._width, this._height);

    const startX = Math.floor(topLeft.x / s) * s;
    const startY = Math.floor(topLeft.y / s) * s;
    const endX = Math.ceil(bottomRight.x / s) * s;
    const endY = Math.ceil(bottomRight.y / s) * s;

    // Draw dots at grid intersections
    ctx.fillStyle = GRID_DOT_COLOR;
    const dotRadius = Math.max(1, 1.5 / z);

    for (let x = startX; x <= endX; x += s) {
      for (let y = startY; y <= endY; y += s) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Shape rendering ────────────────────────────────────────────────────

  private _drawShape(shape: Shape, selected: boolean, isTemp = false): void {
    switch (shape.type) {
      case "node":
        this._drawNode(shape as NodeShape, selected, isTemp);
        break;
      case "edge":
        this._drawEdge(shape as EdgeShape, selected, isTemp);
        break;
      case "text":
        this._drawText(shape as TextShape, selected, isTemp);
        break;
    }
  }

  private _drawNode(node: NodeShape, selected: boolean, isTemp: boolean): void {
    const ctx = this.ctx;
    const z = this.viewport.zoom;

    ctx.save();
    ctx.globalAlpha = isTemp ? 0.6 : 1;

    // Shadow for depth
    if (!isTemp) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.15)";
      ctx.shadowBlur = 8 / z;
      ctx.shadowOffsetY = 2 / z;
    }

    ctx.beginPath();
    switch (node.shape) {
      case "circle":
        ctx.arc(node.x + node.radius, node.y + node.radius, node.radius, 0, Math.PI * 2);
        break;
      case "rect":
        this._roundRect(node.x, node.y, node.width, node.height, 6 / z);
        break;
      case "diamond":
        ctx.moveTo(node.x + node.width / 2, node.y);
        ctx.lineTo(node.x + node.width, node.y + node.height / 2);
        ctx.lineTo(node.x + node.width / 2, node.y + node.height);
        ctx.lineTo(node.x, node.y + node.height / 2);
        ctx.closePath();
        break;
    }

    ctx.fillStyle = node.fill;
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.strokeStyle = selected ? "#6366f1" : node.stroke;
    ctx.lineWidth = selected ? 2.5 / z : node.strokeWidth / z;
    ctx.stroke();

    // Label
    if (node.label) {
      ctx.fillStyle = this._contrastColor(node.fill);
      ctx.font = `${node.fontSize / z}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        node.label,
        node.x + node.width / 2,
        node.y + node.height / 2
      );
    }

    // Selection handles
    if (selected) {
      this._drawHandles(node);
    }

    ctx.restore();
  }

  private _drawEdge(edge: EdgeShape, selected: boolean, isTemp: boolean): void {
    const ctx = this.ctx;
    const z = this.viewport.zoom;

    ctx.save();
    ctx.globalAlpha = isTemp ? 0.5 : 1;

    ctx.beginPath();
    ctx.moveTo(edge.sourceAnchor.x, edge.sourceAnchor.y);
    ctx.lineTo(edge.targetAnchor.x, edge.targetAnchor.y);

    ctx.strokeStyle = selected ? "#6366f1" : edge.stroke;
    ctx.lineWidth = (selected ? 2.5 : edge.strokeWidth) / z;

    switch (edge.style) {
      case "dashed":
        ctx.setLineDash([8 / z, 4 / z]);
        break;
      case "dotted":
        ctx.setLineDash([2 / z, 4 / z]);
        break;
      default:
        ctx.setLineDash([]);
    }

    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead for directed edges
    if (edge.directed) {
      this._drawArrowhead(edge.sourceAnchor, edge.targetAnchor, edge.stroke, z);
    }

    // Weight label
    if (edge.weight) {
      const midX = (edge.sourceAnchor.x + edge.targetAnchor.x) / 2;
      const midY = (edge.sourceAnchor.y + edge.targetAnchor.y) / 2;

      ctx.font = `bold ${12 / z}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Background pill
      const metrics = ctx.measureText(edge.weight);
      const pad = 4 / z;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      this._roundRect(
        midX - metrics.width / 2 - pad,
        midY - 7 / z - pad,
        metrics.width + pad * 2,
        14 / z + pad * 2,
        4 / z
      );
      ctx.fill();

      ctx.fillStyle = edge.stroke;
      ctx.fillText(edge.weight, midX, midY);
    }

    ctx.restore();
  }

  private _drawText(text: TextShape, selected: boolean, isTemp: boolean): void {
    const ctx = this.ctx;
    const z = this.viewport.zoom;

    ctx.save();
    ctx.globalAlpha = isTemp ? 0.6 : 1;
    ctx.font = `${text.fontWeight} ${text.fontSize / z}px -apple-system, sans-serif`;
    ctx.fillStyle = text.fill;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(text.text, text.x, text.y);

    if (selected) {
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.strokeRect(text.x - 2 / z, text.y - 2 / z, text.width + 4 / z, text.height + 4 / z);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private _drawArrowhead(from: Point, to: Point, color: string, z: number): void {
    const ctx = this.ctx;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = 12 / z;
    const headAngle = Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - headLen * Math.cos(angle - headAngle),
      to.y - headLen * Math.sin(angle - headAngle)
    );
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - headLen * Math.cos(angle + headAngle),
      to.y - headLen * Math.sin(angle + headAngle)
    );
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  private _drawHandles(shape: NodeShape): void {
    const ctx = this.ctx;
    const z = this.viewport.zoom;
    const size = 6 / z;

    ctx.fillStyle = "#6366f1";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5 / z;

    const corners = [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.width, y: shape.y },
      { x: shape.x + shape.width, y: shape.y + shape.height },
      { x: shape.x, y: shape.y + shape.height },
    ];

    for (const c of corners) {
      ctx.fillRect(c.x - size / 2, c.y - size / 2, size, size);
      ctx.strokeRect(c.x - size / 2, c.y - size / 2, size, size);
    }
  }

  private _drawCursors(cursors: Map<string, RemoteCursor>): void {
    const ctx = this.ctx;

    for (const [_id, cursor] of cursors) {
      if (Date.now() - cursor.lastSeen > 10000) continue; // Stale

      const screen = this.worldToScreen(cursor.x, cursor.y);

      // Cursor arrow
      ctx.save();
      ctx.fillStyle = cursor.color;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(screen.x + 14, screen.y + 10);
      ctx.lineTo(screen.x + 5, screen.y + 10);
      ctx.closePath();
      ctx.fill();

      // Name label
      ctx.font = "11px -apple-system, sans-serif";
      ctx.fillStyle = cursor.color;
      const metrics = ctx.measureText(cursor.name);
      const pad = 4;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(screen.x + 16, screen.y + 2, metrics.width + pad * 2, 16);
      ctx.fillStyle = cursor.color;
      ctx.fillText(cursor.name, screen.x + 16 + pad, screen.y + 14);

      ctx.restore();
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private _roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private _contrastColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.5 ? "#1a1a2e" : "#ffffff";
  }

  hitTest(worldX: number, worldY: number, shapes: Map<string, Shape>): Shape | null {
    // Iterate reverse zIndex (topmost first)
    const sorted = Array.from(shapes.values()).sort((a, b) => b.zIndex - a.zIndex);

    for (const shape of sorted) {
      if (shape.type === "edge") {
        const edge = shape as EdgeShape;
        if (this._pointNearLine(worldX, worldY, edge.sourceAnchor, edge.targetAnchor, 6 / this.viewport.zoom)) {
          return shape;
        }
      } else {
        if (
          worldX >= shape.x &&
          worldX <= shape.x + shape.width &&
          worldY >= shape.y &&
          worldY <= shape.y + shape.height
        ) {
          return shape;
        }
      }
    }
    return null;
  }

  private _pointNearLine(px: number, py: number, a: Point, b: Point, threshold: number): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - a.x, py - a.y) < threshold;

    let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const nearX = a.x + t * dx;
    const nearY = a.y + t * dy;
    return Math.hypot(px - nearX, py - nearY) < threshold;
  }
}
