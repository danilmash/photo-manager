# Полный цикл обработки фото: превью, лица, `FaceIdentity`, `Person`

Документ описывает текущую реализацию в репозитории **photo-manager**: как файл превращается в ассет, как появляются `FaceDetection`, как выполняется матчинг к `FaceIdentity` и как пользователь связывает лицо с **персоной** (`Person`).

---

## 1. Сущности данных (кратко)

| Сущность | Назначение |
|----------|------------|
| **Asset** | Одна фотография в библиотеке; хранит агрегированный `status` и фазы `preview_status` / `faces_status`. |
| **File** | Файл на диске + метаданные; у ассета есть `original`, `thumbnail`, `preview` и т.д. |
| **AssetVersion** | Версия с метаданными (EXIF и др.), создаётся на этапе превью. |
| **FaceDetection** | Одно найденное лицо на **конкретном** ассете: `bbox`, `embedding`, `confidence`, привязка к `FaceIdentity`, флаги ревью и т.д. |
| **FaceIdentity** | Кластер эмбеддингов «один визуальный человек» внутри системы; может быть без `Person` (`person_id = NULL`). Имеет `centroid_embedding` (центроид по **reference**-детекциям). |
| **Person** | Каталоговая персона (имя, обложка); к одной персоне может быть **несколько** `FaceIdentity`. |
| **FaceCandidate** | Результат матчинга: топ-N гипотез «это похоже на identity X» для одного `FaceDetection` (ранг, score). |

Связь для пользователя:

- Пользователь оперирует **Person**.
- Система внутри выбирает или создаёт **FaceIdentity** под выбранную персону.
- На фото всегда висит **FaceDetection** с `embedding` и `bbox`.

---

## 2. Статусы ассета (фазы)

Общий `Asset.status` **производный** от двух полей (`derive_asset_status` в `app/assets/models.py`):

- **`preview_status`** — обязательная фаза: превью и метаданные.
- **`faces_status`** — опциональная фаза: ML (лица, кропы, матчинг).

Правила уровня ассета (упрощённо):

- Падение **preview** → ассет в **`error`**.
- Успешный preview, падение **faces** → **`partial_error`** (фото всё равно можно смотреть).
- Обе фазы **`completed`** → **`ready`**.

Пока ML не запускался, часто видно **`uploaded`**: preview уже готов, `faces` ещё в `pending` (типично до закрытия партии импорта).

---

## 3. Полный цикл от загрузки до готовности

### 3.1. Загрузка файла

1. Клиент вызывает `POST /api/v1/assets/upload` (опционально с `batch_id` партии импорта).
2. Создаётся **Asset**, сохраняется **оригинал** в `storage/originals/{asset_id}/...`, создаётся **File** с `purpose="original"`.
3. В очередь ставится задача **`process_asset_preview`** (`app/assets/tasks.py`).

### 3.2. Фаза 1 — `process_asset_preview` (превью)

Задача Celery `process_asset_preview(asset_id, file_id)`:

1. Ставит `preview_status = processing`, коммитит (чтобы UI видел прогресс).
2. Читает оригинал с диска, через ImageMagick (`wand`) строит:
   - **thumbnail** (длинная сторона 300px),
   - **preview** (длинная сторона 1200px),
   - оба как JPEG в `storage/thumbnails/...` и `storage/previews/...`.
3. Для каждого размера создаётся запись **File** с соответствующим `purpose`.
4. Создаётся **AssetVersion** с EXIF/IPTC/XMP/other.
5. При успехе: `preview_status = completed`, пересчитывается `Asset.status`.

**Важно:** на этом этапе **лица не детектятся** — только превью и метаданные.

### 3.3. Когда запускается ML (фаза 2)

ML-задача **`process_asset_ml`** ставится в очередь, когда:

- при **закрытии партии импорта** (`POST .../import-batches/{id}/close`) для каждого ассета с `preview_status = completed` вызывается `process_asset_ml.delay(...)`,  
- либо при **ручном retry** лиц по партии / по ассету (см. роутеры импорта и ассетов в коде).

Пока партия в режиме загрузки, ML обычно **не** гоняется — сначала дожидаются превью.

### 3.4. Фаза 2 — `process_asset_ml` (лица, кропы, матчинг)

Задача `process_asset_ml(asset_id)` (`app/assets/tasks.py`):

1. Нормализует `asset_id` как UUID, загружает **Asset**.
2. Берёт **последний** файл с `purpose="preview"` по `created_at` (актуальное превью).
3. Если превью нет или файла нет на диске — `faces_status = failed`, причина в `faces_error`.
4. Ставит `faces_status = processing`, коммитит.
5. Внутри успешной ветки:
   - **Идемпотентность:** удаляются все существующие `FaceDetection` этого ассета (`DELETE ... WHERE asset_id = ...`), чтобы повторный прогон не смешивал старые и новые детекции.
   - **`_save_face_detections`** — вызов ML-сервиса и запись новых `FaceDetection`.
   - **`_generate_face_crops`** — кропы с **того же** `preview_path` в `storage/crops/{asset_id}/{detection_id}.jpg`.
   - **`match_detections_for_asset`** — матчинг каждого «свежего» детекта к `FaceIdentity` (см. раздел 4).

