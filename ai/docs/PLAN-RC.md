# ModulaCMS TypeScript SDK - Implementation Plan (RC)

## Context

Build a TypeScript SDK for the ModulaCMS admin API from scratch. The project currently has only `API_CONTRACT.md` (endpoint spec) and `STRUCT_REFERENCE.md` (Go struct definitions). The SDK provides typed functions for all admin API endpoints, targeting both browser and Node.js via native `fetch`.

**User choices:** Admin scope only, native fetch, Bun tooling, functional style (no classes).

**Initial version:** `0.1.0` (pre-stability, minor = breaking under `0.x` semver).

---

## File Structure

```
modulacms-sdk/
├── src/
│   ├── index.ts              # createClient factory + re-exports
│   ├── http.ts               # Fetch wrapper: auth, errors, base URL
│   ├── resource.ts           # Generic CRUD resource factory
│   ├── types/
│   │   ├── index.ts          # Re-exports all types (using `export type` for type-only exports)
│   │   ├── common.ts         # ID type aliases, Nullable, Timestamp, RequestOptions, error shapes + isApiError guard
│   │   ├── auth.ts           # Login/register/me request & response types
│   │   ├── admin.ts          # AdminRoute, AdminContentData, AdminContentField, AdminDatatype, AdminField, AdminDatatypeField, AdminContentRelation + create/update params
│   │   ├── content.ts        # ContentData, ContentField, ContentRelation + create/update params
│   │   ├── schema.ts         # Datatype, Field, DatatypeField + create/update params (DatatypeField used in tree responses, no standalone endpoint)
│   │   ├── media.ts          # Media, MediaDimension, MediaUpload types
│   │   ├── users.ts          # User, Role, Token (SENSITIVE), UserOauth (SENSITIVE), Session, SshKey types
│   │   ├── routing.ts        # Route + create/update params
│   │   ├── tables.ts         # Table + create/update params
│   │   ├── import.ts         # Import request/response types
│   │   └── tree.ts           # Admin tree response types (ContentTreeNode, ContentTreeField)
│   ├── resources/
│   │   ├── auth.ts           # Auth endpoints (login, logout, me, register, reset)
│   │   ├── admin-tree.ts     # GET /admin/tree/{slug} with format param
│   │   ├── media-upload.ts   # POST multipart/form-data upload
│   │   ├── sessions.ts       # PUT/DELETE only (no list/get/create)
│   │   ├── ssh-keys.ts       # Different URL pattern (path param delete)
│   │   └── import.ts         # POST-only import endpoints
├── package.json
├── tsconfig.json
├── API_CONTRACT.md           # (exists)
├── STRUCT_REFERENCE.md       # (exists)
└── CLAUDE.md                 # (exists)
```

---

## Architecture

### HTTP Layer (`src/http.ts`)

A `createHttpClient(config)` factory that returns a configured fetch wrapper. **`HttpClient` is internal -- not exported in the public API.** Consumers interact only through the typed resource methods on `ModulaCMSClient`.

```typescript
type RequestOptions = {
  signal?: AbortSignal
}

// Internal type -- not exported
type HttpClient = {
  get: <T>(path: string, params?: Record<string, string>, opts?: RequestOptions) => Promise<T>
  post: <T>(path: string, body?: Record<string, unknown>, opts?: RequestOptions) => Promise<T>
  put: <T>(path: string, body?: Record<string, unknown>, opts?: RequestOptions) => Promise<T>
  del: (path: string, params?: Record<string, string>, opts?: RequestOptions) => Promise<void>
  raw: (path: string, init: RequestInit) => Promise<Response>  // for media upload
}
```

- Prepends `baseUrl + /api/v1` to all paths
- Sets `Content-Type: application/json` for JSON requests
- Attaches `Authorization: Bearer <apiKey>` header when apiKey is provided
- Sets `credentials` to the value from `ClientConfig` (default `'include'` for cookie auth)
- Applies `AbortSignal.timeout(defaultTimeout)` to every request (default 30s). If a per-request `signal` is provided, it is passed directly to `fetch` instead of the timeout signal -- consumers who provide their own signal take full control of cancellation.
- Throws `ApiError` on non-2xx responses (callers use `isApiError()` type guard in catch blocks)
- Network errors (connection reset, DNS failure) propagate as native `TypeError` -- callers distinguish network failures (not `isApiError`) from API failures (`isApiError`) in catch blocks
- Passes `signal` from `RequestOptions` through to the underlying `fetch` call for consumer-controlled cancellation

