/**
 * ThrottledBuffer — CJS export for Node.js tests
 * (Identical logic to client/throttled-buffer.ts)
 */

class ThrottledBuffer {
  constructor(intervalMs, flushFn) {
    this.buffer = new Map();
    this.intervalMs = intervalMs;
    this.flushFn = flushFn;
    this.timer = null;
    this._flushCount = 0;
    this._dropCount = 0;
  }

  push(key, value) {
    if (this.buffer.has(key)) this._dropCount++;
    this.buffer.set(key, value);
  }

  start() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this._flush(), this.intervalMs);
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  flush() { this._flush(); }

  _flush() {
    if (this.buffer.size === 0) return;
    const snapshot = new Map(this.buffer);
    this.buffer.clear();
    this._flushCount++;
    this.flushFn(snapshot);
  }

  get pending() { return this.buffer.size; }
  get flushCount() { return this._flushCount; }
  get dropCount() { return this._dropCount; }
  get running() { return this.timer !== null; }

  setIntervalMs(ms) {
    this.intervalMs = ms;
    if (this.timer !== null) { this.stop(); this.start(); }
  }
}

module.exports = { ThrottledBuffer };
