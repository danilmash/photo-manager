import type { AssetListItem, AssetVersionSummary } from '../../../../api/assets';
import type { ImportBatchDuplicateGroup } from '../../../../api/importBatches';

function syntheticVersion(
  previewUrl: string | null,
  assetId: string,
): AssetVersionSummary | null {
  if (!previewUrl) return null;
  const now = new Date().toISOString();
  return {
    id: `cluster-preview-${assetId}`,
    version_number: 1,
    base_version_id: null,
    status: 'ready',
    preview_status: 'completed',
    faces_status: 'completed',
    preview_error: null,
    faces_error: null,
    recipe: {},
    rendered_width: null,
    rendered_height: null,
    is_identity_source: false,
    preview_file_id: null,
    preview_url: previewUrl,
    thumbnail_file_id: null,
    thumbnail_url: previewUrl,
    created_at: now,
  };
}

function mergePreviewIntoItem(
  item: AssetListItem,
  titleFallback: string | null,
  previewFallback: string | null,
): AssetListItem {
  const title = item.title ?? titleFallback ?? null;
  const v = item.version;
  const bestUrl =
    v?.preview_url ||
    v?.thumbnail_url ||
    previewFallback ||
    null;

  if (!v) {
    return {
      ...item,
      title,
      version: syntheticVersion(bestUrl, item.asset_id),
    };
  }

  const nextPreview = v.preview_url ?? bestUrl ?? null;
  const nextThumb = v.thumbnail_url ?? bestUrl ?? null;

  if (
    nextPreview === v.preview_url &&
    nextThumb === v.thumbnail_url &&
    title === item.title
  ) {
    return item;
  }

  return {
    ...item,
    title,
    version: {
      ...v,
      preview_url: nextPreview,
      thumbnail_url: nextThumb,
    },
  };
}

/** Карусель: сначала источник, затем кандидаты по rank. */
export function duplicateGroupToCarouselPhotos(
  group: ImportBatchDuplicateGroup,
  batchAssets: AssetListItem[],
): AssetListItem[] {
  const map = new Map(batchAssets.map((a) => [a.asset_id, a]));

  const resolve = (
    assetId: string,
    title: string | null,
    fallbackPreview: string | null,
  ): AssetListItem => {
    const existing = map.get(assetId);
    if (!existing) {
      const now = new Date().toISOString();
      return {
        asset_id: assetId,
        title,
        created_at: now,
        updated_at: now,
        version: syntheticVersion(fallbackPreview, assetId),
      };
    }
    return mergePreviewIntoItem(existing, title, fallbackPreview);
  };

  const source = resolve(
    group.source_asset_id,
    group.source_title,
    group.source_preview_url,
  );

  const candidates = [...group.candidates]
    .sort((a, b) => a.rank - b.rank)
    .map((c) =>
      resolve(c.candidate_asset_id, c.candidate_title, c.candidate_preview_url),
    );

  return [source, ...candidates];
}

/** Карусель импорта: только источники (порядок совпадает с массивом групп). */
export function duplicateSourcesToCarouselPhotos(
  groups: ImportBatchDuplicateGroup[],
  batchAssets: AssetListItem[],
): AssetListItem[] {
  return groups.map((g) => duplicateGroupToCarouselPhotos(g, batchAssets)[0]);
}
