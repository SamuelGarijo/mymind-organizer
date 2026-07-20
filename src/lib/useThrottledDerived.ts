import { useRef } from "react";
import type { DesignObject } from "../types";

/**
 * Derives an expensive value (a Fuse index, a term-frequency table…) from
 * an object list with a REBUILD THROTTLE (perf maintenance, 2026-07-20).
 *
 * The problem it solves: content edits (a bound note's autosave, a
 * description keystroke committed on pause) replace the objects map — and
 * with it every derived list's identity — several times a minute, and an
 * identity-keyed memo dutifully re-ran a full ~8k-object pass each time.
 * The rebuilt value was indistinguishable from the stale one for its
 * consumers (search suggestions don't care about the sentence typed two
 * seconds ago), but the rebuild itself was a felt stutter.
 *
 * Rebuild rules:
 * - `key` changed (the caller's filter inputs) → immediately. Membership
 *   changes always ride on a filter change, so results are never wrong.
 * - list LENGTH changed (add/delete/sync) → immediately.
 * - same key, same length, new identity (content edit) → at most every
 *   30s.
 */
const REBUILD_INTERVAL_MS = 30_000;

export function useThrottledDerived<T>(
  list: DesignObject[],
  build: (list: DesignObject[]) => T,
  key = ""
): T {
  const ref = useRef<{ list: DesignObject[]; key: string; value: T; builtAt: number } | null>(null);
  const cached = ref.current;
  const now = Date.now();
  const mustRebuild =
    !cached ||
    cached.key !== key ||
    (cached.list !== list &&
      (cached.list.length !== list.length || now - cached.builtAt > REBUILD_INTERVAL_MS));
  if (mustRebuild) {
    ref.current = { list, key, value: build(list), builtAt: now };
  }
  return ref.current!.value;
}
