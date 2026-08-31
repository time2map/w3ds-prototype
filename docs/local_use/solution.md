# W3DS: локальное окружение для разработчика платформ

Руководство для разработчика платформ: как поднять локальную инфраструктуру
**Registry + eVault (evault-core) + Awareness-as-a-Service**, какие переменные
окружения задать и как настроить собственную платформу для работы с этими
сервисами. В конце — описание встроенной **Admin UI**.

---

## 1. Предварительные требования

- **Docker** (Postgres и Neo4j запускаются в контейнерах)
- Репозиторий `w3ds-prototype`, из корня которого выполняются команды
- Файл **`.env`** в корне репозитория (создаётся из `.env.example`)


---

## 2. Переменные окружения (`.env`)

Файл `.env` лежит в **корне репозитория** — его читают и docker-compose, и все
сервисы (dotenv подхватывает его через `../../../../.env`).

### Обязательные

| Переменная | Назначение | Как получить |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Доступ к Postgres (по умолчанию `postgres` / `postgres`) | — |
| `NEO4J_USER` / `NEO4J_PASSWORD` | Доступ к Neo4j (по умолчанию `neo4j` / `neo4j`) | — |
| `REGISTRY_ENTROPY_KEY_JWK` | ES256 ключ подписи entropy-токенов Registry | `pnpm generate-entropy-jwk` |
| `PROVISIONER_SIGNING_SEED` | 32-байтовый hex-сид ed25519 ключа Provisioner | любое случайное hex-значение длиной 64 символа |
| `REGISTRY_SHARED_SECRET` | Общий секрет для `POST /register` Registry | любая строка (напр. `dev-secret-change-me`) |

### Рекомендуемые / необязательные

| Переменная | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `PUBLIC_REGISTRY_URL` | `http://localhost:4321` | URL Registry (для платформ) |
| `PUBLIC_PROVISIONER_URL` | `http://localhost:3001` | URL Provisioner |
| `PUBLIC_EVAULT_SERVER_URI` | `http://localhost:4000` | Публичный URL eVault |
| `PROVISIONER_KID` | `provisioner-1` | Идентификатор ключа Provisioner |
| `W3ID` | `@local-evault` | W3ID самого evault-core |
| `AWARENESS_INGEST_SECRET` | `replace-with-a-strong-secret` | Секрет между evault-core и AaaS (`/ingest`) |
| `AWARENESS_PUBLIC_URL` | `http://localhost:4100` | Публичный URL AaaS |
| `AAAS_ADMIN_ENAMES` | пусто | Через запятую список eNames админов портала AaaS |
| `AAAS_JWT_SECRET` | `awareness-dev-secret` | Секрет подписи JWT сессий портала |

### Генерация `REGISTRY_ENTROPY_KEY_JWK`

```bash
pnpm generate-entropy-jwk
```

Вывод скопировать в `.env`:

```bash
REGISTRY_ENTROPY_KEY_JWK='{"kty":"EC",...}'
```

Пример минимального `.env`:

```bash
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-neo4j-password

REGISTRY_ENTROPY_KEY_JWK='{"kty":"EC","use":"sig","alg":"ES256","kid":"entropy-key-1","crv":"P-256","x":"...","y":"...","d":"..."}'
REGISTRY_SHARED_SECRET=dev-secret-change-me
PROVISIONER_SIGNING_SEED=<64 hex-символа>
PROVISIONER_KID=provisioner-1
W3ID=@local-evault

AWARENESS_INGEST_SECRET=replace-with-a-strong-secret
AWARENESS_PUBLIC_URL=http://localhost:4100
AAAS_ADMIN_ENAMES=@admin1,@admin2
AAAS_JWT_SECRET=awareness-dev-secret

PUBLIC_REGISTRY_URL=http://localhost:4321
PUBLIC_PROVISIONER_URL=http://localhost:3001
PUBLIC_EVAULT_SERVER_URI=http://localhost:4000
```

---

## 3. Какой compose запускать

### Вариант А — полный стек в Docker (рекомендуется)

Файл **`docker-compose.core.local.yml`** поднимает всё: Postgres, Neo4j,
одноразовые миграции, Registry, evault-core, Awareness-as-a-Service и nginx
(Admin UI + прокси API). Секреты подтягиваются из корневого `.env`.

```bash
docker compose -f docker-compose.core.local.yml up -d --build
```

Остановка:

```bash
docker compose -f docker-compose.core.local.yml down
```

### Вариант Б — только базы + сервисы из исходников

Сначала базы данных:

```bash
pnpm dev:core:docker      # docker compose -f docker-compose.databases.yml up -d
pnpm dev:core:wait        # ждёт порты 5432 и 7687
pnpm dev:core:migrate     # миграции registry + evault-core
pnpm dev:core:apps        # запускает registry, evault-core, dev-sandbox локально
```

Либо одной командой `pnpm dev:core`. Этот вариант поднимает только
Registry, evault-core и dev-sandbox (без AaaS и nginx) — подходит для
разработки самих платформ, не использующих webhook-доставку.

