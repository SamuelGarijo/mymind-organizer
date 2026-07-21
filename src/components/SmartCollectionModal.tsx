import { CollectionWizard } from "./CollectionWizard";

/**
 * A smart collection is the shared collection wizard plus conditional
 * admission rules (Samuel, 2026-07-22). All the logic lives in
 * CollectionWizard; this is the `mode="smart"` entry point App renders.
 */
export function SmartCollectionModal({
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
      mode="smart"
      collectionId={collectionId}
      parentId={parentId}
      onClose={onClose}
    />
  );
}
