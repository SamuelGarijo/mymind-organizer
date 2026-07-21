import type { DesignObject, FacetField, RoleDefinition } from "../types";
import { CURATED_ROLE_FIELDS } from "./curatedRoleFields";
import { proposeOptionsFromMembers } from "./fieldExtraction";
import { norm } from "./textNorm";

/**
 * Making a collection is already an act of typology.
 *
 * Samuel, 2026-07-21: "el hecho de crear una colección ya está haciendo un
 * determinismo de tipología de las cosas que estoy ordenando. Si he creado
 * una colección de New Topographics, lo que tiene que hacer es asignar a
 * todos los objetos que están dentro una nueva tipología. Una nueva
 * tipología es una nueva manera de entender los objetos."
 *
 * That reframes where entity types come from. Until now they were
 * discovered statistically, from tag frequency — which is why an archive of
 * photographs ended up with "residentials", "urbans" and "germans" as
 * species. Curation is a far stronger signal than counting: deciding that
 * forty-seven things belong together IS recognising a kind, and you did it
 * on purpose.
 *
 * So this proposes, at the moment a collection is made:
 *   - the kind these things now are (the collection's own name);
 *   - what's worth knowing about them, in three honest tiers.
 *
 * It stays a proposal. Nothing here writes.
 */

export type TypologyPropertySource =
  /** A property the members' current entity types already carry — the
   * "obvious" ones Samuel asked to keep inheriting, so a New Topographics
   * photograph doesn't lose the fields it had as a Photo. */
  | "inherited"
  /** A property invented elsewhere in this archive that would actually
   * find values here — reusing your own vocabulary beats inventing more. */
  | "archive"
  /** Reserved for the classifier tier: a property proposed because
   * something read the archive and judged it worth knowing, rather than
   * counted it. Nothing produces this deterministically. */
  | "derived";

export type TypologyProperty = {
  field: FacetField;
  source: TypologyPropertySource;
  /** A taste of what it would hold — the reason to say yes. */
  sampleValues: string[];
  /** How many members would get a value straight away. */
  wouldFill: number;
};

export type TypologyProposal = {
  /** Suggested name for the kind — the collection's own name. */
  name: string;
  /** Entity types already present among the members, with counts: what
   * this typology would replace, and why nothing is lost (their fields are
   * offered back as "inherited"). */
  replaces: { name: string; count: number }[];
  properties: TypologyProperty[];
};

/** Property names that are bookkeeping rather than meaning — never worth
 * proposing as something to know about a kind of thing. */
const NOT_WORTH_ASKING = new Set(["file type", "format", "source", "orientation"].map(norm));

function countFilled(members: DesignObject[], fieldName: string): number {
  return members.filter((o) => {
    const v = o.fields[fieldName];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }).length;
}

export function proposeTypology({
  collectionName,
  members,
  roles,
  archive,
  knownFields,
}: {
  collectionName: string;
  members: DesignObject[];
  roles: Record<string, RoleDefinition>;
  /** The whole library — lift is measured against it. */
  archive: DesignObject[];
  /** Every field ever defined anywhere (lib/fieldCatalog). */
  knownFields: FacetField[];
}): TypologyProposal {
  const name = collectionName.trim();

  const roleCounts = new Map<string, number>();
  for (const o of members) {
    if (!o.role) continue;
    roleCounts.set(o.role, (roleCounts.get(o.role) ?? 0) + 1);
  }
  const replaces = Array.from(roleCounts.entries())
    .map(([n, count]) => ({ name: n, count }))
    .sort((a, b) => b.count - a.count);

  const proposed = new Map<string, TypologyProperty>();
  const consider = (field: FacetField, source: TypologyPropertySource) => {
    const key = norm(field.name);
    if (NOT_WORTH_ASKING.has(key)) return;
    if (proposed.has(key)) return;

    const already = countFilled(members, field.name);
    // Options either come with the field or are read out of the members'
    // own tags — a property offered with no vocabulary is a chore, not a
    // suggestion.
    const options =
      field.options?.length
        ? field.options
        : proposeOptionsFromMembers(members, archive, field.name, 10).map((v) => v.value);
    if (options.length === 0 && already === 0) return;

    proposed.set(key, {
      field: { ...field, options },
      source,
      sampleValues: options.slice(0, 6),
      wouldFill: already,
    });
  };

  // 1. Curated package when the collection's own name is a known kind.
  for (const field of CURATED_ROLE_FIELDS[norm(name)] ?? []) consider(field, "inherited");

  // 2. Inherit from what these things already are — the obvious ones.
  for (const { name: roleName } of replaces) {
    for (const field of roles[norm(roleName)]?.fields ?? []) consider(field, "inherited");
  }

  // 3. A property invented elsewhere in the archive that these members
  // ALREADY have values for. Evidence, not inference.
  //
  // An earlier version also proposed archive fields whose *vocabulary*
  // could be scraped from these members' tags, and it was nonsense —
  // measured on the real library it offered "Font Style: New
  // Topographics" and "Draws me in by: George Eastman Museum" for
  // photographs, because a distinctive tag says nothing about WHICH
  // property it belongs to. That mapping (this word is a value of that
  // property) is the semantic judgement statistics cannot make; it's the
  // classifier's job, entering through the same seam as everything else.
  for (const field of knownFields) {
    const key = norm(field.name);
    if (proposed.has(key) || NOT_WORTH_ASKING.has(key)) continue;
    if (countFilled(members, field.name) === 0) continue;
    consider(field, "archive");
  }

  return { name, replaces, properties: Array.from(proposed.values()) };
}
