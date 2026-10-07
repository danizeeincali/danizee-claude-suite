/**
 * Marathon context measurement
 * Reads token use from a Claude Code transcript and decides compact vs clear.
 */

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Measure context size from transcript JSONL text.
 * Uses the LAST assistant record that carries usage; unparsable lines are
 * skipped. Returns null when no such record exists.
 */
export function measureTranscript(text) {
  let usage = null;
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec && rec.type === 'assistant' && rec.message && rec.message.usage) {
      usage = rec.message.usage;
    }
  }
  if (!usage) return null;

  const input = num(usage.input_tokens);
  const cache_creation = num(usage.cache_creation_input_tokens);
  const cache_read = num(usage.cache_read_input_tokens);
  const output = num(usage.output_tokens);
  return { tokens: input + cache_creation + cache_read, input, cache_creation, cache_read, output };
}

/**
 * Context used as a percentage of the window (not rounded).
 */
export function contextPct(tokens, window) {
  return tokens / window * 100;
}

/**
 * 'clear' at/above clear_above_pct or when the stream finished,
 * 'compact' at/above prune_below_pct, otherwise 'none'.
 */
export function decide(pct, bcCfg, { streamFinished = false } = {}) {
  if (streamFinished || pct >= bcCfg.clear_above_pct) return 'clear';
  if (pct >= bcCfg.prune_below_pct) return 'compact';
  return 'none';
}
