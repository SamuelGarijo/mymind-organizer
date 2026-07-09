import { useEffect, useState } from "react";

/**
 * Returns `value`, but only after it's stopped changing for `delayMs`.
 *
 * Deliberately NOT `useDeferredValue` here: that reprioritizes *when* React
 * schedules a re-render, but a single Fuse.search() call over ~8k objects is
 * a synchronous ~250-400ms operation — once started, nothing can interrupt
 * it, so deferring it doesn't make it cheaper, and during a fast typing
 * burst React can still end up running it once per intermediate keystroke
 * value rather than once for the whole burst. A debounce actually cuts the
 * number of searches run, which is what reduces total blocked time.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
