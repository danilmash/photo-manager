import type { ImportBatchDuplicateGroup } from '../../../api/importBatches';

export type DuplicatePeerRelation =
  | 'canonical_source'
  | 'candidate_of_current'
  | 'source_for_current'
  | 'sibling_candidate';

export interface DuplicatePeerItem {
  asset_id: string;
  title: string | null;
  preview_url: string | null;
  relation: DuplicatePeerRelation;
  duplicate_type: string | null;
}

const RELATION_ORDER: Record<DuplicatePeerRelation, number> = {
  canonical_source: 0,
  source_for_current: 1,
  candidate_of_current: 2,
  sibling_candidate: 3,
};

/** Собирает связанные по сканеру дубликатов ассеты для текущего фото в партии импорта. */
export function collectDuplicatePeers(
  groups: ImportBatchDuplicateGroup[],
  currentAssetId: string,
  duplicateOfAssetId: string | null,
): DuplicatePeerItem[] {
  const items: DuplicatePeerItem[] = [];
  const seen = new Set<string>();

  const push = (item: DuplicatePeerItem) => {
    if (item.asset_id === currentAssetId) return;
    if (seen.has(item.asset_id)) return;
    seen.add(item.asset_id);
    items.push(item);
  };

  if (duplicateOfAssetId && duplicateOfAssetId !== currentAssetId) {
    let found = false;
    for (const g of groups) {
      if (g.source_asset_id === duplicateOfAssetId) {
        push({
          asset_id: g.source_asset_id,
          title: g.source_title,
          preview_url: g.source_preview_url,
          relation: 'canonical_source',
          duplicate_type: null,
        });
        found = true;
        break;
      }
      const row = g.candidates.find((c) => c.candidate_asset_id === duplicateOfAssetId);
      if (row) {
        push({
          asset_id: duplicateOfAssetId,
          title: row.candidate_title,
          preview_url: row.candidate_preview_url,
          relation: 'canonical_source',
          duplicate_type: row.duplicate_type,
        });
        found = true;
        break;
      }
    }
    if (!found) {
      push({
        asset_id: duplicateOfAssetId,
        title: null,
        preview_url: null,
        relation: 'canonical_source',
        duplicate_type: null,
      });
    }
  }

  for (const g of groups) {
    if (g.source_asset_id === currentAssetId) {
      for (const c of g.candidates) {
        push({
          asset_id: c.candidate_asset_id,
          title: c.candidate_title,
          preview_url: c.candidate_preview_url,
          relation: 'candidate_of_current',
          duplicate_type: c.duplicate_type,
        });
      }
    } else {
      const mine = g.candidates.find((c) => c.candidate_asset_id === currentAssetId);
      if (mine) {
        push({
          asset_id: g.source_asset_id,
          title: g.source_title,
          preview_url: g.source_preview_url,
          relation: 'source_for_current',
          duplicate_type: mine.duplicate_type,
        });
        for (const c of g.candidates) {
          if (c.candidate_asset_id === currentAssetId) continue;
          push({
            asset_id: c.candidate_asset_id,
            title: c.candidate_title,
            preview_url: c.candidate_preview_url,
            relation: 'sibling_candidate',
            duplicate_type: c.duplicate_type,
          });
        }
      }
    }
  }

  items.sort((a, b) => RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation]);
  return items;
}

export function duplicateTypeLabel(type: string | null): string {
  switch (type) {
    case 'exact':
      return 'Точное совпадение';
    case 'visual':
      return 'Визуально похоже';
    case 'near':
      return 'Почти совпадает';
    default:
      return type ? String(type) : '';
  }
}
