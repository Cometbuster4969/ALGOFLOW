/**
 * ============================================================================
 * AlgoFlow Whiteboard — Shared Types
 * ============================================================================
 */

// ─── Shape primitives ───────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export type ShapeType = "node" | "edge" | "text";

export interface BaseShape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  locked: boolean;      // Locked by another user
  lockedBy: string | null;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface NodeShape extends BaseShape {
  type: "node";
  label: string;
  radius: number;
  shape: "circle" | "rect" | "diamond";
  fontSize: number;
}

export interface EdgeShape extends BaseShape {
  type: "edge";
  sourceId: string;      // ID of source node
  targetId: string;      // ID of target node
  sourceAnchor: Point;   // Absolute start point (computed from source node)
  targetAnchor: Point;   // Absolute end point (computed from target node)
  weight: string;        // Edge weight label
  directed: boolean;     // Arrow on target end
  style: "solid" | "dashed" | "dotted";
}

export interface TextShape extends BaseShape {
  type: "text";
  text: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
}

export type Shape = NodeShape | EdgeShape | TextShape;

// ─── Canvas / Viewport ──────────────────────────────────────────────────────

export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface GridSettings {
  enabled: boolean;
  size: number;          // Grid cell size in world pixels
  snapToGrid: boolean;
  showGrid: boolean;
}

// ─── Cursor ─────────────────────────────────────────────────────────────────

export interface RemoteCursor {
  socketId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastSeen: number;
}

// ─── Draw events ────────────────────────────────────────────────────────────

export type DrawAction = "add" | "update" | "delete" | "batch";

export interface DrawEvent {
  action: DrawAction;
  shapeId?: string;
  shape?: Shape;
  patch?: Partial<Shape>;
  operations?: DrawEvent[];
  senderId?: string;
  timestamp?: number;
}

// ─── Undo / Redo ────────────────────────────────────────────────────────────

export interface UndoAction {
  type: "add" | "update" | "delete";
  shapeId: string;
  snapshot?: Shape;
  before?: Shape;
  after?: Shape;
}

export interface UndoResult {
  action: "add" | "update" | "delete";
  shapeId?: string;
  shape?: Shape;
  performedBy: string;
}

// ─── Tool modes ─────────────────────────────────────────────────────────────

export type ToolMode =
  | "select"
  | "node"
  | "edge"
  | "text"
  | "pan"
  | "eraser";

// ─── Room ───────────────────────────────────────────────────────────────────

export interface RoomState {
  roomId: string;
  shapes: Shape[];
  clients: Record<string, { cursor: RemoteCursor }>;
  historySize: number;
  redoSize: number;
}
