/**
 * Core type utilities, branded ID types, enum unions, request options, and error shapes
 * for the ModulaCMS Admin SDK.
 *
 * @module types/common
 */

// ---------------------------------------------------------------------------
// Brand utility
// ---------------------------------------------------------------------------

/**
 * Nominal (branded) type utility that adds a compile-time tag to a base type.
 * Prevents accidental assignment between structurally identical but semantically
 * different types (e.g. `UserID` vs `RoleID`). The brand is erased at runtime
 * and carries zero cost.
 *
 * @typeParam T - The underlying primitive type.
 * @typeParam B - A unique string literal that distinguishes this brand.
 *
 * @example
 * ```ts
 * type OrderID = Brand<string, 'OrderID'>
 * const id = 'abc' as OrderID
 * ```
 */
export type Brand<T, B extends string> = T & { readonly __brand: B }

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Unique identifier for a user account. */
export type UserID = Brand<string, 'UserID'>

/** Unique identifier for an admin content data node. */
export type AdminContentID = Brand<string, 'AdminContentID'>

/** Unique identifier for an admin content field value. */
export type AdminContentFieldID = Brand<string, 'AdminContentFieldID'>

/** Unique identifier for an admin content relation. */
export type AdminContentRelationID = Brand<string, 'AdminContentRelationID'>

/** Unique identifier for an admin datatype definition. */
export type AdminDatatypeID = Brand<string, 'AdminDatatypeID'>

/** Unique identifier for an admin field definition. */
export type AdminFieldID = Brand<string, 'AdminFieldID'>

/** Unique identifier for an admin route. */
export type AdminRouteID = Brand<string, 'AdminRouteID'>

/** Unique identifier for a public content data node. */
export type ContentID = Brand<string, 'ContentID'>

/** Unique identifier for a public content field value. */
export type ContentFieldID = Brand<string, 'ContentFieldID'>

/** Unique identifier for a public content relation. */
export type ContentRelationID = Brand<string, 'ContentRelationID'>

/** Unique identifier for a datatype (schema) definition. */
export type DatatypeID = Brand<string, 'DatatypeID'>

/** Unique identifier for a field (schema) definition. */
export type FieldID = Brand<string, 'FieldID'>

/** Unique identifier for a media asset. */
export type MediaID = Brand<string, 'MediaID'>

/** Unique identifier for a user role. */
export type RoleID = Brand<string, 'RoleID'>

/** Unique identifier for a public route. */
export type RouteID = Brand<string, 'RouteID'>

/** Unique identifier for an active session. */
export type SessionID = Brand<string, 'SessionID'>

/** Unique identifier for a user OAuth connection. */
export type UserOauthID = Brand<string, 'UserOauthID'>

/** URL-safe slug string used to identify routes. */
export type Slug = Brand<string, 'Slug'>

/** Branded email address string. */
export type Email = Brand<string, 'Email'>

/** Branded URL string. */
export type URL = Brand<string, 'URL'>

// ---------------------------------------------------------------------------
// Enum unions
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a content item.
 *
 * - `'draft'` - Work in progress, not publicly visible.
 * - `'published'` - Live and publicly accessible.
 * - `'archived'` - Removed from public view but retained.
 * - `'pending'` - Awaiting review or approval.
 */
export type ContentStatus = 'draft' | 'published' | 'archived' | 'pending'

/**
 * Supported field types for content schema definitions.
 * Determines the editor widget and validation rules applied to a field.
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'media'
  | 'relation'
  | 'json'
  | 'richtext'
  | 'slug'
  | 'email'
  | 'url'

// ---------------------------------------------------------------------------
// Request options
// ---------------------------------------------------------------------------

/**
 * Optional per-request configuration passed to every SDK method.
 *
 * @example
 * ```ts
 * const controller = new AbortController()
 * const users = await client.users.list({ signal: controller.signal })
 * ```
 */
export type RequestOptions = {
  /** An {@link AbortSignal} to cancel the request. Merged with the default timeout signal. */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Structured error returned by the SDK when the API responds with a non-2xx status.
 * Distinguished from other errors by the `_tag` discriminant field.
 *
 * Network-level failures (DNS, connection refused) throw native `TypeError`
 * instead—use {@link isApiError} to differentiate.
 *
 * @example
 * ```ts
 * try {
 *   await client.users.get(id)
 * } catch (err) {
 *   if (isApiError(err)) {
 *     console.error(`API ${err.status}: ${err.message}`, err.body)
 *   }
 * }
 * ```
 */
export type ApiError = {
  /** Discriminant tag. Always `'ApiError'`. */
  readonly _tag: 'ApiError'
  /** HTTP status code from the response. */
  status: number
  /** HTTP status text (e.g. `'Not Found'`). */
  message: string
  /** Parsed JSON response body, if the server returned `application/json`. */
  body?: unknown
}

/**
 * Type guard that narrows an unknown caught value to {@link ApiError}.
 * Returns `false` for network errors, timeouts, and non-SDK exceptions.
 *
 * @param err - The caught error value to check.
 * @returns `true` if `err` is an {@link ApiError} with `_tag === 'ApiError'`.
 *
 * @example
 * ```ts
 * catch (err) {
 *   if (isApiError(err)) {
 *     // err is ApiError here
 *   }
 * }
 * ```
 */
export function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    '_tag' in err &&
    (err as ApiError)._tag === 'ApiError'
  )
}