**Design notes:**
- **Trust model:** The generic `<T>` return on get/post/put is an intentional tradeoff. This SDK is designed for use against a trusted, first-party ModulaCMS server where the API contract is known and version-matched. Server responses are not validated at runtime -- `response.json()` results are returned as-is with the declared type. If the SDK is ever used against an untrusted server or a server running a different API version, response data may not match the declared types. Consumers requiring runtime validation should use the `raw` method and validate themselves.
- Since `HttpClient` is internal, the generic `<T>` never leaks to consumers -- they only see concrete return types like `Promise<User>` from the resource methods.
- Request bodies use `Record<string, unknown>` because it's the simplest type that covers all request payloads including fields with `| null` values.

### CRUD Factory (`src/resource.ts`)

A single `createResource<Entity, CreateParams, UpdateParams>()` that covers 17 resources with identical patterns:

```typescript
type CrudResource<Entity, CreateParams, UpdateParams> = {
  list: (opts?: RequestOptions) => Promise<Entity[]>
  get: (id: string, opts?: RequestOptions) => Promise<Entity>
  create: (params: CreateParams, opts?: RequestOptions) => Promise<Entity>
  update: (params: UpdateParams, opts?: RequestOptions) => Promise<Entity>
  remove: (id: string, opts?: RequestOptions) => Promise<void>
}
```

The factory takes `(http: HttpClient, path: string)` and builds all 5 methods from the path.

**Update method ID handling:** The `UpdateParams` type for each resource always includes the entity's ID field (matching the Go backend where update params embed the ID). The factory serializes the full `UpdateParams` object as the PUT request body. The ID is part of the params, not a separate argument. For example, `UpdateUserParams` includes `user_id: string` -- the consumer passes the complete params object and the factory sends it as-is.

All methods throw `ApiError` on non-2xx responses (including 404 on `get`). This is the SDK convention -- callers handle errors via try/catch with the `isApiError()` type guard.

All methods accept an optional `RequestOptions` parameter (last argument) for `AbortSignal` support.

**Pagination:** The current API contract does not document `limit`/`offset` support on standard list endpoints. The `list` method initially takes no filter params. If the backend adds pagination support, a `ListParams` type will be added in a minor version bump.

Resources using this factory: `adminroutes`, `admincontentdatas`, `admincontentfields`, `admindatatypes`, `adminfields`, `contentdata`, `contentfields`, `datatype`, `fields`, `routes`, `media`, `mediadimensions`, `users`, `roles`, `tokens`, `usersoauth`, `tables`.

Admin routes gets an extended version with `listOrdered()` and `getBySlug(slug)`. Its base CRUD uses:
- `get` accepts a slug string (the API contract uses `GET /adminroutes/?q={slug}`)
- `remove` accepts a ULID string (the API contract uses `DELETE /adminroutes/?q={ulid}`)

This means admin routes has a split identifier: slug for most operations, but `remove` is overridden to accept a ULID instead.

### Client Entry Point (`src/index.ts`)

```typescript
type ClientConfig = {
  baseUrl: string
  apiKey?: string
  defaultTimeout?: number             // ms, applied as AbortSignal.timeout() on all requests. Default: 30000 (30s)
  credentials?: RequestCredentials    // 'include' | 'same-origin' | 'omit'. Default: 'include'
  allowInsecure?: boolean             // suppresses console warning for http:// baseUrl. Default: false
}

function createClient(config: ClientConfig): ModulaCMSClient
```

`createClient` validates config at construction time:
- Throws if `baseUrl` is not a valid URL
- Logs a console warning if `baseUrl` uses `http://` and `allowInsecure` is not explicitly `true` (warns about plaintext credential transmission). Setting `allowInsecure: true` suppresses the warning for local development.
- Throws if `apiKey` is provided but empty string
- Defaults `defaultTimeout` to `30000` (30 seconds) if not provided -- every request gets an `AbortSignal.timeout()` to prevent indefinite hangs
- Defaults `credentials` to `'include'` for cookie auth, but consumers can set `'same-origin'` or `'omit'` based on their deployment context

