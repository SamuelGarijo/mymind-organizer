/** Case/whitespace-insensitive comparison key — split into its own module
 * (rather than living in ruleEngine.ts, its original home) so both
 * ruleEngine.ts and hybridSimilarity.ts can depend on it without a circular
 * import between those two (ruleEngine's smart-collection "similar to this
 * object" criterion calls into hybridSimilarity, which already used norm). */
export function norm(s: string): string {
  return s.trim().toLowerCase();
}
