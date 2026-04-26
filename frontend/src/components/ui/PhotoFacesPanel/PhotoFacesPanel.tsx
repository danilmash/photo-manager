import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { AlertCircle, Sparkles, User } from 'lucide-react';

import type { AssetViewerFace } from '../../../api/assets';
import type { PersonListItem } from '../../../api/persons';
import { listPersons } from '../../../api/persons';
import {
  assignFaceNewPerson,
  assignFacePerson,
  getFaceCropUrl,
  unassignFacePerson,
} from '../../../api/faces';
import PersonPicker from '../PersonPicker';
import styles from './PhotoFacesPanel.module.css';

interface PhotoFacesPanelProps {
  assetId: string;
  open: boolean;
  faces: AssetViewerFace[];
  activeFaceId: string | null;
  onActiveFaceChange: (faceId: string) => void;
  onFacesReload: (assetId: string) => Promise<void>;
}

function getDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Без имени';
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim().length > 0) {
      return detail;
    }
  }

  return fallback;
}

function formatScore(value: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function FaceCropPreview({
  detectionId,
  label,
}: {
  detectionId: string;
  label: string;
}) {
  return (
    <div key={detectionId} className={styles['crop-frame']}>
      <img
        className={styles['crop-image']}
        src={getFaceCropUrl(detectionId)}
        alt={label}
        loading="lazy"
        decoding="async"
        onError={(event) => {
          event.currentTarget.hidden = true;
          const fallback = event.currentTarget.parentElement?.querySelector(
            '[data-face-crop-fallback]',
          );
          if (fallback instanceof HTMLElement) {
            fallback.hidden = false;
          }
        }}
      />
      <div
        className={styles['crop-fallback']}
        aria-hidden="true"
        data-face-crop-fallback
        hidden
      >
        <User />
      </div>
    </div>
  );
}

export default function PhotoFacesPanel({
  assetId,
  open,
  faces,
  activeFaceId,
  onActiveFaceChange,
  onFacesReload,
}: PhotoFacesPanelProps) {
  const [persons, setPersons] = useState<PersonListItem[]>([]);
  const [personsLoading, setPersonsLoading] = useState(false);
  const [personsError, setPersonsError] = useState<string | null>(null);
  const [mutatingByFaceId, setMutatingByFaceId] = useState<Record<string, boolean>>(
    {},
  );
  const [mutationErrorByFaceId, setMutationErrorByFaceId] = useState<
    Record<string, string>
  >({});

  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const hasLoadedPersonsRef = useRef(false);
  const assetCycleRef = useRef(0);

  const setCardRef = useCallback((faceId: string, node: HTMLElement | null) => {
    if (node) {
      cardRefs.current[faceId] = node;
      return;
    }

    delete cardRefs.current[faceId];
  }, []);

  const loadPersons = useCallback(
    async (force = false) => {
      if (personsLoading) return;
      if (!force && hasLoadedPersonsRef.current) return;

      setPersonsLoading(true);
      setPersonsError(null);

      try {
        const data = await listPersons();
        setPersons(data);
        hasLoadedPersonsRef.current = true;
      } catch (error) {
        setPersonsError(
          getErrorMessage(error, 'Не удалось загрузить список персон'),
        );
      } finally {
        setPersonsLoading(false);
      }
    },
    [personsLoading],
  );

  useEffect(() => {
    if (!open) return;
    void loadPersons();
  }, [loadPersons, open]);

  useEffect(() => {
    assetCycleRef.current += 1;
    cardRefs.current = {};
    setMutatingByFaceId({});
    setMutationErrorByFaceId({});
  }, [assetId]);

  useEffect(() => {
    if (!open || !activeFaceId) return;

    const node = cardRefs.current[activeFaceId];
    node?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [activeFaceId, open]);

  const runFaceMutation = useCallback(
    async (
      faceId: string,
      mutation: () => Promise<unknown>,
      options?: { refreshPersons?: boolean },
    ) => {
      const cycle = assetCycleRef.current;

      setMutationErrorByFaceId((prev) => {
        const next = { ...prev };
        delete next[faceId];
        return next;
      });
      setMutatingByFaceId((prev) => ({ ...prev, [faceId]: true }));

      try {
        await mutation();
      } catch (error) {
        if (assetCycleRef.current !== cycle) return;

        setMutationErrorByFaceId((prev) => ({
          ...prev,
          [faceId]: getErrorMessage(error, 'Не удалось обновить персону'),
        }));
        setMutatingByFaceId((prev) => {
          const next = { ...prev };
          delete next[faceId];
          return next;
        });
        return;
      }

      try {
        await onFacesReload(assetId);
      } catch (error) {
        if (assetCycleRef.current !== cycle) return;

        setMutationErrorByFaceId((prev) => ({
          ...prev,
          [faceId]: getErrorMessage(
            error,
            'Персона обновлена, но не удалось освежить данные фото',
          ),
        }));
      }

      if (assetCycleRef.current === cycle) {
        setMutatingByFaceId((prev) => {
          const next = { ...prev };
          delete next[faceId];
          return next;
        });
      }

      if (options?.refreshPersons && assetCycleRef.current === cycle) {
        void loadPersons(true);
      }
    },
    [assetId, loadPersons, onFacesReload],
  );

  const faceCards = useMemo(() => {
    return faces.map((face, index) => {
      const confidence = formatScore(face.confidence);
      const quality = formatScore(face.quality_score);
      const candidates = face.candidates.filter(
        (candidate) => candidate.person_id !== face.person_id,
      );

      return {
        ...face,
        index,
        confidence,
        quality,
        candidates,
      };
    });
  }, [faces]);

  if (faces.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles['empty-title']}>Лица не найдены</div>
        <div className={styles['empty-copy']}>
          Когда для этого фото появятся detections, здесь можно будет выбрать
          персону для каждого лица.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {personsError && (
        <div className={styles.alert} role="status">
          <AlertCircle aria-hidden />
          <span>{personsError}</span>
        </div>
      )}

      <div className={styles.list}>
        {faceCards.map((face) => {
          const isActive = face.id === activeFaceId;
          const isMutating = Boolean(mutatingByFaceId[face.id]);
          const mutationError = mutationErrorByFaceId[face.id];

          return (
            <article
              key={face.id}
              ref={(node) => setCardRef(face.id, node)}
              className={`${styles.card} ${isActive ? styles['card-active'] : ''}`}
              onClick={() => onActiveFaceChange(face.id)}
              onFocusCapture={() => onActiveFaceChange(face.id)}
            >
              <div className={styles['card-header']}>
                <div className={styles['card-title-block']}>
                  <h4 className={styles['card-title']}>Лицо {face.index + 1}</h4>
                  <div className={styles['card-subtitle']}>
                    {face.person_id
                      ? getDisplayName(face.person_name)
                      : 'Персона не выбрана'}
                  </div>
                </div>

                <div className={styles.badges}>
                  {face.review_required && (
                    <span className={styles.badge}>Требует проверки</span>
                  )}
                  {face.assignment_source === 'model' && (
                    <span className={styles.badge}>
                      <Sparkles aria-hidden />
                      <span>Авто</span>
                    </span>
                  )}
                </div>
              </div>

              <div className={styles['card-body']}>
                <div className={styles['identity-row']}>
                  <div className={styles.crop}>
                    <FaceCropPreview
                      detectionId={face.id}
                      label={`Лицо ${face.index + 1}`}
                    />
                  </div>

                  <div className={styles.summary}>
                    <div className={styles['summary-block']}>
                      <span className={styles.label}>Текущая персона</span>
                      <span
                        className={
                          face.person_id ? styles.value : styles['value-empty']
                        }
                      >
                        {face.person_id
                          ? getDisplayName(face.person_name)
                          : 'Не выбрана'}
                      </span>
                    </div>

                    <div className={styles.stats}>
                      {face.confidence && (
                        <span className={styles.stat}>
                          Confidence {face.confidence}
                        </span>
                      )}
                      {face.quality && (
                        <span className={styles.stat}>Качество {face.quality}</span>
                      )}
                    </div>
                  </div>
                </div>

                {face.candidates.length > 0 && (
                  <div className={styles.candidates}>
                    <span className={styles.label}>Быстрый выбор</span>
                    <div className={styles['candidate-list']}>
                      {face.candidates.map((candidate) => (
                        <button
                          key={candidate.person_id}
                          type="button"
                          className={styles['candidate-button']}
                          onClick={() =>
                            void runFaceMutation(face.id, () =>
                              assignFacePerson(face.id, candidate.person_id),
                            )
                          }
                          disabled={isMutating}
                        >
                          <span className={styles['candidate-name']}>
                            {getDisplayName(candidate.person_name)}
                          </span>
                          <span className={styles['candidate-score']}>
                            {formatScore(candidate.score) ?? '—'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <PersonPicker
                  persons={persons}
                  currentPersonId={face.person_id}
                  currentPersonName={face.person_name}
                  isLoading={personsLoading}
                  disabled={isMutating}
                  onSelectPerson={(person) =>
                    runFaceMutation(face.id, () =>
                      assignFacePerson(face.id, person.id),
                    )
                  }
                  onCreatePerson={(name) =>
                    runFaceMutation(
                      face.id,
                      () => assignFaceNewPerson(face.id, name),
                      { refreshPersons: true },
                    )
                  }
                  onClear={() =>
                    runFaceMutation(face.id, () => unassignFacePerson(face.id))
                  }
                />

                {mutationError && (
                  <div className={styles['card-error']} role="status">
                    {mutationError}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
