import { useCallback, useMemo, useState } from 'react';

import type {
  DuplicateReviewDecision,
  ImportBatchDuplicateCandidateItem,
  ImportBatchDuplicateGroup,
} from '../../../api/importBatches';
import { reviewImportBatchDuplicateCandidate } from '../../../api/importBatches';
import Button from '../Button';
import Drawer from '../Drawer';
import { duplicateTypeLabel } from './duplicatePeers';

import styles from './ImportDuplicateCandidatesDrawer.module.css';

interface ImportDuplicateCandidatesDrawerProps {
  open: boolean;
  onClose: () => void;
  portalTarget: HTMLElement | null;
  batchId: string;
  group: ImportBatchDuplicateGroup;
  onCandidateReviewed: (updated: ImportBatchDuplicateCandidateItem) => void;
  adjustContainerPadding?: boolean;
}

function imgSrc(url: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http') || url.startsWith('//')) return url;
  return url;
}

function verdictLabel(decision: string | null): string {
  switch (decision) {
    case 'confirmed_duplicate':
      return 'Дубликат';
    case 'rejected':
      return 'Не дубликат';
    case 'kept_both':
      return 'Оба оставлены';
    default:
      return '';
  }
}

interface CandidateVerdictRowProps {
  batchId: string;
  candidate: ImportBatchDuplicateCandidateItem;
  busyCandidateId: string | null;
  busyDecision: DuplicateReviewDecision | null;
  onBusy: (id: string | null, decision: DuplicateReviewDecision | null) => void;
  onCandidateReviewed: (updated: ImportBatchDuplicateCandidateItem) => void;
}

function CandidateVerdictRow({
  batchId,
  candidate,
  busyCandidateId,
  busyDecision,
  onBusy,
  onCandidateReviewed,
}: CandidateVerdictRowProps) {
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (decision: DuplicateReviewDecision) => {
      setError(null);
      onBusy(candidate.id, decision);
      try {
        const updated = await reviewImportBatchDuplicateCandidate(
          batchId,
          candidate.id,
          decision,
        );
        onCandidateReviewed(updated);
      } catch {
        setError('Не сохранилось');
      } finally {
        onBusy(null, null);
      }
    },
    [batchId, candidate.id, onBusy, onCandidateReviewed],
  );

  const busy = busyCandidateId === candidate.id;

  return (
    <li className={styles.row}>
      <div className={styles.thumbWrap}>
        {imgSrc(candidate.candidate_preview_url) ? (
          <img
            className={styles.thumb}
            src={imgSrc(candidate.candidate_preview_url)}
            alt=""
            loading="lazy"
          />
        ) : (
          <div className={styles.thumbPlaceholder}>Нет превью</div>
        )}
      </div>
      <div className={styles.rowBody}>
        <div className={styles.rowTitle}>
          {candidate.candidate_title?.trim() ||
            `Ассет ${candidate.candidate_asset_id.slice(0, 8)}…`}
        </div>
        <div className={styles.rowMeta}>
          <span className={styles.typeBadge}>
            {duplicateTypeLabel(candidate.duplicate_type)}
          </span>
          {candidate.review_decision ? (
            <span className={styles.decided}>{verdictLabel(candidate.review_decision)}</span>
          ) : (
            <span className={styles.undecided}>Без решения</span>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            color="primary"
            variant="filled"
            size="sm"
            disabled={busyCandidateId !== null}
            onClick={() => void submit('confirmed_duplicate')}
          >
            {busy && busyDecision === 'confirmed_duplicate' ? '…' : 'Дубликат'}
          </Button>
          <Button
            color="muted"
            variant="outline"
            size="sm"
            disabled={busyCandidateId !== null}
            onClick={() => void submit('rejected')}
          >
            {busy && busyDecision === 'rejected' ? '…' : 'Не дубликат'}
          </Button>
          <Button
            color="secondary"
            variant="outline"
            size="sm"
            disabled={busyCandidateId !== null}
            onClick={() => void submit('kept_both')}
          >
            {busy && busyDecision === 'kept_both' ? '…' : 'Оставить оба'}
          </Button>
        </div>
        {error ? <p className={styles.rowError}>{error}</p> : null}
      </div>
    </li>
  );
}

export default function ImportDuplicateCandidatesDrawer({
  open,
  onClose,
  portalTarget,
  batchId,
  group,
  onCandidateReviewed,
  adjustContainerPadding = true,
}: ImportDuplicateCandidatesDrawerProps) {
  const sorted = useMemo(
    () => [...group.candidates].sort((a, b) => a.rank - b.rank),
    [group.candidates],
  );

  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [busyDecision, setBusyDecision] = useState<DuplicateReviewDecision | null>(null);

  const setBusy = useCallback((id: string | null, decision: DuplicateReviewDecision | null) => {
    setBusyCandidateId(id);
    setBusyDecision(decision);
  }, []);

  const sourceTitle = (group.source_title ?? '').trim();
  const title =
    sourceTitle !== '' ? `Кандидаты — ${sourceTitle}` : 'Кандидаты в дубликаты';

  return (
    <Drawer
      behavior="move"
      title={title}
      open={open}
      onClose={onClose}
      side="right"
      portalTarget={portalTarget}
      adjustContainerPadding={adjustContainerPadding}
    >
      <div className={styles.body}>
        <p className={styles.lead}>
          Сравните с фото на экране и вынесите вердикт по каждому кандидату.
        </p>
        {sorted.length === 0 ? (
          <p className={styles.empty}>Для этого источника нет кандидатов.</p>
        ) : (
          <ul className={styles.list}>
            {sorted.map((c) => (
              <CandidateVerdictRow
                key={c.id}
                batchId={batchId}
                candidate={c}
                busyCandidateId={busyCandidateId}
                busyDecision={busyDecision}
                onBusy={setBusy}
                onCandidateReviewed={onCandidateReviewed}
              />
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
