/**
 * Fibonacci-Filtered Heartbeat Scheduler
 *
 * Delivers progress updates at Fibonacci-spaced intervals (in seconds):
 *   beat 0: instant ack ("..." indicator)
 *   beat 1: 1s, beat 2: 2s, beat 3: 4s, beat 4: 7s, beat 5: 12s,
 *   beat 6: 20s, beat 7: 33s, beat 8: 54s, beat 9: 88s
 *
 * The intervals follow cumulative Fibonacci: 1, 1, 2, 3, 5, 8, 13, 21, 34
 * so the absolute times are:        1, 2, 4, 7, 12, 20, 33, 54, 88
 */

// Fibonacci deltas (seconds between consecutive beats)
const FIBONACCI_DELTAS = [1, 1, 2, 3, 5, 8, 13, 21, 34];

// Pre-computed absolute beat times (cumulative sums of deltas)
const FIBONACCI_BEATS = [];
let cumulative = 0;
for (const delta of FIBONACCI_DELTAS) {
  cumulative += delta;
  FIBONACCI_BEATS.push(cumulative);
}
// FIBONACCI_BEATS = [1, 2, 4, 7, 12, 20, 33, 54, 88]

/**
 * Get the Fibonacci beat schedule (absolute seconds from start).
 * @returns {number[]} Array of beat times in seconds: [1, 2, 4, 7, 12, 20, 33, 54, 88]
 */
export function getBeatSchedule() {
  return [...FIBONACCI_BEATS];
}

/**
 * Get the Fibonacci deltas between beats.
 * @returns {number[]} Array of deltas in seconds: [1, 1, 2, 3, 5, 8, 13, 21, 34]
 */
export function getBeatDeltas() {
  return [...FIBONACCI_DELTAS];
}

/**
 * Determine which beat index a given elapsed time (seconds) falls into.
 * Returns -1 if before first beat, or the index of the most recent beat.
 * @param {number} elapsedSeconds — seconds since task started
 * @returns {number} beat index (0-8) or -1 if before first beat
 */
export function getCurrentBeat(elapsedSeconds) {
  let beat = -1;
  for (let i = 0; i < FIBONACCI_BEATS.length; i++) {
    if (elapsedSeconds >= FIBONACCI_BEATS[i]) {
      beat = i;
    } else {
      break;
    }
  }
  return beat;
}

/**
 * Get the next beat time after the given elapsed seconds.
 * Returns null if all beats have passed.
 * @param {number} elapsedSeconds
 * @returns {{ beatIndex: number, beatTime: number, delayMs: number } | null}
 */
export function getNextBeat(elapsedSeconds) {
  for (let i = 0; i < FIBONACCI_BEATS.length; i++) {
    if (FIBONACCI_BEATS[i] > elapsedSeconds) {
      return {
        beatIndex: i,
        beatTime: FIBONACCI_BEATS[i],
        delayMs: (FIBONACCI_BEATS[i] - elapsedSeconds) * 1000,
      };
    }
  }
  return null;
}

// --- Heartbeat Status Types ---

export const HeartbeatType = {
  ACK: 'ack',           // Instant acknowledgment (beat 0)
  PROGRESS: 'progress', // Fibonacci-interval progress update
  COMPLETE: 'complete', // Final completion notification
  ERROR: 'error',       // Error during processing
};

/**
 * Create a heartbeat entry for storage in the agent registry.
 * @param {object} options
 * @param {string} options.agentId — agent identifier
 * @param {string} options.type — HeartbeatType value
 * @param {number} options.beatIndex — which Fibonacci beat (-1 for ack, 0-8 for progress)
 * @param {string} options.message — human-readable status message
 * @param {object} [options.metadata] — optional structured data (progress %, phase, etc.)
 * @returns {object} heartbeat record
 */
export function createHeartbeat({ agentId, type, beatIndex, message, metadata }) {
  return {
    agentId,
    type,
    beatIndex: beatIndex ?? -1,
    beatTime: beatIndex >= 0 && beatIndex < FIBONACCI_BEATS.length
      ? FIBONACCI_BEATS[beatIndex]
      : 0,
    message,
    metadata: metadata || {},
    timestamp: new Date().toISOString(),
  };
}

