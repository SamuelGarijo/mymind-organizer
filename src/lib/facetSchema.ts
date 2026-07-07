import type { FacetField, ManualCollection } from "../types";

/** Reads a collection's facet schema, transparently upgrading the legacy
 * `facetFields: string[]` shape (pre-typed-schema collections) into typed
 * fields defaulting to "text". Always use this instead of reading
 * `facetSchema` directly so older collections keep working. */
export function normalizeFacetSchema(collection: ManualCollection): FacetField[] {
  if (collection.facetSchema) return collection.facetSchema;
  if (collection.facetFields?.length) {
    return collection.facetFields.map((name) => ({ name, type: "text" as const }));
  }
  return [];
}
