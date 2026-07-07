/** Cosine similarity between two vectors — 1 = identical direction, 0 =
 * orthogonal, -1 = opposite. Entirely local; no network call, no dependency
 * on mymind's own similarTo/Mastermind-tier API. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Ranks candidates by similarity to `target`, most similar first. */
export function rankBySimilarity(
  target: number[],
  candidates: { id: string; embedding: number[] }[],
  limit = 60
): { id: string; score: number }[] {
  return candidates
    .map((c) => ({ id: c.id, score: cosineSimilarity(target, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