---

## 4. Порты

| Сервис | Порт(ы) | Назначение |
| --- | --- | --- |
| Postgres | `5432` | БД registry/provisioner/awareness |
| Neo4j | `7474` (HTTP), `7687` (Bolt) | Графовое хранилище MetaEnvelope |
| Registry | `4321` | resolve / entropy / register / list |
| evault-core (Provisioner) | `3001` | `POST /provision` |
| evault-core (GraphQL/HTTP) | `4000` | `POST /graphql`, `/whois`, файлы |
| Awareness-as-a-Service | `4100` | `/ingest`, `/api/*`, портал |
| nginx (Admin UI) | `8042` | Admin UI + прокси `/api/registry`, `/api/evault`, `/api/provision` |

---

## 5. Настройка разрабатываемой платформы

### 5.1 Подключение к Registry

**Базовый URL:** `PUBLIC_REGISTRY_URL` (локально `http://localhost:4321`).

| Эндпоинт | Метод | Назначение |
| --- | --- | --- |
| `/entropy` | GET | Получить подписанный entropy-токен (для провижина eVault) |
| `/resolve?w3id=<ename>` | GET | Разрешить eName в `uri` + `evault` его eVault |
| `/list` | GET | Список всех зарегистрированных eVault |
| `/platforms` | GET | Список публичных URL платформ (для AaaS) |
| `/platforms/certification` | POST | Получить platform-токен (авторизация GraphQL-запросов к eVault) |
| `/register` | POST/PATCH/DELETE | Управление записью eVault платформы (заголовок `Authorization: Bearer <REGISTRY_SHARED_SECRET>`) |

Типовой поток для платформы:

```ts
// 1. entropy-токен для провижина
const { data: { token: entropy } } = await axios.get(`${registryUrl}/entropy`);

// 2. разрешить eName → eVault
const { data } = await axios.get(`${registryUrl}/resolve?w3id=${encodeURIComponent(ename)}`);
// data = { ename, uri, evault, originalUri, resolved }

// 3. platform-токен для чтения/записи MetaEnvelope
const { data: { token } } = await axios.post(`${registryUrl}/platforms/certification`, {
  platform: "my-platform",
});
```

### 5.2 Подключение к eVault (evault-core)

**GraphQL:** `PUBLIC_EVAULT_SERVER_URI` (локально `http://localhost:4000`) + `/graphql`.

Каждый запрос требует:
- заголовок **`X-ENAME`** — eName владельца eVault (из `resolve`);
- заголовок **`Authorization: Bearer <token>`** — platform-токен из
  `/platforms/certification`. Исключение: `storeMetaEnvelope` работает и без
  Bearer-токена (достаточно `X-ENAME`).

Пример запроса всех MetaEnvelope:

```bash
curl -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-ENAME: @some-user' \
  -H 'Authorization: Bearer <platform-token>' \
  -d '{"query":"query { metaEnvelopes(first: 100) { edges { node { id ontology } } } }"}'
```

Основные операции: `metaEnvelope(id)`, `metaEnvelopes(filter, first, after)`,
`createMetaEnvelope(input)`, `updateMetaEnvelope(id, input)`,
`removeMetaEnvelope(id)`, `uploadFile(input)`. Схема доступна в
`infrastructure/evault-core/src/core/protocol/typedefs.ts`.

**Провижинг собственного eVault платформы** — через Provisioner
(`PUBLIC_PROVISIONER_URL`, локально `http://localhost:3001`):

```ts
const { data } = await axios.post(`${provisionerUrl}/provision`, {
  registryEntropy: entropy,       // из /entropy
  namespace: uuidv4(),            // свежий UUID
  verificationId: process.env.DEMO_VERIFICATION_CODE,
  publicKey: "<public key>",      // ключ платформы
});
// data = { success: true, w3id, uri }
```

Детали (PlatformProfile, самоподписанные binding documents) — см.
`docs/docs/Post Platform Guide/platform-evault-registration.md`.

### 5.3 Подключение к Awareness-as-a-Service (AaaS)

**Базовый URL:** `AWARENESS_PUBLIC_URL` (локально `http://localhost:4100`).

AaaS — единая точка доставки awareness-пакетов. Когда в eVault что-то
создаётся/обновляется, evault-core делает один `POST` на
`AWARENESS_SERVICE_URL/ingest` (с заголовком `x-ingest-secret`), а AaaS
рассылает пакеты подписчикам.

**Что должна сделать платформа:**

1. **Отдавать webhook** на `POST <PUBLIC_БАЗОВЫЙ_URL_ПЛАТФОРМЫ>/api/webhook`.
   AaaS сам (реконсиляция catch-all, каждые `AWARENESS_REGISTRY_SYNC_MS`)
   создаёт для каждой зарегистрированной платформы потребителя и подписку,
   указывающую на `<platformUrl>/api/webhook`. Ваш публичный URL должен быть
   в списке `/platforms` Registry, а сам эндпоинт обязан отвечать `200` на
   любой пакет (неизвестные `schemaId` тоже должны ack-аться, иначе доставка
   будет ретраиться).

   Формат пакета:

   ```json
   {
     "id": "<MetaEnvelope id>",
     "w3id": "<owner eName>",
     "evaultPublicKey": "<public key>",
     "data": { "...": "payload" },
     "schemaId": "<ontology>"
   }
   ```

