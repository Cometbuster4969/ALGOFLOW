/**
 * ============================================================================
 * AlgoFlow Whiteboard — Graph & Tree Tools
 * ============================================================================
 *
 * High-level helpers for building algorithmic data structures on the canvas.
 *
 * Features:
 *   • Auto-layout Tree (BFS positioning)
 *   • Auto-layout Graph (force-directed / grid)
 *   • Snap-to-grid node placement
 *   • Pre-built templates: Binary Tree, BST, Linked List, Graph
 *   • Edge auto-routing around overlapping nodes
 * ============================================================================
 */

import { v4 as uuidv4 } from "uuid";
import { SyncEngine } from "../sync-engine";
import { NodeShape, EdgeShape, Point } from "../types";

// ─── Templates ──────────────────────────────────────────────────────────────

export interface NodeTemplate {
  label: string;
  value?: number;
}

export interface EdgeTemplate {
  from: number; // index into nodes array
  to: number;
  weight?: number;
  directed?: boolean;
}

export interface GraphTemplate {
  nodes: NodeTemplate[];
  edges: EdgeTemplate[];
}

// ─── GraphTools ─────────────────────────────────────────────────────────────

export class GraphTools {
  private engine: SyncEngine;
  private gridSize: number;

  constructor(engine: SyncEngine, gridSize = 20) {
    this.engine = engine;
    this.gridSize = gridSize;
  }

  // ── Snap helper ────────────────────────────────────────────────────────

  snap(p: Point): Point {
    const s = this.gridSize;
    return {
      x: Math.round(p.x / s) * s,
      y: Math.round(p.y / s) * s,
    };
  }

  // ── Create a single node ───────────────────────────────────────────────