/**
 * FibonacciHeartbeat — manages heartbeat scheduling for a single task.
 *
 * Usage:
 *   const hb = new FibonacciHeartbeat(agentId, onHeartbeat);
 *   hb.start();          // sends instant ack, schedules Fibonacci beats
 *   hb.update(message);  // update the message for the next beat
 *   hb.complete(result); // sends final notification, stops scheduling
 *   hb.error(message);   // sends error notification, stops scheduling
 */
export class FibonacciHeartbeat {
  /**
   * @param {string} agentId
   * @param {function} onHeartbeat — callback receiving heartbeat records
   */
  constructor(agentId, onHeartbeat) {
    this.agentId = agentId;
    this.onHeartbeat = onHeartbeat;
    this.startTime = null;
    this.currentBeat = -1;
    this.timer = null;
    this.stopped = false;
    this.pendingMessage = null;
    this.history = [];
  }

  /**
   * Start the heartbeat — sends instant ack and schedules Fibonacci beats.
   * @param {string} [ackMessage='...'] — initial acknowledgment message
   */
  start(ackMessage = '...') {
    this.startTime = Date.now();
    this.stopped = false;

    // Beat 0: instant ack
    const ack = createHeartbeat({
      agentId: this.agentId,
      type: HeartbeatType.ACK,
      beatIndex: -1,
      message: ackMessage,
    });
    this._emit(ack);

    // Schedule first Fibonacci beat
    this._scheduleNext();
  }

  /**
   * Update the pending message for the next heartbeat.
   * @param {string} message
   * @param {object} [metadata]
   */
  update(message, metadata) {
    this.pendingMessage = { message, metadata };
  }

  /**
   * Send final completion heartbeat and stop scheduling.
   * @param {string} message — completion summary
   * @param {object} [metadata] — result data
   */
  complete(message, metadata) {
    this._stop();
    const hb = createHeartbeat({
      agentId: this.agentId,
      type: HeartbeatType.COMPLETE,
      beatIndex: this.currentBeat + 1,
      message,
      metadata,
    });
    this._emit(hb);
  }

  /**
   * Send error heartbeat and stop scheduling.
   * @param {string} message — error description
   * @param {object} [metadata]
   */
  error(message, metadata) {
    this._stop();
    const hb = createHeartbeat({
      agentId: this.agentId,
      type: HeartbeatType.ERROR,
      beatIndex: this.currentBeat + 1,
      message,
      metadata,
    });
    this._emit(hb);
  }

  /**
   * Get all heartbeat history for this task.
   * @returns {object[]}
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Get elapsed seconds since start.
   * @returns {number}
   */
  getElapsed() {
    if (!this.startTime) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  // --- Internal ---

  _emit(heartbeat) {
    this.history.push(heartbeat);
    if (this.onHeartbeat) {
      this.onHeartbeat(heartbeat);
    }
  }

  _stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _scheduleNext() {
    if (this.stopped) return;

    const elapsed = this.getElapsed();
    const next = getNextBeat(elapsed);

    if (!next) {
      // All beats exhausted — no more scheduling
      return;
    }

    this.timer = setTimeout(() => {
      if (this.stopped) return;
      this.currentBeat = next.beatIndex;

      const msg = this.pendingMessage
        ? this.pendingMessage.message
        : `Working... (${FIBONACCI_BEATS[next.beatIndex]}s)`;
      const meta = this.pendingMessage?.metadata;
      this.pendingMessage = null;

      const hb = createHeartbeat({
        agentId: this.agentId,
        type: HeartbeatType.PROGRESS,
        beatIndex: next.beatIndex,
        message: msg,
        metadata: meta,
      });
      this._emit(hb);

      // Schedule the next beat
      this._scheduleNext();
    }, next.delayMs);

    // Don't let the timer keep the process alive
    if (this.timer.unref) {
      this.timer.unref();
    }
  }
}

export default {
  getBeatSchedule,
  getBeatDeltas,
  getCurrentBeat,
  getNextBeat,
  createHeartbeat,
  HeartbeatType,
  FibonacciHeartbeat,
};
