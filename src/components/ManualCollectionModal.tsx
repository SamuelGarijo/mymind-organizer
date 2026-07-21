import { CollectionWizard } from "./CollectionWizard";

/**
 * A manual collection IS the shared collection wizard, with no admission
 * rules (Samuel, 2026-07-22: manual and smart are the same wizard, smart
 * just adds the rules). This is the `mode="manual"` entry point App renders.
 */
export function ManualCollectionModal({
  collectionId,
  parentId,
  onClose,
}: {
  collectionId?: string;
  parentId?: string;
  onClose: () => void;
}) {
  return (
    <CollectionWizard
      mode="manual"
      collectionId={collectionId}
      parentId={parentId}
      onClose={onClose}
    />
  );
}
