export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1 share of the delay that is randomized. */
  jitter?: number;
  random?: () => number;
}

/** Exponential backoff with jitter. attempt starts at 1. */
export function backoffMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 2_000;
  const max = opts.maxMs ?? 15 * 60_000;
  const jitter = opts.jitter ?? 0.2;
  const random = opts.random ?? Math.random;
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const spread = raw * jitter;
  return Math.round(raw - spread + random() * spread * 2);
}