**Security note:** `apiKey` should only be used in server-side (Node.js) contexts. Never embed API keys in browser bundles -- use cookie authentication for browser clients instead.

The returned client object namespaces all resources:
```
client.auth.login(...)
client.adminRoutes.list()
client.adminRoutes.listOrdered()
client.adminTree.get(slug, format?)
client.adminContentData.create(...)
client.mediaUpload.upload(file)
client.sshKeys.list()
...
```

### Type Mapping (Go -> TypeScript)

ID types use plain `string` with JSDoc `@typedef` annotations for documentation. This keeps the type system simple while still communicating domain intent to consumers.

```typescript
/** @typedef {string} UserID - ULID identifying a user */
/** @typedef {string} AdminContentID - ULID identifying admin content */
/** @typedef {string} AdminRouteID - ULID identifying an admin route */
/** @typedef {string} RouteID - ULID identifying a route */
// ... etc for all ID types in STRUCT_REFERENCE.md
```

| Go Type | TypeScript |
|---------|-----------|
| `types.AdminContentID`, `types.UserID`, etc. | `string` (with JSDoc naming the domain) |
| `types.NullableContentID`, `types.NullableUserID`, etc. | `string \| null` |
| `sql.NullString` | `string \| null` |
| `sql.NullInt64` | `number \| null` |
| `types.Timestamp` | `string` (RFC 3339) |
| `types.ContentStatus` | Union of literal numbers (e.g., `0 \| 1 \| 2`) -- exact values TBD from backend |
| `types.FieldType` | Union of literal strings (e.g., `'text' \| 'number' \| 'date' \| 'media' \| 'relation'`) -- exact values TBD from backend |
| `types.Slug` | `string` |
| `types.Email` | `string` |
| `types.URL` | `string` |
| `types.JSONData` | `Record<string, unknown>` |
| `int64` | `number` |
| `bool` | `boolean` |

JSON field names use `snake_case` matching the API.

### Auth Endpoint Types (`src/types/auth.ts`)

```typescript
type LoginRequest = {
  email: string
  password: string
}

type LoginResponse = {
  user_id: string
  email: string
  username: string
  created_at: string  // Timestamp
}

type MeResponse = {
  user_id: string
  email: string
  username: string
  name: string
  role: string
}

type RegisterRequest = {
  username: string
  name: string
  email: string
  password: string  // plaintext -- server handles hashing. NOT the Hash field from CreateUserParams.
  role: string
}

type ResetRequest = {
  password: string  // new plaintext password -- server handles hashing
}
```

OAuth endpoints (`GET /auth/oauth/login`, `GET /auth/oauth/callback`) are browser-redirect flows, not JSON API calls. The SDK deliberately excludes them -- they are initiated by navigating the browser to the URL, not by calling an SDK method.

### Import Endpoint Types (`src/types/import.ts`)

```typescript
type ImportFormat = 'contentful' | 'sanity' | 'strapi' | 'wordpress' | 'clean'

type ImportResponse = {
  success: boolean
  datatypes_created: number
  fields_created: number
  content_created: number
  message: string
  errors: string[]
}
```

Import request bodies are format-specific JSON payloads. The SDK accepts `Record<string, unknown>` for import request bodies since the schema varies by format and is defined by the source CMS. Invalid payloads are rejected by the server with a 400 response.

### Admin Tree Response Type (`src/types/tree.ts`)

The `GET /admin/tree/{slug}` endpoint returns a nested content tree. The response is assembled from multiple database queries (content data, datatypes, fields, field values). Based on the `GetRouteTreeByRouteIDRow` struct:

