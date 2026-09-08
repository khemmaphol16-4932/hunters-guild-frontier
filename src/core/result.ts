/**
 * Result<T, E> — explicit fallible operations.
 *
 * Used wherever a rule can legitimately reject an operation (illegal class advancement,
 * over-capacity loadout, incompatible skill). Throwing is reserved for programmer error
 * and data corruption; rule violations are values, because the AI and the UI both need
 * to ask "would this be allowed?" without exception handling.
 *
 * REQ-TEC-001 (systems must be independently testable), §134 (reasonable error handling).
 */

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}

/** Unwrap or throw. Only for call sites that have already proven the operation legal. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap() on an error Result: ${String(r.error)}`);
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export function mapResult<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}