6. При успехе: `faces_status = completed`, пересчёт `Asset.status`.
7. В `finally` вызывается **`_finalize_batch_if_done`**: если партия в `processing` и все ассеты партии в финальных статусах, партия переходит в **`pending_review`**.

---

## 4. Детекция лиц (`_save_face_detections`)

1. Локальный путь к JPEG превью передаётся в **`detect_faces`** (`app/assets/ml_service.py` → HTTP `POST` на ML-сервис `/detect`).
2. ML-сервис (`ml/app/main.py`):
   - декодирует изображение;
   - вызывает **DeepFace** `represent` с **`model_name=ArcFace`**, **`detector_backend=retinaface`**, `enforce_detection=False`;
   - для каждого лица возвращает нормализованный **`bbox`** `{ x, y, w, h }` в долях от ширины/высоты картинки, **`embedding`**, **`confidence`**, **`quality_score`**.
   - отбрасывается **full-frame fallback** (псевдо-лицо на весь кадр), чтобы не засорять БД.

3. Backend-фильтры перед `INSERT` (`FACE_CONFIDENCE_THRESHOLD` в `tasks.py`, сейчас **0.3**):

   - отсекаются лица с низкой `confidence`;
   - отсекается bbox «почти весь кадр» (дублирующая защита);
   - bbox должен быть в валидных диапазонах: `x,y ∈ [0,1]`, `w,h ∈ (0,1]`.

4. Создаётся **`FaceDetection`**:

   - `asset_id` — UUID ассета;
   - `is_reference=False` (пока только детекция);
   - `identity_id` и `model_*` пустые до матчинга.

---

## 5. Матчинг: `FaceDetection` → `FaceIdentity`

Функция **`match_detections_for_asset`** обрабатывает только детекты, у которых **ещё не было** матчинга:

- `identity_id IS NULL`
- `model_identity_id IS NULL`

Для каждого вызывается **`match_detection`**.

### 5.1. Кандидаты (`FaceCandidate`)

Берутся все `FaceIdentity` с **`centroid_embedding IS NOT NULL`** (без центроида identity не участвует в глобальном матче).

Для эмбеддинга детекта считается **косинусное сходство** с каждым центроидом (`compute_identity_score`), сортировка по убыванию, топ до **`MAX_CANDIDATES` (5)**.

Для каждого из топа создаётся строка **`FaceCandidate`**: `face_detection_id`, `identity_id`, `rank`, `score`.

В поля детекта пишется «мнение модели»:

- `model_identity_id` — лучший identity;
- `model_identity_score`, `model_identity_margin` — score и отрыв от второго места.

### 5.2. Автоматическое назначение (`assignment_source = "model"`)

Условие принятия лучшего identity:

- `best_score >= MATCH_SCORE_THRESHOLD` (**0.55**), **и**
- либо `margin >= MATCH_MARGIN_THRESHOLD` (**0.10**),
- либо **особый случай**: у **первого и второго** кандидата один и тот же **`person_id`** (не `NULL`) — тогда margin не требуется (одна персона, разные identity-кластеры).

При принятии вызывается **`_accept_detection`**:

- `detection.identity_id = identity.id`;
- `detection.identity_score = score`;
- `detection.assignment_source = "model"`;
- `detection.is_reference = True`;
- если `source == "model"`: **`review_required = False`**, **`review_state = auto_assigned`**;
- при необходимости выставляется `cover_face_id` у identity;
- вызывается **`recalculate_centroid`** для этой identity.

### 5.3. «Неуверенная» модель (высокий score, но низкий margin)

Если `best_score >= 0.55`, но margin `< 0.10` и **нет** `top_same_person`, автоматическое назначение **не** выполняется. Новая identity **не** создаётся в этой ветке — детект остаётся с заполненными `model_*` и кандидатами, без `identity_id` (до ручного ревью или другой логики).

### 5.4. Низкий score (`best_score < 0.55`)

Вызывается **`_create_new_identity`**:

- создаётся **`FaceIdentity`** с `person_id = NULL`, **но с уже посчитанным** `centroid_embedding` из эмбеддинга детекта (нормализованный вектор), `samples_count = 1`, `cover_face_id` на это лицо;
- детект привязывается к этой identity, `assignment_source = "model"`, `is_reference = True`;
- **`review_required = True`**, **`review_state = pending_review`** — персону нужно назначить/подтвердить пользователю.

### 5.5. Cold start (в базе ещё нет identity с центроидом)