```typescript
type ContentTreeField = {
  field_label: string
  field_type: FieldType
  field_value: string | null
}

type ContentTreeNode = {
  content_data_id: string
  parent_id: string | null
  first_child_id: string | null
  next_sibling_id: string | null
  prev_sibling_id: string | null
  datatype_label: string
  datatype_type: string
  fields: ContentTreeField[]
  children: ContentTreeNode[]
}

type AdminTreeResponse = {
  route: AdminRoute
  tree: ContentTreeNode[]
}

type TreeFormat = 'contentful' | 'sanity' | 'strapi' | 'wordpress' | 'clean' | 'raw'
```

**Note:** The exact response shape depends on the `?format=` parameter. The `raw` format returns the structure above. Other formats (contentful, sanity, etc.) transform the tree into the target CMS's schema. The SDK types cover the `raw` format; other formats return `Record<string, unknown>` since their shapes are defined by third-party CMS conventions.

### Error Handling

```typescript
type ApiError = {
  status: number
  message: string
  body?: unknown
}

function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as ApiError).status === 'number' &&
    'message' in err &&
    typeof (err as ApiError).message === 'string'
  )
}
```

Thrown on any non-2xx response. The `http.ts` layer constructs `ApiError` objects. When `response.json()` fails (e.g., HTML 502 from a proxy), `body` is `undefined` and `message` is set to the HTTP status text.

Since the SDK uses functional style (no classes), `ApiError` is a plain object -- callers use the exported `isApiError()` type guard to narrow in catch blocks instead of `instanceof`.

Network errors (connection reset, DNS failure) are not wrapped -- they propagate as native errors. Callers can distinguish: `isApiError(err)` means an HTTP response was received; `!isApiError(err)` means the request never completed.

---

## Deliberately Excluded

The following entities exist in `STRUCT_REFERENCE.md` but have no corresponding API endpoints in `API_CONTRACT.md`. They are excluded from the SDK's resource layer but their types are still defined in `src/types/` for use in nested responses (e.g., admin tree):

| Entity | Reason for Exclusion | Types Defined? |
|--------|---------------------|----------------|
| Backup, BackupSet, BackupVerification | Internal server operations, no API endpoints | No |
| ChangeEvent | Internal audit log, no API endpoints | No |
| Permissions | No CRUD API endpoints exposed | No |
| AdminDatatypeFields | Junction table, no standalone endpoint. Appears in tree responses. | Yes (in `admin.ts`) |
| AdminContentRelations | No standalone endpoint. Appears in tree responses. | Yes (in `admin.ts`) |
| ContentRelations | No standalone endpoint. Appears in tree responses. | Yes (in `content.ts`) |
| DatatypeFields | Junction table, no standalone endpoint. Appears in tree responses. | Yes (in `schema.ts`) |

**Content delivery endpoint** (`GET /{slug}`) is excluded per the "admin scope only" design choice. This is a public-facing endpoint for frontend content consumption, not admin management.

**OAuth redirect endpoints** (`GET /auth/oauth/login`, `GET /auth/oauth/callback`) are browser-redirect flows, not JSON API calls. They are initiated by navigating to the URL directly, not through SDK method calls.

---

## Implementation Order

1. **Project setup** - `package.json`, `tsconfig.json`, bun config
2. **Common types** - `src/types/common.ts` (base type aliases)
3. **Entity types** - All files in `src/types/` (translate every struct from STRUCT_REFERENCE.md)
4. **HTTP layer** - `src/http.ts`
5. **CRUD factory** - `src/resource.ts`
6. **Special resources** - `src/resources/auth.ts`, `admin-tree.ts`, `media-upload.ts`, `sessions.ts`, `ssh-keys.ts`, `import.ts`
7. **Client factory** - `src/index.ts` (wires everything together)
8. **Build verification** - `bun run build`, confirm types export correctly

---

## Build / Publish Config

**package.json:**
- `name`: `modulacms-sdk`
- `version`: `0.1.0`
- `type`: `module`
- `main`: `./dist/index.cjs` (CJS)
- `module`: `./dist/index.js` (ESM)
- `types`: `./dist/index.d.ts`
- `sideEffects`: `false` (enables tree-shaking)
- `files`: `["dist"]` (only publish built output)
- `scripts`:
  - `build`: `tsc && bun build src/index.ts --outdir dist --format esm --target browser && bun build src/index.ts --outdir dist --format cjs --target browser`
  - `typecheck`: `tsc --noEmit`
