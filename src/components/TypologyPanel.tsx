import { useMemo, useState } from "react";
import { allObjectsOf, useStore } from "../store";
import { getKnownFields } from "../lib/fieldCatalog";
import { proposeTypology, type TypologyProperty } from "../lib/collectionTypology";
import { ClassifierUnavailable, suggestTaxonomy, toFacetFields } from "../lib/classifier";
import { norm } from "../lib/textNorm";
import type { DesignObject, FacetField } from "../types";

/**
 * "What does this collection actually mean?" — asked at the moment it's
 * made, because that's the moment the answer is clearest.
 *
 * There are three honest answers, and conflating them was the bug (Samuel,
 * 2026-07-21, on the New Topographics case):
 *
 *   SELECTION  Just things I put together. Touches nothing.
 *   QUALITY    New Topographics, Bauhaus, Architecture — these things
 *              SHARE this. Becomes a property value; they stay
 *              photographs.
 *   KIND       Typeface, Photograph, Book — these things ARE this.
 *              Becomes an entity type.
 *
 * The first version offered only KIND, which is how a photography movement
 * was about to become a species and take forty-seven photographs out of
 * being photographs. Most collections are qualities or selections; kinds
 * are the rare case, and the order here says so.
 *
 * All three are reversible: kind via undo / rename / merge / demote,
 * quality via undo or removing the value, selection because it does
 * nothing at all.
 */

export type CollectionMeaning =
  | { kind: "selection" }
  | { kind: "type"; name: string; fields: FacetField[] }
  | { kind: "quality"; property: string; value: string };

/** Properties a shared quality usually belongs to — a starting point, not
 * a constraint: the field is free text. */
const QUALITY_PROPERTIES = ["Movement", "Style", "Subject", "Era", "Theme", "Project"];

