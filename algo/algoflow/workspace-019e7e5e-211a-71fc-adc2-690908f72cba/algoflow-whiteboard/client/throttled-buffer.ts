/**
 * ============================================================================
 * AlgoFlow Whiteboard — ThrottledBuffer
 * ============================================================================
 *
 * Buffers high-frequency events (cursor moves, shape updates) and flushes
 * them at a fixed cadence — 60 fps by default (≈16.67 ms per frame).
 *
 * Why buffered throttling instead of naive throttle:
 *   • Naive throttle drops events between ticks — you lose the LATEST position.
 *   • Buffered approach keeps only the most recent event per key, so the
 *     receiver always gets the freshest state on the next tick.
 *
 * Usage:
 *   const buf = new ThrottledBuffer<string, DrawEvent>(16.67, flushFn);
 *   buf.push("cursor-abc", { action: "update", ... });
 *   // On next frame tick: flushFn([ latest event for "cursor-abc" ])
 * ============================================================================
 */

export type FlushFn<K, V> = (events: Map<K, V>) => void;

export class ThrottledBuffer<K, V> {
  private buffer = new Map<K, V>();
  private intervalMs: number;
  private flushFn: FlushFn<K, V>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _flushCount = 0;
  private _dropCount = 0;

  /**
   * @param intervalMs  Flush interval in milliseconds (16.67 ≈ 60 fps)
   * @param flushFn     Called on each tick with the latest buffer snapshot
   */
  constructor(intervalMs: number, flushFn: FlushFn<K, V>) {
    this.intervalMs = intervalMs;
    this.flushFn = flushFn;
  }

  /**
   * Enqueue an event. If an event with the same key already exists in the
   * buffer, it is replaced (last-write-wins). This ensures we always send
   * the most recent state per entity.
   */
  push(key: K, value: V): void {
    if (this.buffer.has(key)) {
      this._dropCount++;
    }
    this.buffer.set(key, value);
  }

  /**
   * Start the periodic flush loop. Safe to call multiple times (idempotent).
   */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this._flush(), this.intervalMs);
  }

  /**
   * Stop flushing. Pending events are NOT discarded — call flush() manually
   * if you need to drain.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Immediately flush all buffered events and reset.
   */
  flush(): void {
    this._flush();
  }

  /**
   * Flush pending events. Internal.
   */
  private _flush(): void {
    if (this.buffer.size === 0) return;

    // Snapshot & clear
    const snapshot = new Map(this.buffer);
    this.buffer.clear();
    this._flushCount++;

    this.flushFn(snapshot);
  }

  /** Number of events currently buffered (not yet flushed). */
  get pending(): number {
    return this.buffer.size;
  }

  /** Total number of flush cycles completed. */
  get flushCount(): number {
    return this._flushCount;
  }

  /** Number of events that were deduplicated (replaced by newer). */
  get dropCount(): number {
    return this._dropCount;
  }

  /** Whether the flush timer is running. */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Change the flush interval at runtime (e.g., adapt to network conditions).
   */
  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.timer !== null) {
      this.stop();
      this.start();
    }
  }
}

/**
 * Convenience: create a cursor-specific ThrottledBuffer that merges all
 * buffered cursor events into a single Socket.io emit.
 */
export function createCursorBuffer(
  socket: { emit: (event: string, data: any) => void },
  intervalMs = 16.67
): ThrottledBuffer<string, { x: number; y: number }> {
  return new ThrottledBuffer(intervalMs, (events) => {
    // Only send the last cursor position (there's only one local user)
    for (const [_key, pos] of events) {
      socket.emit("cursor-move", pos);
    }
  });
}

/**
 * Convenience: create a draw-event ThrottledBuffer that batches shape updates.
 */
export function createDrawBuffer(
  socket: { emit: (event: string, data: any) => void },
  intervalMs = 16.67
): ThrottledBuffer<string, any> {
  return new ThrottledBuffer(intervalMs, (events) => {
    if (events.size === 1) {
      // Single event — send directly
      for (const [_key, event] of events) {
        socket.emit("draw-event", event);
      }
    } else {
      // Multiple events — batch
      const operations = Array.from(events.values());
      socket.emit("draw-event", {
        action: "batch",
        operations,
      });
    }
  });
}