- Zero runtime dependencies

**`"exports"` map:**
```json
{
  ".": {
    "import": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "require": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.cjs"
    }
  }
}
```

**Dual CJS/ESM build pipeline:** `tsc` generates declaration files (`.d.ts`). `bun build` bundles the runtime code in both ESM and CJS formats. The build script runs `tsc` first for declarations, then `bun build` twice (once per format). A single set of `.d.ts` files serves both ESM and CJS consumers.

**tsconfig.json:**
- `target`: `ES2022`
- `module`: `ESNext`
- `moduleResolution`: `bundler`
- `strict`: `true`
- `declaration`: `true`
- `emitDeclarationOnly`: `true`
- `outDir`: `dist`

---

## Security Considerations

### Transport Security
- `createClient` warns on `http://` URLs by default. Setting `allowInsecure: true` suppresses the warning for local development. This prevents accidental plaintext transmission of API keys and session cookies in production while keeping the development experience frictionless.

### Credential Handling
- **API keys** should only be used in server-side (Node.js) contexts. The SDK documentation must warn against embedding API keys in browser bundles. Browser clients should use cookie authentication instead.
- **`credentials` is configurable** (default `'include'`). Consumers deploying the SDK cross-origin or in contexts where cookie leakage is a concern can set `'same-origin'` or `'omit'`.

### Sensitive Response Data
- The `Token` entity type includes the raw `token` string (API key value). The `UserOauth` entity type includes `access_token` and `refresh_token` (OAuth secrets). Consumers must treat responses from `client.tokens` and `client.usersoauth` as sensitive -- do not log, serialize to localStorage, or expose in client-side state without redaction.

### Trust Model
- The SDK assumes a trusted, first-party, version-matched ModulaCMS server. Server responses are not validated at runtime. If the server is compromised, returns unexpected shapes, or runs a different API version, the SDK will pass through malformed data as typed objects. Consumers requiring defense against untrusted servers should use the `raw` method and perform their own validation.

### Request Safety
- All requests have a default 30-second timeout via `AbortSignal.timeout()` to prevent resource exhaustion from hung connections.

---

## Verification

1. `bun run build` succeeds with no errors
2. `bun run typecheck` passes
3. Import `createClient` from built output and confirm types are available
4. Manual smoke test: create a client, call `client.auth.me()` against a running ModulaCMS instance

---

## Revisions from PLAN.md

Summary of changes applied from reality-check review:

1. **Branded types removed** -- All ID types use plain `string` with JSDoc annotations instead of `Brand<T, B>` generics. Reduces call-site friction without losing documentation.
2. **`exactOptionalPropertyTypes` dropped** -- The `undefined` vs omission distinction doesn't matter for JSON serialization.
3. **`verbatimModuleSyntax` dropped** -- `strict: true` covers the important cases for a v0.1 SDK.
4. **Single `.d.ts` set** -- Removed separate `.d.cts` declaration files. Modern TypeScript resolves correctly from one set.
5. **`noUncheckedIndexedAccess` dropped** -- Creates unnecessary friction when translating a known API contract.
6. **Import payload runtime validation removed** -- Server rejects malformed payloads with 400. No need to duplicate validation.
7. **`onUnauthorized` callback removed** -- Premature extensibility for v0.1. 401s throw `ApiError` like any other status. Consumers wrap their own error handling.
8. **`AbortSignal.any()` merging removed** -- Per-request `signal` replaces the default timeout signal instead of merging. Simpler mental model.
9. **`_tag` discriminant removed from `ApiError`** -- Type guard checks `status` (number) + `message` (string) directly. No ADT machinery needed.
10. **`Content-Type` response validation removed** -- `response.json()` already throws on non-JSON bodies. Manual header inspection is redundant.
11. **Network error wrapping removed** -- Native `TypeError` propagates as-is. `isApiError` vs `!isApiError` distinguishes HTTP responses from network failures.
12. **`allowInsecure` changed from hard throw to console warning** -- HTTP URLs produce a warning instead of throwing. `allowInsecure: true` suppresses the warning. Keeps dev experience frictionless.
