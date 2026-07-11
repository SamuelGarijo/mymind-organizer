import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  evaluateCondition,
  evaluateGroup,
  fieldsContainingValue,
  groupField,
  groupNameFromField,
  isGroupField,
} from "../lib/ruleEngine";
import { makeId } from "../lib/id";
import type { DesignObject, FilterCondition, FilterOperator, TagGroups } from "../types";

type Row = FilterCondition;

function newRow(): Row {
  return { kind: "condition", id: makeId("cond"), field: "tag", operator: "includes", value: "" };
}

function operatorsFor(field: string): { value: FilterOperator; label: string }[] {
  if (field === "text") return [{ value: "contains", label: "contains" }];
  if (field === "tag" || isGroupField(field))
    return [
      { value: "includes", label: "is exactly" },
      { value: "contains", label: "contains" },
      { value: "notEquals", label: "is not" },
    ];
  return [
    { value: "equals", label: "equals" },
    { value: "contains", label: "contains" },
    { value: "notEquals", label: "does not equal" },
  ];
}

function fieldLabel(field: string): string {
  if (field === "tag") return "tag";
  if (isGroupField(field)) return `${groupNameFromField(field)} tag`;
  return field;
}

/** Distinct existing values for a given condition field, so the value input
 * can suggest real data instead of the user guessing (and typing a value
 * that actually lives under a different field — the "Swiss" tag/style mixup). */
