/**
 * Seeded, splittable pseudo-random number generation.
 *
 * REQ-TEC-005 / risk R1. Every random draw in the game flows through one of these
 * streams. `Math.random()` is banned outside `debug/` and the ban is enforced by
 * tests/architecture.test.ts, because offline simulation (REQ-OFF-002) must reproduce
 * the same results as real-time play, and combat replay and balance simulation both
 * depend on being able to re-run an identical sequence.
 *
 * Streams are *split*, not shared: drawing loot must never shift the sequence that
 * recruitment sees, or a change to one system silently perturbs every other system's
 * history. `fork(label)` derives an independent child stream deterministically from
 * the parent seed and the label.
 *
 * Algorithm: xoshiro128** with splitmix32 seeding. Fast, well-distributed, and its
 * entire state is four uint32s — small enough to serialise into a save file verbatim
 * so an interrupted expedition resumes on exactly the same sequence.
 */

export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

export interface WeightedEntry<T> {
  readonly value: T;
  readonly weight: number;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p. */
  bool(p: number): boolean;
  /** Uniform choice. Returns undefined only for an empty array. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Weighted choice. Entries with weight <= 0 are never selected. */
  weighted<T>(entries: readonly WeightedEntry<T>[]): T | undefined;
  /** Deterministic independent child stream. */
  fork(label: string): Rng;
  /** Serialisable state, for save files and for resuming a simulation. */
  state(): RngState;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** FNV-1a. Used to turn a string seed or a fork label into a uint32. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

class Xoshiro128 implements Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: RngState) {
    this.s0 = state.s0 >>> 0;
    this.s1 = state.s1 >>> 0;
    this.s2 = state.s2 >>> 0;
    this.s3 = state.s3 >>> 0;
    // An all-zero state is a fixed point of xoshiro and would return zeros forever.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = 0x9e3779b9;
      this.s1 = 0x243f6a88;
      this.s2 = 0xb7e15162;
      this.s3 = 0x85a308d3;
    }
  }

  private nextUint32(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  next(): number {
    // 2^-32. Uniform in [0, 1).
    return this.nextUint32() * 2.3283064365386963e-10;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) return minInclusive;
    const span = Math.floor(maxExclusive) - Math.floor(minInclusive);
    return Math.floor(minInclusive) + Math.floor(this.next() * span);
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.int(0, items.length)];
  }

  weighted<T>(entries: readonly WeightedEntry<T>[]): T | undefined {
    let total = 0;
    for (const e of entries) {
      if (e.weight > 0) total += e.weight;
    }
    if (total <= 0) return undefined;
    let roll = this.next() * total;
    for (const e of entries) {
      if (e.weight <= 0) continue;
      roll -= e.weight;
      if (roll <= 0) return e.value;
    }
    // Floating-point tail: return the last positively-weighted entry.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e && e.weight > 0) return e.value;
    }
    return undefined;
  }

  fork(label: string): Rng {
    // Derive from current state AND the label, so forking twice with different labels
    // gives independent streams, and forking at different points in the parent's life
    // gives different streams.
    const mix = (hashString(label) ^ this.s0 ^ Math.imul(this.s3, 0x2545f491)) >>> 0;
    return createRngFromSeedNumber(mix);
  }

  state(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }
}

function createRngFromSeedNumber(seed: number): Rng {
  const gen = splitmix32(seed);
  return new Xoshiro128({ s0: gen(), s1: gen(), s2: gen(), s3: gen() });
}

/** Create a stream from a numeric or string seed. */
export function createRng(seed: number | string): Rng {
  const numeric = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  return createRngFromSeedNumber(numeric);
}

/** Restore a stream from serialised state — used by save/load and simulation resume. */
export function rngFromState(state: RngState): Rng {
  return new Xoshiro128(state);
}

/**
 * The named streams the game draws from. Splitting by purpose is what keeps a change
 * in one system from perturbing another system's history (REQ-TEC-005).
 */
export const RNG_STREAMS = [
  'loot',
  'recruit',
  'combat',
  'events',
  'crafting',
  'expedition',
  'refine',
  'world',
] as const;

export type RngStreamName = (typeof RNG_STREAMS)[number];

export type RngStreams = Readonly<Record<RngStreamName, Rng>>;

/** Build the full set of named streams from one world seed. */
export function createStreams(worldSeed: number | string): RngStreams {
  const root = createRng(worldSeed);
  const streams = {} as Record<RngStreamName, Rng>;
  for (const name of RNG_STREAMS) {
    streams[name] = root.fork(name);
  }
  return streams;
}
