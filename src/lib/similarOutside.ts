import { rankByHybridSimilarity } from "./hybridSimilarity";
import type { DesignObject } from "../types";

/**
 * "More like this collection, from OUTSIDE it" — a handful of spread-out
 * seeds from the collection's members, each ranked against the outside
 * pool with the hybrid engine (#23), merged by best score. Same
 * computation ClassifyPanel's similar-outside strip runs, extracted so the
 * bottom Discovery membrane (issue #134) is a second consumer of ONE
 * implementation, not a fork.
 */
export function computeSimilarOutside(
  members: DesignObject[],
  memberIds: Set<string>,
  allObjects: DesignObject[],
  limit = 14
): DesignObject[] {
  if (members.length === 0) return [];
  const step = Math.max(1, Math.floor(members.length / 5));
  const seeds = [0, 1, 2, 3, 4]
    .map((i) => members[i * step])
    .filter((o): o is DesignObject => Boolean(o));
  const candidates = allObjects.filter((o) => !memberIds.has(o.id));
  const best = new Map<string, number>();
  for (const seed of seeds) {
    for (const r of rankByHybridSimilarity(seed, candidates, allObjects, 30)) {
      if ((best.get(r.id) ?? 0) < r.score) best.set(r.id, r.score);
    }
  }
  const byId = new Map(candidates.map((o) => [o.id, o]));
  return Array.from(best.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id))
    .filter((o): o is DesignObject => Boolean(o));
}