function valuesForField(objects: DesignObject[], field: string, tagGroups: TagGroups): string[] {
  const set = new Set<string>();
  if (field === "text") return [];
  if (field === "tag") {
    for (const obj of objects) for (const t of obj.tags) set.add(t);
  } else if (isGroupField(field)) {
    const groupName = groupNameFromField(field);
    for (const obj of objects) {
      for (const t of obj.tags) {
        if (tagGroups[t.trim().toLowerCase()] === groupName) set.add(t);
      }
    }
  } else {
    for (const obj of objects) {
      const v = obj.fields[field];
      if (Array.isArray(v)) {
        for (const one of v) set.add(one);
      } else if (v) {
        set.add(v);
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function SmartCollectionModal({
  collectionId,
  onClose,
}: {
  collectionId?: string;
  onClose: () => void;
}) {
  const state = useStore();
  const existing =
    collectionId && state.collections[collectionId]?.type === "smart"
      ? state.collections[collectionId]
      : undefined;

  const [name, setName] = useState(existing?.type === "smart" ? existing.name : "");
  const [combinator, setCombinator] = useState<"AND" | "OR">(
    existing?.type === "smart" ? existing.rule.combinator : "AND"
  );
  const [rows, setRows] = useState<Row[]>(() => {
    if (existing?.type === "smart") {
      const flat = existing.rule.children.filter(
        (c): c is FilterCondition => c.kind === "condition"
      );
      return flat.length > 0 ? flat : [newRow()];
    }
    return [newRow()];
  });

  const allObjects = useMemo(() => Object.values(state.objects), [state.objects]);
  const tagGroups = state.tagGroups;

  const knownGroups = useMemo(
    () => Array.from(new Set(Object.values(tagGroups))).sort(),
    [tagGroups]
  );

  const customFieldOptions = useMemo(() => {
    const set = new Set<string>();
    for (const obj of allObjects) {
      for (const key of Object.keys(obj.fields)) set.add(key);
    }
    return Array.from(set);
  }, [allObjects]);

  const previewCount = useMemo(() => {
    const group = { kind: "group" as const, id: "preview", combinator, children: rows };
    return allObjects.filter((obj) => evaluateGroup(group, obj, tagGroups)).length;
  }, [rows, combinator, allObjects, tagGroups]);

  /** Per-row: how many objects match this single condition, and — if zero —
   * where else (which field/group) that exact value actually appears. */
  const rowDiagnostics = useMemo(() => {
    const map = new Map<string, { count: number; elsewhere: { field: string; count: number }[] }>();
    for (const row of rows) {
      const value = row.value.trim();
      if (value === "") continue;
      const count = allObjects.filter((obj) => evaluateCondition(row, obj, tagGroups)).length;
      if (count > 0) {
        map.set(row.id, { count, elsewhere: [] });
        continue;
      }
      const tally = new Map<string, number>();
      for (const obj of allObjects) {
        for (const hitField of fieldsContainingValue(obj, value, tagGroups)) {
          if (hitField === row.field) continue;
          tally.set(hitField, (tally.get(hitField) ?? 0) + 1);
        }
      }
      map.set(row.id, {
        count: 0,
        elsewhere: Array.from(tally.entries())
          .map(([field, cnt]) => ({ field, count: cnt }))
          .sort((a, b) => b.count - a.count),
      });
    }
    return map;
  }, [rows, allObjects, tagGroups]);

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  function save() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const cleanRows = rows.filter((r) => r.value.trim() !== "");
    const rule = { kind: "group" as const, id: makeId("group"), combinator, children: cleanRows };
    if (existing) {
      state.updateSmartCollection(existing.id, trimmedName, rule);
    } else {
      const id = state.addSmartCollection(trimmedName, rule);
      state.setSelectedView({ kind: "collection", collectionId: id });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-lg p-5">
        <div className="text-sm font-medium mb-1">
          {existing ? "Edit smart collection" : "New smart collection"}
        </div>
        <p className="text-[12px] text-muted mb-3">
          A saved search. It fills itself and updates live as tags and fields change.
        </p>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Swiss serif posters"
          className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />

        <div className="mt-4 flex items-center gap-2 text-[12px]">
          <span className="text-muted">Match</span>
          <div className="inline-flex rounded-lg border border-line overflow-hidden">
            {(["AND", "OR"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCombinator(c)}
                className={[
                  "px-2.5 py-1",
                  combinator === c ? "bg-ink text-white" : "bg-panel hover:bg-line/40",
                ].join(" ")}
              >
                {c === "AND" ? "all" : "any"}
              </button>
            ))}
          </div>
          <span className="text-muted">of the following:</span>
        </div>

        <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
          {rows.map((row) => {
            const diagnostic = rowDiagnostics.get(row.id);
            const suggestions = valuesForField(allObjects, row.field, tagGroups);
            const datalistId = `values-${row.id}`;
            return (
              <div key={row.id}>
                <div className="flex items-center gap-1.5">
                  <select
                    value={row.field}
                    onChange={(e) => {
                      const field = e.target.value;
                      updateRow(row.id, {
                        field,
                        operator: operatorsFor(field)[0].value,
                      });
                    }}
                    className="rounded-lg border border-line px-2 py-1.5 text-sm bg-panel"
                  >
                    <optgroup label="Tags">
                      <option value="tag">Any tag</option>
                      {knownGroups.map((g) => (
                        <option key={g} value={groupField(g)}>
                          {g} tag
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Text">
                      <option value="text">Text search</option>
                    </optgroup>
                    {customFieldOptions.length > 0 && (
                      <optgroup label="Custom fields">
                        {customFieldOptions.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  <select
                    value={row.operator}
                    onChange={(e) =>
                      updateRow(row.id, { operator: e.target.value as FilterOperator })
                    }
                    disabled={row.field === "text"}
                    className="rounded-lg border border-line px-2 py-1.5 text-sm bg-panel disabled:opacity-50"
                  >
                    {operatorsFor(row.field).map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>

                  <input
                    value={row.value}
                    onChange={(e) => updateRow(row.id, { value: e.target.value })}
                    placeholder="value"
                    list={suggestions.length > 0 ? datalistId : undefined}
                    className="flex-1 min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  {suggestions.length > 0 && (
                    <datalist id={datalistId}>
                      {suggestions.map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                  )}

                  <button
                    onClick={() => removeRow(row.id)}
                    className="text-muted hover:text-ink px-1.5"
                    aria-label="Remove condition"
                  >
                    ×
                  </button>
                </div>

                {row.value.trim() !== "" &&
                  diagnostic &&
                  diagnostic.count === 0 &&
                  diagnostic.elsewhere.length > 0 && (
                    <p className="mt-1 ml-0.5 text-[11px] text-amber-700">
                      No items have {fieldLabel(row.field)} "{row.value.trim()}" — but{" "}
                      {diagnostic.elsewhere
                        .map((e) => `${e.count} under ${fieldLabel(e.field)}`)
                        .join(", ")}
                      . Switch the field above to match those.
                    </p>
                  )}
                {row.value.trim() !== "" &&
                  diagnostic &&
                  diagnostic.count === 0 &&
                  diagnostic.elsewhere.length === 0 && (
                    <p className="mt-1 ml-0.5 text-[11px] text-muted">
                      No items have {fieldLabel(row.field)} "{row.value.trim()}" anywhere yet.
                    </p>
                  )}
              </div>
            );
          })}
        </div>

        {knownGroups.length === 0 && (
          <p className="mt-2 text-[11px] text-muted/80">
            Tip: open an item's detail panel and give a tag a group (e.g. "Swiss" → "style") to
            filter by that group here.
          </p>
        )}

        <button
          onClick={() => setRows((rs) => [...rs, newRow()])}
          className="mt-2 text-[12px] text-accent hover:underline"
        >
          + Add condition
        </button>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] text-muted">
            {previewCount} item{previewCount === 1 ? "" : "s"} match right now
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-lg hover:bg-line/40 text-ink/70"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!name.trim()}
              className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-40"
            >
              {existing ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
