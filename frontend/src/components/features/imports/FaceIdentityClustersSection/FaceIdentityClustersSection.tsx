import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isAxiosError } from 'axios';
import { X } from 'lucide-react';

import {
  assignFaceIdentityNewPerson,
  assignFaceIdentityPerson,
  unassignFaceIdentityPerson,
  unassignFacePerson,
  type IdentityAssignmentResponse,
  type ImportBatchFaceCluster,
} from '../../../../api/faces';
import type { PersonListItem } from '../../../../api/persons';
import { listPersons } from '../../../../api/persons';
import PersonPicker from '../../../ui/PersonPicker';

import styles from './FaceIdentityClustersSection.module.css';

interface FaceIdentityClustersSectionProps {
  batchId: string;
  clusters: ImportBatchFaceCluster[];
  onClusterUpdated: (updated: IdentityAssignmentResponse) => void;
  onClustersRefresh: () => void | Promise<void>;
}

interface HoverPreview {
  src: string;
  label: string;
  x: number;
  y: number;
}

const HOVER_PREVIEW_SIZE = 220;
const HOVER_PREVIEW_OFFSET = 16;

function displayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Без имени';
}

function errorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  return fallback;
}

export default function FaceIdentityClustersSection({
  batchId,
  clusters,
  onClusterUpdated,
  onClustersRefresh,
}: FaceIdentityClustersSectionProps) {
  const [persons, setPersons] = useState<PersonListItem[]>([]);
  const [personsLoading, setPersonsLoading] = useState(false);
  const [mutatingByIdentityId, setMutatingByIdentityId] = useState<
    Record<string, boolean>
  >({});
  const [mutatingByDetectionId, setMutatingByDetectionId] = useState<
    Record<string, boolean>
  >({});
  const [errorByIdentityId, setErrorByIdentityId] = useState<Record<string, string>>({});
  const [errorByDetectionId, setErrorByDetectionId] = useState<Record<string, string>>({});
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const loadedPersonsRef = useRef(false);

  const sortedClusters = useMemo(
    () =>
      [...clusters].sort(
        (a, b) =>
          b.review_required_count - a.review_required_count ||
          b.detections_count - a.detections_count,
      ),
    [clusters],
  );

  const loadPersons = useCallback(async (force = false) => {
    if (!force && loadedPersonsRef.current) return;
    setPersonsLoading(true);
    try {
      setPersons(await listPersons());
      loadedPersonsRef.current = true;
    } finally {
      setPersonsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPersons();
  }, [loadPersons]);

  const runMutation = useCallback(
    async (
      identityId: string,
      mutation: () => Promise<IdentityAssignmentResponse>,
      options?: { refreshPersons?: boolean },
    ) => {
      setMutatingByIdentityId((prev) => ({ ...prev, [identityId]: true }));
      setErrorByIdentityId((prev) => {
        const next = { ...prev };
        delete next[identityId];
        return next;
      });

      try {
        const updated = await mutation();
        onClusterUpdated(updated);
        if (options?.refreshPersons) {
          await loadPersons(true);
        }
      } catch (error) {
        setErrorByIdentityId((prev) => ({
          ...prev,
          [identityId]: errorMessage(error, 'Не удалось обновить персону кластера'),
        }));
      } finally {
        setMutatingByIdentityId((prev) => {
          const next = { ...prev };
          delete next[identityId];
          return next;
        });
      }
    },
    [loadPersons, onClusterUpdated],
  );

  const handleRemoveFromCluster = useCallback(
    async (detectionId: string) => {
      if (mutatingByDetectionId[detectionId]) return;

      setMutatingByDetectionId((prev) => ({ ...prev, [detectionId]: true }));
      setErrorByDetectionId((prev) => {
        const next = { ...prev };
        delete next[detectionId];
        return next;
      });

      try {
        await unassignFacePerson(detectionId);
        await onClustersRefresh();
      } catch (error) {
        setErrorByDetectionId((prev) => ({
          ...prev,
          [detectionId]: errorMessage(error, 'Не удалось убрать лицо из кластера'),
        }));
      } finally {
        setMutatingByDetectionId((prev) => {
          const next = { ...prev };
          delete next[detectionId];
          return next;
        });
      }
    },
    [mutatingByDetectionId, onClustersRefresh],
  );

  const moveHoverPreview = useCallback((event: React.MouseEvent, src: string, label: string) => {
    const maxX = window.innerWidth - HOVER_PREVIEW_SIZE - HOVER_PREVIEW_OFFSET;
    const maxY = window.innerHeight - HOVER_PREVIEW_SIZE - HOVER_PREVIEW_OFFSET;
    setHoverPreview({
      src,
      label,
      x: Math.max(HOVER_PREVIEW_OFFSET, Math.min(event.clientX + HOVER_PREVIEW_OFFSET, maxX)),
      y: Math.max(HOVER_PREVIEW_OFFSET, Math.min(event.clientY + HOVER_PREVIEW_OFFSET, maxY)),
    });
  }, []);

  if (clusters.length === 0) {
    return (
      <p className={styles.muted}>
        Кластеры лиц пока не найдены: ML-обработка могла ещё не завершиться или
        лица не обнаружены.
      </p>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {sortedClusters.map((cluster) => {
          const mutating = Boolean(mutatingByIdentityId[cluster.identity_id]);
          const error = errorByIdentityId[cluster.identity_id];

          return (
            <article key={cluster.identity_id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h3 className={styles.title}>
                    {cluster.person_id
                      ? displayName(cluster.person_name)
                      : 'Неизвестная персона'}
                  </h3>
                  <div className={styles.subtitle}>
                    {cluster.detections_count} лиц в этой партии
                  </div>
                </div>
                <span
                  className={`${styles.badge} ${
                    cluster.review_required_count === 0 ? styles.badgeDone : ''
                  }`}
                >
                  {cluster.review_required_count === 0
                    ? 'Проверено'
                    : `К проверке: ${cluster.review_required_count}`}
                </span>
              </div>

              <div className={styles.faces} aria-label="Лица в кластере">
                {cluster.detections.map((face) => {
                  const removing = Boolean(mutatingByDetectionId[face.id]);
                  const removeError = errorByDetectionId[face.id];

                  return face.crop_url ? (
                    <div key={face.id} className={styles.face}>
                      <img
                        src={face.crop_url}
                        alt={face.asset_title ?? 'Лицо'}
                        loading="lazy"
                        decoding="async"
                        onMouseEnter={(event) =>
                          moveHoverPreview(
                            event,
                            face.crop_url ?? '',
                            face.asset_title ?? 'Лицо',
                          )
                        }
                        onMouseMove={(event) =>
                          moveHoverPreview(
                            event,
                            face.crop_url ?? '',
                            face.asset_title ?? 'Лицо',
                          )
                        }
                        onMouseLeave={() => setHoverPreview(null)}
                      />
                      <button
                        type="button"
                        className={styles.faceRemoveBtn}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRemoveFromCluster(face.id);
                        }}
                        disabled={removing || mutating}
                        title="Убрать из кластера"
                        aria-label="Убрать лицо из кластера"
                      >
                        <X size={12} strokeWidth={2.5} aria-hidden />
                      </button>
                      {removeError ? (
                        <span className={styles.faceRemoveError} title={removeError}>
                          !
                        </span>
                      ) : null}
                    </div>
                  ) : null;
                })}
              </div>

              <PersonPicker
                persons={persons}
                currentPersonId={cluster.person_id}
                currentPersonName={cluster.person_name}
                isLoading={personsLoading}
                disabled={mutating}
                onSelectPerson={(person) =>
                  runMutation(cluster.identity_id, () =>
                    assignFaceIdentityPerson(batchId, cluster.identity_id, person.id),
                  )
                }
                onCreatePerson={(name) =>
                  runMutation(
                    cluster.identity_id,
                    () => assignFaceIdentityNewPerson(batchId, cluster.identity_id, name),
                    { refreshPersons: true },
                  )
                }
                onClear={() =>
                  runMutation(cluster.identity_id, () =>
                    unassignFaceIdentityPerson(batchId, cluster.identity_id),
                  )
                }
              />

              {error ? <p className={styles.error}>{error}</p> : null}
            </article>
          );
        })}
      </div>
      {hoverPreview
        ? createPortal(
            <div
              className={styles.hoverPreview}
              style={{ left: hoverPreview.x, top: hoverPreview.y }}
              aria-hidden="true"
            >
              <img src={hoverPreview.src} alt={hoverPreview.label} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