export function TypologyPanel({
  collectionName,
  members,
  onApply,
}: {
  collectionName: string;
  members: DesignObject[];
  onApply: (meaning: CollectionMeaning) => void;
}) {
  const roles = useStore((s) => s.roles);
  const collections = useStore((s) => s.collections);
  const objects = useStore((s) => s.objects);

  const [meaning, setMeaning] = useState<"selection" | "quality" | "type">("selection");
  const [nameDraft, setNameDraft] = useState("");
  const [qualityProperty, setQualityProperty] = useState("Movement");
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [aiFields, setAiFields] = useState<FacetField[]>([]);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const proposal = useMemo(() => {
    if (members.length === 0) return null;
    return proposeTypology({
      collectionName,
      members,
      roles,
      archive: allObjectsOf(objects),
      knownFields: getKnownFields(collections, roles),
    });
  }, [collectionName, members, roles, objects, collections]);

  const selected = chosen ?? new Set((proposal?.properties ?? []).map((p) => p.field.name));
  const label = (nameDraft || collectionName).trim();

  /** What the members already are — the reason QUALITY is usually the
   * truer answer: if they're all photographs, this collection is a thing
   * ABOUT them, not a replacement for what they are. */
  const presentKinds = proposal?.replaces ?? [];

  function publish(
    next: "selection" | "quality" | "type" = meaning,
    nextLabel = label,
    nextSelected = selected,
    nextAi = aiFields,
    nextProperty = qualityProperty
  ) {
    if (next === "selection" || !proposal) {
      onApply({ kind: "selection" });
      return;
    }
    if (next === "quality") {
      onApply({ kind: "quality", property: nextProperty.trim(), value: nextLabel });
      return;
    }
    const fromProposal = proposal.properties
      .filter((p) => nextSelected.has(p.field.name))
      .map((p) => p.field);
    const have = new Set(fromProposal.map((f) => norm(f.name)));
    onApply({
      kind: "type",
      name: nextLabel,
      fields: [
        ...fromProposal,
        ...nextAi.filter((f) => nextSelected.has(f.name) && !have.has(norm(f.name))),
      ],
    });
  }

  async function askClassifier() {
    setAsking(true);
    setAiError(null);
    try {
      const suggestion = await suggestTaxonomy({
        typeName: label,
        members,
        existingProperties: (proposal?.properties ?? []).map((p) => p.field.name),
      });
      const fields = toFacetFields(suggestion, members);
      if (fields.length === 0) {
        setAiError("Nothing it could defend from these words — nothing added.");
      }
      setAiFields(fields);
      const next = new Set(selected);
      for (const f of fields) next.add(f.name);
      setChosen(next);
      publish(meaning, label, next, fields);
    } catch (err) {
      setAiError(
        err instanceof ClassifierUnavailable
          ? err.message
          : (err as Error).message || "The classifier failed."
      );
    } finally {
      setAsking(false);
    }
  }

  if (!proposal || members.length === 0) return null;

  const optionClass = (v: typeof meaning) =>
    [
      "px-2 py-0.5 rounded-md font-mono text-[11px] transition-colors",
      meaning === v ? "bg-ink text-white" : "text-muted hover:text-ink hover:bg-line/40",
    ].join(" ");

  return (
    // One line at rest, not three cards (Samuel, 2026-07-21: "this is
    // overcomplicated"). The question is worth asking; three paragraphs of
    // explanation for a question with three one-word answers was not. Each
    // answer explains itself only once chosen, and "just a selection" —
    // the default and the common case — has nothing to explain at all.
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          This is
        </span>
        <button
          onClick={() => {
            setMeaning("selection");
            publish("selection");
          }}
          className={optionClass("selection")}
        >
          a selection
        </button>
        <button
          onClick={() => {
            setMeaning("quality");
            publish("quality");
          }}
          className={optionClass("quality")}
        >
          something they share
        </button>
        <button
          onClick={() => {
            setMeaning("type");
            publish("type");
          }}
          className={optionClass("type")}
        >
          a kind of thing
        </button>
      </div>

      {meaning === "quality" && (
        <div className="mt-2 flex flex-wrap items-baseline gap-1.5 font-mono text-[12px]">
          <span className="text-muted/70">they all share the</span>
          <input
            list="quality-properties"
            value={qualityProperty}
            onChange={(e) => {
              setQualityProperty(e.target.value);
              publish("quality", label, selected, aiFields, e.target.value);
            }}
            placeholder="movement"
            className="w-28 bg-transparent border-b border-line focus:border-accent outline-none"
          />
          <datalist id="quality-properties">
            {QUALITY_PROPERTIES.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <input
            value={nameDraft || collectionName}
            onChange={(e) => {
              setNameDraft(e.target.value);
              publish("quality", e.target.value);
            }}
            placeholder="value"
            className="w-40 bg-transparent border-b border-line focus:border-accent outline-none"
          />
          <span className="text-[10px] text-muted/60">
            {members.length.toLocaleString()} items · they stay{" "}
            {presentKinds.length > 0
              ? presentKinds.map((k) => k.name.toLowerCase()).join(" / ")
              : "what they are"}
          </span>
        </div>
      )}

      {meaning === "type" && (
        <div className="mt-2 space-y-2">
          <input
            value={nameDraft || proposal.name}
            onChange={(e) => {
              setNameDraft(e.target.value);
              publish("type", e.target.value);
            }}
            placeholder="Name this kind…"
            className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />

          {presentKinds.length > 0 && (
            <p className="font-mono text-[10px] text-muted leading-relaxed">
              Replaces {presentKinds.map((r) => `${r.name.toLowerCase()} ${r.count}`).join(" · ")}{" "}
              — their properties are kept below. If these things are still photographs,
              "Something they share" is the truer answer.
            </p>
          )}

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">
              What's worth knowing about them
            </div>
            {proposal.properties.length === 0 && aiFields.length === 0 ? (
              <p className="font-mono text-[11px] text-muted/80">
                Nothing counting can defend here — ask below, or add properties later with
                + Property.
              </p>
            ) : (
              <div className="space-y-0.5">
                {aiFields.map((f) => (
                  <PropertyRow
                    key={f.name}
                    property={{
                      field: f,
                      source: "derived",
                      sampleValues: (f.options ?? []).slice(0, 6),
                      wouldFill: 0,
                    }}
                    checked={selected.has(f.name)}
                    onToggle={() => {
                      const next = new Set(selected);
                      if (next.has(f.name)) next.delete(f.name);
                      else next.add(f.name);
                      setChosen(next);
                      publish("type", label, next);
                    }}
                  />
                ))}
                {proposal.properties.map((p) => (
                  <PropertyRow
                    key={p.field.name}
                    property={p}
                    checked={selected.has(p.field.name)}
                    onToggle={() => {
                      const next = new Set(selected);
                      if (next.has(p.field.name)) next.delete(p.field.name);
                      else next.add(p.field.name);
                      setChosen(next);
                      publish("type", label, next);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="pt-1 border-t border-line/60">
            <button
              onClick={askClassifier}
              disabled={asking}
              className="font-mono text-[11px] text-accent/85 hover:text-accent hover:underline decoration-dotted underline-offset-2 disabled:opacity-50"
              title="Reads only these items' words — one request, no images, no ids"
            >
              {asking ? "reading your words…" : "ask what else is worth knowing"}
            </button>
            {aiError && (
              <p className="mt-1 font-mono text-[10px] text-muted leading-relaxed">{aiError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<TypologyProperty["source"], string> = {
  inherited: "already theirs",
  archive: "you use this elsewhere",
  derived: "suggested",
};

function PropertyRow({
  property,
  checked,
  onToggle,
}: {
  property: TypologyProperty;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={[
        "w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg border transition-colors",
        checked ? "border-accent/40 bg-accent/5" : "border-transparent hover:bg-line/25",
      ].join(" ")}
    >
      <span
        className={[
          "shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px]",
          checked ? "bg-ink border-ink text-white" : "border-line",
        ].join(" ")}
        aria-hidden
      >
        {checked ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink">
          {property.field.name}{" "}
          <span className="font-mono text-[10px] text-muted/70">
            · {SOURCE_LABEL[property.source]}
            {property.wouldFill > 0 && ` · ${property.wouldFill} already set`}
          </span>
        </span>
        {property.sampleValues.length > 0 && (
          <span className="block font-mono text-[10px] text-muted/80 truncate">
            {property.sampleValues.join(" · ")}
          </span>
        )}
      </span>
    </button>
  );
}
