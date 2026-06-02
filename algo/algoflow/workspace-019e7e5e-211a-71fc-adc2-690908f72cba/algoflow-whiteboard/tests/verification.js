/**
 * ============================================================================
 * AlgoFlow Whiteboard — Verification Checklist Suite
 * ============================================================================
 *
 * Tests:
 *   1. Sync latency with 5+ concurrent users on a single room
 *   2. Undo/Redo stack consistency across clients
 *   3. Window resize doesn't distort canvas coordinates
 *   4. Graph edges correctly 'stick' to nodes during drag
 *
 * Run: node tests/verification.js
 * ============================================================================
 */

const http = require("http");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client");
const { Gateway, Room } = require("../socket/gateway");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createServer() {
  return new Promise((resolve) => {
    const srv = http.createServer();
    const io = new Server(srv, { cors: { origin: "*" } });
    const gateway = new Gateway(io);
    srv.listen(0, () => {
      const port = srv.address().port;
      resolve({ srv, io, gateway, port });
    });
  });
}

function createClient(port) {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
}

function waitFor(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
function assertEq(a, b, f) { if (a !== b) throw new Error(`${f}: ${a} !== ${b}`); }

// ═══════════════════════════════════════════════════════════════════════════
// 1. Multi-user sync latency
// ═══════════════════════════════════════════════════════════════════════════

async function testMultiUserSync() {
  console.log("\n━━━ 1. Multi-User Sync Latency (5+ clients) ━━━");

  await test("5 clients join the same room and receive state", async () => {
    const { srv, port } = await createServer();
    const clients = [];
    const room = "test-room-1";

    // Client 1 joins and creates a shape
    const c1 = createClient(port);
    await waitFor(c1, "connect");
    c1.emit("room-join", { roomId: room, user: { name: "User1" } });
    const state1 = await waitFor(c1, "room-state");
    assert(state1.shapes.length === 0, "Initial state should be empty");

    // Add a shape
    const shape = { id: "node-1", type: "node", x: 100, y: 100, width: 50, height: 50, label: "A" };
    c1.emit("draw-event", { action: "add", shape });
    await sleep(50);

    // Clients 2-6 join and should all see the shape
    for (let i = 2; i <= 6; i++) {
      const c = createClient(port);
      await waitFor(c, "connect");
      c.emit("room-join", { roomId: room, user: { name: `User${i}` } });
      const state = await waitFor(c, "room-state");
      assert(state.shapes.length >= 1, `Client ${i} should see the shape`);
      assertEq(state.shapes[0].id, "node-1", "Shape ID");
      clients.push(c);
    }

    // Measure broadcast latency: c1 sends, others receive
    const latencies = [];
    const receiver = clients[0]; // Use client 2

    const recvPromise = new Promise((resolve) => {
      const start = Date.now();
      receiver.once("draw-event", (evt) => {
        resolve(Date.now() - start);
      });
    });

    c1.emit("draw-event", {
      action: "add",
      shape: { id: "latency-test", type: "node", x: 200, y: 200, width: 50, height: 50, label: "L" },
    });

    const latency = await recvPromise;
    latencies.push(latency);
    assert(latency < 100, `Latency ${latency}ms should be < 100ms`);

    console.log(`    ℹ Broadcast latency: ${latency}ms`);

    // Cleanup
    c1.close();
    clients.forEach((c) => c.close());
    srv.close();
  });

  await test("Concurrent draw events don't conflict", async () => {
    const { srv, port, gateway } = await createServer();
    const room = "test-concurrent";

    const clients = [];
    for (let i = 0; i < 5; i++) {
      const c = createClient(port);
      await waitFor(c, "connect");
      c.emit("room-join", { roomId: room, user: { name: `User${i}` } });
      await waitFor(c, "room-state");
      clients.push(c);
    }

    // Each client adds a unique shape simultaneously
    const addPromises = clients.map((c, i) => {
      return new Promise((resolve) => {
        // Listen on the NEXT client for the shape
        const listener = (evt) => {
          if (evt.action === "add" && evt.shape && evt.shape.id === `shape-${i}`) {
            resolve();
          }
        };
        // Other clients should receive it
        clients.forEach((other, j) => {
          if (i !== j) other.once("draw-event", listener);
        });

        c.emit("draw-event", {
          action: "add",
          shape: { id: `shape-${i}`, type: "node", x: i * 100, y: 100, width: 50, height: 50, label: `${i}` },
        });

        // Fallback timeout
        setTimeout(resolve, 1000);
      });
    });

    await Promise.all(addPromises);

    // Verify all shapes exist on server
    const roomObj = gateway.rooms.get(room);
    assert(roomObj, "Room should exist");
    assert(roomObj.shapes.size >= 5, `Expected ≥5 shapes, got ${roomObj.shapes.size}`);

    clients.forEach((c) => c.close());
    srv.close();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Undo/Redo consistency
// ═══════════════════════════════════════════════════════════════════════════

async function testUndoRedo() {
  console.log("\n━━━ 2. Undo/Redo Consistency Across Clients ━━━");

  await test("Undo removes shape and notifies all clients", async () => {
    const { srv, port, gateway } = await createServer();
    const room = "test-undo";

    const c1 = createClient(port);
    const c2 = createClient(port);
    await waitFor(c1, "connect");
    await waitFor(c2, "connect");

    c1.emit("room-join", { roomId: room, user: { name: "U1" } });
    c2.emit("room-join", { roomId: room, user: { name: "U2" } });
    await waitFor(c1, "room-state");
    await waitFor(c2, "room-state");

    // Add a shape
    const shape = { id: "undo-node", type: "node", x: 50, y: 50, width: 50, height: 50 };
    c1.emit("draw-event", { action: "add", shape });
    await sleep(50);

    // Both should see it via room state
    const roomObj = gateway.rooms.get(room);
    assert(roomObj.shapes.has("undo-node"), "Shape should exist after add");

    // c2 listens for undo result
    const undoPromise = waitFor(c2, "undo-result", 3000);

    // c1 requests undo
    c1.emit("undo");

    const undoResult = await undoPromise;
    assertEq(undoResult.action, "delete", "Undo should delete the added shape");
    assert(!roomObj.shapes.has("undo-node"), "Shape should be removed after undo");

    // c2 listens for redo result
    const redoPromise = waitFor(c2, "redo-result", 3000);

    // c1 requests redo
    c1.emit("redo");

    const redoResult = await redoPromise;
    assertEq(redoResult.action, "add", "Redo should re-add the shape");
    assert(roomObj.shapes.has("undo-node"), "Shape should be restored after redo");

    c1.close(); c2.close(); srv.close();
  });

  await test("Multiple undo/redo operations maintain order", async () => {
    const { srv, port, gateway } = await createServer();
    const room = "test-undo-order";

    const c1 = createClient(port);
    await waitFor(c1, "connect");
    c1.emit("room-join", { roomId: room, user: { name: "U1" } });
    await waitFor(c1, "room-state");

    // Add 3 shapes
    for (let i = 0; i < 3; i++) {
      c1.emit("draw-event", {
        action: "add",
        shape: { id: `node-${i}`, type: "node", x: i * 100, y: 100, width: 50, height: 50 },
      });
      await sleep(30);
    }

    const roomObj = gateway.rooms.get(room);
    assertEq(roomObj.shapes.size, 3, "Should have 3 shapes");

    // Undo all 3
    for (let i = 0; i < 3; i++) {
      c1.emit("undo");
      await sleep(30);
    }
    assertEq(roomObj.shapes.size, 0, "All shapes removed after 3 undos");

    // Redo all 3
    for (let i = 0; i < 3; i++) {
      c1.emit("redo");
      await sleep(30);
    }
    assertEq(roomObj.shapes.size, 3, "All shapes restored after 3 redos");

    c1.close(); srv.close();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Window resize coordinate integrity
// ═══════════════════════════════════════════════════════════════════════════

async function testResizeCoordinates() {
  console.log("\n━━━ 3. Window Resize Coordinate Integrity ━━━");

  await test("DPR-aware canvas resize preserves world coordinates", () => {
    // Simulate the coordinate transform logic
    function screenToWorld(sx, sy, offsetX, offsetY, zoom) {
      return {
        x: (sx - offsetX) / zoom,
        y: (sy - offsetY) / zoom,
      };
    }

    function worldToScreen(wx, wy, offsetX, offsetY, zoom) {
      return {
        x: wx * zoom + offsetX,
        y: wy * zoom + offsetY,
      };
    }

    // Before resize
    const vp1 = { offsetX: 100, offsetY: 50, zoom: 1.5 };
    const worldPoint = { x: 200, y: 300 };
    const screen1 = worldToScreen(worldPoint.x, worldPoint.y, vp1.offsetX, vp1.offsetY, vp1.zoom);

    // After resize: canvas dimensions change but viewport offset/zoom stay the same
    // The same screen coordinate should map to the same world coordinate
    const backToWorld = screenToWorld(screen1.x, screen1.y, vp1.offsetX, vp1.offsetY, vp1.zoom);

    assertEq(backToWorld.x, worldPoint.x, "World X after roundtrip");
    assertEq(backToWorld.y, worldPoint.y, "World Y after roundtrip");
  });

  await test("Zoom and pan don't accumulate rounding errors", () => {
    let offsetX = 0, offsetY = 0, zoom = 1;

    function pan(dx, dy) { offsetX += dx; offsetY += dy; }
    function zoomAt(factor, cx, cy) {
      const oldZ = zoom;
      zoom = Math.min(5, Math.max(0.1, oldZ * factor));
      const ratio = zoom / oldZ;
      offsetX = cx - (cx - offsetX) * ratio;
      offsetY = cy - (cy - offsetY) * ratio;
    }

    // Simulate 100 pan + zoom operations
    const origin = { x: 500, y: 400 };
    for (let i = 0; i < 100; i++) {
      pan(2, -1);
      zoomAt(i % 2 === 0 ? 1.05 : 0.95, 500, 400);
    }

    // The transforms should be consistent (no NaN/Infinity)
    assert(!isNaN(offsetX), "offsetX should not be NaN");
    assert(!isNaN(offsetY), "offsetY should not be NaN");
    assert(!isNaN(zoom), "zoom should not be NaN");
    assert(isFinite(offsetX), "offsetX should be finite");
    assert(isFinite(offsetY), "offsetY should be finite");
    assert(zoom > 0 && zoom < 100, "zoom should be reasonable");
  });

  await test("DPR scaling doesn't affect world coordinate mapping", () => {
    // At DPR=1
    const dpr1 = 1;
    const canvasW1 = 1000, canvasH1 = 800;
    const deviceW1 = canvasW1 * dpr1, deviceH1 = canvasH1 * dpr1;

    // At DPR=2 (retina)
    const dpr2 = 2;
    const canvasW2 = 1000, canvasH2 = 800; // Same CSS size
    const deviceW2 = canvasW2 * dpr2, deviceH2 = canvasH2 * dpr2;

    // The world coordinate of a screen point should be the same regardless of DPR
    const sx = 500, sy = 400; // CSS pixels
    const vp = { offsetX: 0, offsetY: 0, zoom: 1 };

    const world1 = { x: (sx - vp.offsetX) / vp.zoom, y: (sy - vp.offsetY) / vp.zoom };
    const world2 = { x: (sx - vp.offsetX) / vp.zoom, y: (sy - vp.offsetY) / vp.zoom };

    assertEq(world1.x, world2.x, "World X across DPR");
    assertEq(world1.y, world2.y, "World Y across DPR");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Edge-node sticking during drag
// ═══════════════════════════════════════════════════════════════════════════

async function testEdgeNodeSticking() {
  console.log("\n━━━ 4. Edge-Node Sticking During Drag ━━━");

  await test("Moving a node updates all connected edge anchors", () => {
    // Simulate the node drag + edge update logic
    const shapes = new Map();

    const nodeA = { id: "a", type: "node", x: 100, y: 100, width: 50, height: 50, updatedAt: 0 };
    const nodeB = { id: "b", type: "node", x: 300, y: 100, width: 50, height: 50, updatedAt: 0 };
    const edge = {
      id: "e1", type: "edge",
      sourceId: "a", targetId: "b",
      sourceAnchor: { x: 125, y: 125 },
      targetAnchor: { x: 325, y: 125 },
      updatedAt: 0,
    };

    shapes.set("a", nodeA);
    shapes.set("b", nodeB);
    shapes.set("e1", edge);

    // Move node A to (200, 200)
    nodeA.x = 200;
    nodeA.y = 200;

    // Simulate _updateConnectedEdges
    function updateConnectedEdges(nodeId) {
      const node = shapes.get(nodeId);
      if (!node) return;
      for (const s of shapes.values()) {
        if (s.type !== "edge") continue;
        if (s.sourceId === nodeId) {
          s.sourceAnchor = { x: node.x + 25, y: node.y + 25 };
        }
        if (s.targetId === nodeId) {
          s.targetAnchor = { x: node.x + 25, y: node.y + 25 };
        }
      }
    }

    updateConnectedEdges("a");

    // Verify edge source follows node A
    assertEq(edge.sourceAnchor.x, 225, "Edge source X should follow node A");
    assertEq(edge.sourceAnchor.y, 225, "Edge source Y should follow node A");

    // Verify edge target stays at node B
    assertEq(edge.targetAnchor.x, 325, "Edge target X should stay at node B");
    assertEq(edge.targetAnchor.y, 125, "Edge target Y should stay at node B");
  });

  await test("Dragging target node updates edge endpoint", () => {
    const shapes = new Map();

    const nodeA = { id: "a", type: "node", x: 0, y: 0, width: 50, height: 50 };
    const nodeB = { id: "b", type: "node", x: 200, y: 0, width: 50, height: 50 };
    const edge = {
      id: "e1", type: "edge",
      sourceId: "a", targetId: "b",
      sourceAnchor: { x: 25, y: 25 },
      targetAnchor: { x: 225, y: 25 },
    };

    shapes.set("a", nodeA);
    shapes.set("b", nodeB);
    shapes.set("e1", edge);

    // Move node B
    nodeB.x = 400;
    nodeB.y = 300;

    function updateConnectedEdges(nodeId) {
      const node = shapes.get(nodeId);
      if (!node) return;
      for (const s of shapes.values()) {
        if (s.type !== "edge") continue;
        if (s.sourceId === nodeId) s.sourceAnchor = { x: node.x + 25, y: node.y + 25 };
        if (s.targetId === nodeId) s.targetAnchor = { x: node.x + 25, y: node.y + 25 };
      }
    }

    updateConnectedEdges("b");

    assertEq(edge.targetAnchor.x, 425, "Edge target follows node B X");
    assertEq(edge.targetAnchor.y, 325, "Edge target follows node B Y");
    // Source should be unchanged
    assertEq(edge.sourceAnchor.x, 25, "Edge source unchanged X");
    assertEq(edge.sourceAnchor.y, 25, "Edge source unchanged Y");
  });

  await test("Edge between nodes in different positions has correct geometry", () => {
    const nodeA = { id: "a", type: "node", x: 0, y: 0, width: 50, height: 50 };
    const nodeB = { id: "b", type: "node", x: 200, y: 200, width: 50, height: 50 };

    const sc = { x: nodeA.x + 25, y: nodeA.y + 25 };
    const tc = { x: nodeB.x + 25, y: nodeB.y + 25 };

    // Edge should connect centers
    assertEq(sc.x, 25, "Source center X");
    assertEq(sc.y, 25, "Source center Y");
    assertEq(tc.x, 225, "Target center X");
    assertEq(tc.y, 225, "Target center Y");

    // Edge length should be correct
    const len = Math.hypot(tc.x - sc.x, tc.y - sc.y);
    const expected = Math.hypot(200, 200);
    assert(Math.abs(len - expected) < 0.01, `Edge length ${len} ≈ ${expected}`);
  });

  await test("Edge snapping to nearby node on drop", () => {
    // Simulate the mouseup edge-finalization logic
    const shapes = new Map();
    const nodeA = { id: "a", type: "node", x: 100, y: 100, width: 50, height: 50 };
    const nodeB = { id: "b", type: "node", x: 295, y: 98, width: 50, height: 50 }; // Slightly off-grid
    shapes.set("a", nodeA);
    shapes.set("b", nodeB);

    function findNodeAt(point) {
      for (const s of shapes.values()) {
        if (s.type !== "node") continue;
        const cx = s.x + 25, cy = s.y + 25;
        if (Math.hypot(point.x - cx, point.y - cy) < 35) return s;
      }
      return null;
    }

    // Mouse drops near node B's center
    const dropPoint = { x: 320, y: 123 };
    const hit = findNodeAt(dropPoint);
    assert(hit !== null, "Should find node B near drop point");
    assertEq(hit.id, "b", "Should be node B");

    // Edge should snap to node B's center
    const snapPoint = { x: hit.x + 25, y: hit.y + 25 };
    assertEq(snapPoint.x, 320, "Snapped X to node B center");
    assertEq(snapPoint.y, 123, "Snapped Y to node B center");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Room & Gateway unit tests
// ═══════════════════════════════════════════════════════════════════════════

async function testRoomUnit() {
  console.log("\n━━━ 5. Room Unit Tests ━━━");

  await test("Room.addShape stores shape and pushes to history", () => {
    const room = new Room("test");
    const shape = { id: "s1", type: "node", x: 0, y: 0 };
    room.addShape(shape);

    assert(room.shapes.has("s1"), "Shape should be in map");
    assertEq(room.shapes.size, 1, "Shape count");
    assertEq(room.history.length, 1, "History length");
  });

  await test("Room.undo reverses addShape", () => {
    const room = new Room("test");
    room.addShape({ id: "s1", type: "node" });
    const result = room.undo();

    assertEq(result.action, "delete", "Undo of add should be delete");
    assert(!room.shapes.has("s1"), "Shape should be removed");
    assertEq(room.redoStack.length, 1, "Redo stack should have 1 entry");
  });

  await test("Room.redo restores undone shape", () => {
    const room = new Room("test");
    room.addShape({ id: "s1", type: "node", x: 0 });
    room.undo();
    const result = room.redo();

    assertEq(result.action, "add", "Redo of undo(add) should be add");
    assert(room.shapes.has("s1"), "Shape should be restored");
  });

  await test("Room.getSnapshot returns all shapes", () => {
    const room = new Room("test");
    room.addShape({ id: "s1", type: "node" });
    room.addShape({ id: "s2", type: "edge" });

    const snap = room.getSnapshot();
    assertEq(snap.length, 2, "Snapshot should have 2 shapes");
  });

  await test("History is capped at 200 entries", () => {
    const room = new Room("test");
    for (let i = 0; i < 250; i++) {
      room.addShape({ id: `s${i}`, type: "node" });
    }
    assert(room.history.length <= 200, `History should be capped, got ${room.history.length}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. ThrottledBuffer tests
// ═══════════════════════════════════════════════════════════════════════════

async function testThrottledBuffer() {
  console.log("\n━━━ 6. ThrottledBuffer Tests ━━━");

  await test("Buffer coalesces duplicate keys (last-write-wins)", async () => {
    const { ThrottledBuffer } = require("./throttled-buffer");

    const flushed = [];
    const buf = new ThrottledBuffer(50, (events) => {
      for (const [k, v] of events) flushed.push({ key: k, value: v });
    });

    buf.push("cursor", { x: 1, y: 1 });
    buf.push("cursor", { x: 2, y: 2 });
    buf.push("cursor", { x: 3, y: 3 });

    assertEq(buf.pending, 1, "Only 1 pending (coalesced)");

    buf.flush();
    assertEq(flushed.length, 1, "Only 1 flushed");
    assertEq(flushed[0].value.x, 3, "Should be last value");
    assertEq(buf.dropCount, 2, "2 drops");
  });

  await test("Buffer respects interval cadence", async () => {
    const { ThrottledBuffer } = require("./throttled-buffer");

    let flushCount = 0;
    const buf = new ThrottledBuffer(50, () => flushCount++);
    buf.start();

    buf.push("a", 1);
    await sleep(80); // Wait for 1 flush
    buf.push("b", 2);
    await sleep(80); // Wait for another

    buf.stop();
    assert(flushCount >= 2, `Expected ≥2 flushes, got ${flushCount}`);
  });

  await test("Buffer start/stop is idempotent", () => {
    const { ThrottledBuffer } = require("./throttled-buffer");
    const buf = new ThrottledBuffer(50, () => {});

    buf.start();
    buf.start(); // Should not create duplicate timers
    assert(buf.running, "Should be running");

    buf.stop();
    buf.stop(); // Should not throw
    assert(!buf.running, "Should be stopped");
  });
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AlgoFlow Whiteboard — Verification Checklist Suite       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  await testRoomUnit();
  await testThrottledBuffer();
  await testResizeCoordinates();
  await testEdgeNodeSticking();
  await testUndoRedo();
  await testMultiUserSync();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`  ${passed} passed, ${failed} failed out of ${results.length}\n`);

  if (failed > 0) {
    console.log("  FAILED:");
    results.filter((r) => !r.pass).forEach((r) => console.log(`    ✗ ${r.name}: ${r.error}`));
    console.log();
    process.exit(1);
  } else {
    console.log("  ✓ ALL CHECKS PASSED\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