2. **Если нужна точечная подписка** (по онтологиям / eVault) — использовать API:

   ```bash
   curl -X POST http://localhost:4100/api/subscriptions \
     -H 'Authorization: Bearer <api-key>' \
     -H 'Content-Type: application/json' \
     -d '{"targetUrl":"https://my-platform/api/webhook","ontologyFilter":["<ontology>"]}'
   ```

   Управление: `GET/PATCH/DELETE /api/subscriptions`.

3. **Запросить историю пакетов**:

   ```bash
   curl 'http://localhost:4100/api/packets?ontology=<schemaId>&limit=100' \
     -H 'Authorization: Bearer <api-key>'
   ```

4. **Доступ и API-ключи.** Ключи выдаются в портале AaaS после W3DS-авторизации
   и одобрения заявки админом (allowlist `AAAS_ADMIN_ENAMES`). До одобрения
   платформа получает пакеты через catch-all подписку.

Подробнее: `docs/docs/Services/Awareness-as-a-Service.md`.

---

## 6. Admin UI

Admin UI — статичный набор страниц из `infrastructure/admin_ui/`, который
отдаёт nginx (порт **`8042`**) и через который же проксируются API
Registry и eVault. Это единая точка входа для администрирования локального
окружения.

### Доступ

| Путь | Страница | Назначение |
| --- | --- | --- |
| `/admin/` | **eName Admin** (`index.html`) | Список зарегистрированных eVault; создание и удаление eName/eVault |
| `/qr` | **QR Auth** (`qr.html`) | Сканирование/вставка QR `w3ds://auth` и подпись сессии ключом из `TestKey.js` |
| `/evault` | **eVault MetaEnvelopes** (`evault.html`) | Поле ввода eVault ID и таблица всех MetaEnvelope (id + ontology) |
| `/metaenvelope` | **MetaEnvelope** (`metaenvelope.html`) | Форматированный JSON одиночного MetaEnvelope по id |

### Что умеют страницы

- **eName Admin** — таблица eVault (`Display Name`, `eName`, `eVault`, `URI`),
  кнопки *New eName* / *Delete eName* / *Refresh*, просмотр деталей (whois).
  Значения `eName` и `eVault` — ссылки: первая открывает `/qr?ename=…`,
  вторая — `/evault?evault=…` в новой вкладке.
- **QR Auth** — подпись `w3ds://auth`/`w3ds://sign` сессии ключом тестового
  аккаунта и отправка подписи на `redirect` платформы. Поддерживает ввод
  eName (в т.ч. через `?ename=…`), загрузку/вставку изображения QR.
- **eVault MetaEnvelopes** — по eVault ID (или eName) показывает все
  MetaEnvelope в таблице; клик по id открывает страницу деталей. Поддерживает
  `?evault=…` с автозагрузкой.
- **MetaEnvelope** — по `?id=…&ename=…` запрашивает `metaEnvelope(id)` из
  GraphQL и отображает ответ как отформатированный JSON.

### Проксирование (nginx)

Admin UI ходит к API через nginx-прокси:

| Локальный путь | Проксируется в |
| --- | --- |
| `/api/registry/` | `registry:4321` |
| `/api/evault/` | `evault-core:4000` |
| `/api/provision/` | `evault-core:3001` |

Авторизация чтения GraphQL внутри страниц — через platform-токен из
`POST /api/registry/platforms/certification` (`{ platform: "admin-ui" }`).

### Локальная разработка Admin UI

Файлы из `infrastructure/admin_ui/` монтируются в nginx как read-only.
Чтобы увидеть изменения без пересборки:

```bash
docker compose -f docker-compose.core.local.yml restart nginx
```

Или запустить nginx отдельно, смонтировав папку (конфиг — `docker/nginx.conf`).

---

## 7. Проверка, что всё поднялось

```bash
# Registry
curl http://localhost:4321/motd
curl "http://localhost:4321/resolve?w3id=@local-evault"

# eVault
curl http://localhost:3001/health

# AaaS
curl http://localhost:4100/health

# Admin UI
open http://localhost:8042/admin/
```

## 8. Полезные ссылки

- `docs/docs/Post Platform Guide/local-dev-quick-start.md` — quick start
- `docs/docs/Post Platform Guide/platform-evault-registration.md` — регистрация eVault платформы
- `docs/docs/Services/Awareness-as-a-Service.md` — AaaS
- `docs/docs/Infrastructure/Registry.md`, `docs/docs/Infrastructure/eVault.md`
- `QUICKSTART.md` — минимальный запуск core
