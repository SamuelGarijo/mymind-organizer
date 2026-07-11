import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { norm } from "../lib/ruleEngine";
import { getKnownFields } from "../lib/fieldCatalog";
import type { FacetField, FacetFieldType } from "../types";

/** Classification field types only (issue #84's closed decision) — no free
 * text (that's what an object's description is for), and multi-select is
 * pending its own data-shape work (#99). */
const TYPE_LABELS: Partial<Record<FacetFieldType, string>> = {
  select: "Select",
  date: "Date",
};
const ALLOWED_TYPES = Object.keys(TYPE_LABELS) as FacetFieldType[];

/** Edits one item type's field package. Retroactive by design: these
 * fields apply to every object carrying this role, in every collection —
 * the modal says so instead of pretending the edit is local. */
export function RolePackageModal({
  roleName,
  onClose,
}: {
  roleName: string;
  onClose: () => void;
}) {
  const { roles, collections, updateRoleFields } = useStore(
    useShallow((s) => ({
      roles: s.roles,
      collections: s.collections,
      updateRoleFields: s.updateRoleFields,
    }))
  );
  const definition = roles[norm(roleName)];
  const [fields, setFields] = useState<FacetField[]>(definition?.fields ?? []);
  const [nameDraft, setNameDraft] = useState("");
  const [typeDraft, setTypeDraft] = useState<FacetFieldType>("select");
  const [optionsDraft, setOptionsDraft] = useState("");

  // Derived live from every role package (and legacy collection schemas),
  // never a stored catalog — see lib/fieldCatalog.ts. Text-type legacy
  // fields are excluded: suggesting one here would smuggle a forbidden
  // type into a package.
  const knownFields = useMemo(
    () => getKnownFields(collections, roles).filter((f) => f.type !== "text"),
    [collections, roles]
  );

  function addField() {
    const value = nameDraft.trim();
    if (!value) return;
    if (fields.some((f) => f.name.toLowerCase() === value.toLowerCase())) {
      setNameDraft("");
      return;
    }
    const options =
      typeDraft === "select"
        ? optionsDraft
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    setFields([...fields, { name: value, type: typeDraft, ...(options ? { options } : {}) }]);
    setNameDraft("");
    setOptionsDraft("");
    setTypeDraft("select");
  }

  function save() {
    updateRoleFields(roleName, fields);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-panel rounded-card border border-line shadow-2xl w-full max-w-sm p-5">
        <div className="text-sm font-medium mb-1">“{definition?.name ?? roleName}” fields</div>
        <p className="text-[12px] text-muted mb-3">
          These fields apply to every {definition?.name ?? roleName} item, in every collection —
          editing them here changes all of them at once.
        </p>

        <div className="space-y-1">
          {fields.map((field) => (
            <div key={field.name} className="flex items-center gap-1.5">
              <span className="tag-chip flex-1 justify-start gap-1.5">
                {field.name}
                <span className="text-muted">· {TYPE_LABELS[field.type] ?? field.type}</span>
                {field.type === "select" && field.options && (
                  <span className="text-muted/70 truncate">({field.options.join(", ")})</span>
                )}
              </span>
              <button
                onClick={() => setFields(fields.filter((f) => f.name !== field.name))}
                className="text-muted hover:text-ink px-1"
                aria-label={`Remove field ${field.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="mt-1.5 space-y-1.5">
          <div className="flex gap-1.5">
            <input
              list="known-role-field-names"
              value={nameDraft}
              onChange={(e) => {
                const value = e.target.value;
                setNameDraft(value);
                const known = knownFields.find(
                  (f) => f.name.toLowerCase() === value.trim().toLowerCase()
                );
                if (known) {
                  setTypeDraft(known.type);
                  setOptionsDraft(known.options?.join(", ") ?? "");
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && typeDraft !== "select" && addField()}
              placeholder="Field name…"
              className="flex-1 rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
            <datalist id="known-role-field-names">
              {knownFields.map((f) => (
                <option key={`${f.name}::${f.type}`} value={f.name} />
              ))}
            </datalist>
            <select
              value={typeDraft}
              onChange={(e) => setTypeDraft(e.target.value as FacetFieldType)}
              className="rounded-lg border border-line px-2 py-1.5 text-sm bg-panel"
            >
              {ALLOWED_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {typeDraft === "select" && (
            <input
              value={optionsDraft}
              onChange={(e) => setOptionsDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addField()}
              placeholder="Options, comma-separated (e.g. Robert Adams, Lewis Baltz)"
              className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          )}
          <button
            onClick={addField}
            className="w-full rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-line/40"
          >
            Add field
          </button>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-lg hover:bg-line/40 text-ink/70"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
