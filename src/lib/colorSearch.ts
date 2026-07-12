import { BLOB_PALETTE_KEY } from "./mymindSync";
import type { DesignObject } from "../types";

export type ColorFilter = { hex: string; tolerance: number };

/** Slider range for the tolerance control (issue #69) — 0 means "only an
 * exact color", 100 means "match anything" (a bit past the maximum possible
 * distance between two RGB colors, so it never excludes anything at max). */
export const TOLERANCE_MIN = 0;
export const TOLERANCE_MAX = 100;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Plain Euclidean distance in RGB space, normalized to 0-100 so it lines up
 * with the tolerance slider's own range — good enough for "is this close
 * enough" without pulling in a perceptual color-space library (that's the
 * kind of thing #62's research was actually scoping; not needed for a
 * tolerance slider over mymind's own already-computed palette). */
function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const maxDistance = Math.sqrt(3 * 255 * 255);
  const d = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  return (d / maxDistance) * 100;
}

/** True if any color in the object's mymind-provided palette is within
 * `tolerance` of the target hex — objects with no palette (non-image, or
 * synced before this field existed) never match, same as any other facet
 * an object simply doesn't carry. */
export function objectMatchesColor(object: DesignObject, filter: ColorFilter): boolean {
  const raw = object.fields[BLOB_PALETTE_KEY];
  if (typeof raw !== "string") return false;
  const target = hexToRgb(filter.hex);
  if (!target) return false;

  let palette: Record<string, number>;
  try {
    palette = JSON.parse(raw);
  } catch {
    return false;
  }

  return Object.keys(palette).some((hex) => {
    const rgb = hexToRgb(hex);
    return rgb ? colorDistance(rgb, target) <= filter.tolerance : false;
  });
}

export function applyColorFilter(
  objects: DesignObject[],
  filter: ColorFilter | null
): DesignObject[] {
  if (!filter) return objects;
  return objects.filter((o) => objectMatchesColor(o, filter));
}