Если список identity с непустым центроидом **пуст**, сразу вызывается **`_create_new_identity`** (как в п. 5.4): первая «точка» в графе кластеров без привязки к персоне.

### 5.6. Центроид identity (`recalculate_centroid`)

После изменений привязок пересчитывается **только по детекциям**:

- `identity_id` = эта identity  
- **`is_reference = True`**

Среднее по эмбеддингам, затем **L2-нормализация** вектора. Если таких детекций **нет** — `centroid_embedding = NULL`, `samples_count = 0`.

---

## 6. Кропы лиц

**`_generate_face_crops`** для каждого детекта без `crop_path`:

- читает **то же превью**, что и для ML;
- переводит нормализованный bbox в пиксели, добавляет паддинг, квадрат, ресайз **256×256**, JPEG;
- пишет `crop_path` вида `crops/{asset_id}/{detection_id}.jpg`.

Отдача картинки клиенту: **`GET /api/v1/faces/crops/{detection_id}`** (с авторизацией).

---

## 7. Ручное присвоение: лицо → персона / identity

Эндпоинты в **`app/faces/router.py`** (префикс `/api/v1/faces`):

| Метод | Назначение |
|-------|------------|
| `POST /{detection_id}/assign` | Тело: `identity_id`. Прямое назначение (в т.ч. выбор из **FaceCandidate** по identity). После — `recalculate_centroid` для новой и старой identity, ревью помечается как подтверждённое/исправленное. |
| `POST /{detection_id}/assign-person` | Тело: `person_id`. Сервис **`assign_detection_to_best_person_identity`**: среди identity **этой** персоны выбирается лучшая по сходству с центроидом; если нечего выбрать или score ниже порога — создаётся **новая** identity под персону. Особый случай: если текущая identity **без персоны** (`person_id IS NULL`), она **привязывается** к выбранной персоне без слияния кластеров (`_assign_existing_identity_to_person`). |
| `POST /{detection_id}/assign-new-person` | Создаётся новая **Person**, затем логика как у `assign-person`. |
| `POST /{detection_id}/unassign` | Сброс `identity_id`, `is_reference=False`, `assignment_source=user`, ревью в **`unresolved`**, пересчёт центроида **старой** identity. |

После ручных `assign` / `assign-person` / `assign-new-person` в роутере выставляются поля ревью (`user_confirmed` / `user_corrected`, кто и когда).

---

## 8. Что видит клиент (viewer ассета)

`GET /api/v1/assets/{asset_id}` возвращает список лиц с:

- текущей персоной (через `identity → person`);
- `bbox`, `confidence`, ревью-полями;
- **`crop_url`** при наличии кропа;
- **`candidates`** для UI: кандидаты **сгруппированы по `Person`** (несколько identity одной персоны схлопываются в одну строку с лучшим score; кандидаты **без персоны** в пользовательский ответ **не попадают**).

---

## 9. Импорт-партия и ревью очереди

- При закрытии партии ассеты с готовым preview получают **`process_asset_ml`**.
- Когда все ассеты партии в финальных статусах, партия может перейти в **`pending_review`**.
- Список ассетов с незакрытым ревью лиц: **`GET /api/v1/import-batches/{batch_id}/review-assets`** (ассеты, где есть хотя бы одно лицо с `review_required = true`).

---

## 10. Константы (сводка)

| Константа | Значение | Где |
|-----------|----------|-----|
| `FACE_CONFIDENCE_THRESHOLD` | `0.3` | `app/assets/tasks.py` |
| `MATCH_SCORE_THRESHOLD` | `0.55` | `app/faces/services.py` |
| `MATCH_MARGIN_THRESHOLD` | `0.10` | `app/faces/services.py` |
| `MAX_CANDIDATES` | `5` | `app/faces/services.py` |
| `PERSON_IDENTITY_SCORE_THRESHOLD` | `0.55` | `app/faces/services.py` (выбор identity внутри персоны) |

ML-модель в сервисе: **ArcFace + RetinaFace** (`ml/app/main.py`).

Размерность эмбеддинга в БД: **512** (`Vector(512)` в моделях `FaceDetection` / `FaceIdentity`).

---

## 11. Типичные сценарии «что произошло с этим лицом»

1. **Автоматически привязано, ревью не нужно** — сработал `_accept_detection` с `source=model`, пороги/правило same-person выполнены.
2. **Автоматически создана новая identity без персоны, нужен ревью** — низкий score или cold start через `_create_new_identity`.
3. **Модель показала кандидатов, но не закрепила identity** — средний случай по score/margin (см. п. 5.3).
4. **Пользователь выбрал персону** — `assign-person` / `assign-new-person`; внутри либо reuse identity, либо новая identity под персону, либо привязка существующей «безперсонной» identity к персоне.

---

*Документ отражает состояние кода на момент генерации. При изменении порогов, ML-модели или роутов обновляйте этот файл.*
