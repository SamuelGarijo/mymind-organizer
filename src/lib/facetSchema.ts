import type { FacetField, ManualCollection } from "../types";

/** Reads a collection's facet schema, transparently upgrading the legacy
 * `facetFields: string[]` shape (pre-typed-schema collections, predating
 * even "text" as a real field type) into typed fields — an empty-options
 * "select" is the closest current equivalent. Always use this instead of
 * reading `facetSchema` directly so older collections keep working. */
export function normalizeFacetSchema(collection: ManualCollection): FacetField[] {
  if (collection.facetSchema) return collection.facetSchema;
  if (collection.facetFields?.length) {
    return collection.facetFields.map((name) => ({ name, type: "select" as const, options: [] }));
  }
  return [];
}