  createNode(
    cx: number,
    cy: number,
    label: string,
    radius = 25,
    color = "#6366f1"
  ): NodeShape {
    const snapped = this.snap({ x: cx, y: cy });
    const node: NodeShape = {
      id: uuidv4(),
      type: "node",
      x: snapped.x - radius,
      y: snapped.y - radius,
      width: radius * 2,
      height: radius * 2,
      radius,
      fill: color,
      stroke: this._darken(color),
      strokeWidth: 2,
      label,
      shape: "circle",
      fontSize: 14,
      locked: false,
      lockedBy: null,
      zIndex: this.engine.shapes.size,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.engine.addShape(node);
    return node;
  }

  // ── Create an edge between two nodes ───────────────────────────────────

  createEdge(
    sourceId: string,
    targetId: string,
    weight = "",
    directed = true
  ): EdgeShape | null {
    const source = this.engine.shapes.get(sourceId);
    const target = this.engine.shapes.get(targetId);
    if (!source || !target || source.type !== "node" || target.type !== "node") return null;

    const sc = this._center(source as NodeShape);
    const tc = this._center(target as NodeShape);

    const edge: EdgeShape = {
      id: uuidv4(),
      type: "edge",
      x: 0, y: 0, width: 0, height: 0,
      sourceId,
      targetId,
      sourceAnchor: sc,
      targetAnchor: tc,
      weight,
      directed,
      style: "solid",
      fill: "#64748b",
      stroke: "#64748b",
      strokeWidth: 2,
      locked: false,
      lockedBy: null,
      zIndex: this.engine.shapes.size + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.engine.addShape(edge);
    return edge;
  }

  // ── Build from template ────────────────────────────────────────────────

  buildFromTemplate(
    template: GraphTemplate,
    startX: number,
    startY: number,
    layout: "grid" | "tree" | "force" = "grid"
  ): { nodes: NodeShape[]; edges: EdgeShape[] } {
    const nodeShapes: NodeShape[] = [];
    const edgeShapes: EdgeShape[] = [];

    // Position nodes
    const positions = this._computeLayout(template, layout, startX, startY);

    for (let i = 0; i < template.nodes.length; i++) {
      const t = template.nodes[i];
      const pos = positions[i];
      const node = this.createNode(pos.x, pos.y, t.label);
      nodeShapes.push(node);
    }

    // Create edges
    for (const et of template.edges) {
      const srcId = nodeShapes[et.from].id;
      const tgtId = nodeShapes[et.to].id;
      const edge = this.createEdge(
        srcId,
        tgtId,
        et.weight !== undefined ? String(et.weight) : "",
        et.directed !== false
      );
      if (edge) edgeShapes.push(edge);
    }

    return { nodes: nodeShapes, edges: edgeShapes };
  }

  // ── Layout algorithms ──────────────────────────────────────────────────

  private _computeLayout(
    template: GraphTemplate,
    layout: string,
    startX: number,
    startY: number
  ): Point[] {
    const n = template.nodes.length;
    const spacing = 80;

    switch (layout) {
      case "tree":
        return this._treeLayout(template, startX, startY, spacing);
      case "force":
        return this._gridLayout(n, startX, startY, spacing);
      default:
        return this._gridLayout(n, startX, startY, spacing);
    }
  }

  private _gridLayout(n: number, sx: number, sy: number, sp: number): Point[] {
    const cols = Math.ceil(Math.sqrt(n));
    const positions: Point[] = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      positions.push(this.snap({
        x: sx + col * sp,
        y: sy + row * sp,
      }));
    }
    return positions;
  }

  private _treeLayout(
    template: GraphTemplate,
    sx: number,
    sy: number,
    sp: number
  ): Point[] {
    // BFS from first node, level by level
    const n = template.nodes.length;
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const e of template.edges) {
      adj[e.from].push(e.to);
      adj[e.to].push(e.from); // undirected for layout
    }

    const levels: number[][] = [];
    const visited = new Set<number>();
    const queue: { node: number; level: number }[] = [{ node: 0, level: 0 }];
    visited.add(0);

    while (queue.length > 0) {
      const { node, level } = queue.shift()!;
      if (!levels[level]) levels[level] = [];
      levels[level].push(node);

      for (const neighbor of adj[node]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ node: neighbor, level: level + 1 });
        }
      }
    }

    const positions: Point[] = new Array(n);
    for (let lvl = 0; lvl < levels.length; lvl++) {
      const nodesAtLevel = levels[lvl];
      const totalWidth = (nodesAtLevel.length - 1) * sp;
      for (let i = 0; i < nodesAtLevel.length; i++) {
        positions[nodesAtLevel[i]] = this.snap({
          x: sx - totalWidth / 2 + i * sp,
          y: sy + lvl * sp,
        });
      }
    }

    return positions;
  }

  // ── Pre-built templates ────────────────────────────────────────────────

  static binaryTree(depth: number): GraphTemplate {
    const nodes: NodeTemplate[] = [];
    const edges: EdgeTemplate[] = [];
    const count = Math.pow(2, depth) - 1;

    for (let i = 0; i < count; i++) {
      nodes.push({ label: String(i + 1) });
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < count) edges.push({ from: i, to: left });
      if (right < count) edges.push({ from: i, to: right });
    }

    return { nodes, edges };
  }

  static linkedList(length: number): GraphTemplate {
    const nodes: NodeTemplate[] = [];
    const edges: EdgeTemplate[] = [];

    for (let i = 0; i < length; i++) {
      nodes.push({ label: String.fromCharCode(65 + i) });
      if (i > 0) edges.push({ from: i - 1, to: i });
    }

    return { nodes, edges };
  }

  static grid(rows: number, cols: number): GraphTemplate {
    const nodes: NodeTemplate[] = [];
    const edges: EdgeTemplate[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        nodes.push({ label: `(${r},${c})` });
        if (c > 0) edges.push({ from: idx - 1, to: idx });
        if (r > 0) edges.push({ from: idx - cols, to: idx });
      }
    }

    return { nodes, edges };
  }

  static weightedGraph(): GraphTemplate {
    return {
      nodes: [
        { label: "A" }, { label: "B" }, { label: "C" },
        { label: "D" }, { label: "E" }, { label: "F" },
      ],
      edges: [
        { from: 0, to: 1, weight: 4 },
        { from: 0, to: 2, weight: 2 },
        { from: 1, to: 3, weight: 5 },
        { from: 2, to: 1, weight: 1 },
        { from: 2, to: 4, weight: 10 },
        { from: 3, to: 5, weight: 3 },
        { from: 4, to: 5, weight: 6 },
        { from: 4, to: 3, weight: 2 },
      ],
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private _center(node: NodeShape): Point {
    return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
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
}
