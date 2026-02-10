/**
 * Media asset entity types and their create/update parameter shapes.
 *
 * @module types/media
 */

import type { MediaID, URL, UserID } from './common.js'

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

/**
 * A media asset (image, video, document, etc.) stored in the CMS.
 */
export type Media = {
  /** Unique identifier for this media asset. */
  media_id: MediaID
  /** Internal filename, or `null`. */
  name: string | null
  /** Human-readable display name, or `null`. */
  display_name: string | null
  /** Alternative text for accessibility, or `null`. */
  alt: string | null
  /** Caption text, or `null`. */
  caption: string | null
  /** Extended description, or `null`. */
  description: string | null
  /** CSS class name for styling, or `null`. */
  class: string | null
  /** MIME type (e.g. `'image/png'`), or `null`. */
  mimetype: string | null
  /** JSON-encoded dimension data, or `null`. */
  dimensions: string | null
  /** Primary URL where the asset is served. */
  url: URL
  /** Responsive `srcset` attribute value, or `null`. May be `null` initially after upload while async processing completes. */
  srcset: string | null
  /** ID of the user who uploaded this asset, or `null`. */
  author_id: UserID | null
  /** ISO 8601 creation timestamp. */
  date_created: string
  /** ISO 8601 last-modification timestamp. */
  date_modified: string
}

/**
 * A named dimension preset for responsive media rendering.
 */
export type MediaDimension = {
  /** Unique identifier for this dimension preset. */
  md_id: string
  /** Human-readable label (e.g. `'thumbnail'`, `'hero'`), or `null`. */
  label: string | null
  /** Target width in pixels, or `null` for unconstrained. */
  width: number | null
  /** Target height in pixels, or `null` for unconstrained. */
  height: number | null
  /** Aspect ratio string (e.g. `'16:9'`), or `null`. */
  aspect_ratio: string | null
}

// ---------------------------------------------------------------------------
// Create params
// ---------------------------------------------------------------------------

/** Parameters for creating a media record via `POST /media`. */
export type CreateMediaParams = {
  /** Internal filename, or `null`. */
  name: string | null
  /** Display name, or `null`. */
  display_name: string | null
  /** Alt text, or `null`. */
  alt: string | null
  /** Caption, or `null`. */
  caption: string | null
  /** Description, or `null`. */
  description: string | null
  /** CSS class, or `null`. */
  class: string | null
  /** MIME type, or `null`. */
  mimetype: string | null
  /** JSON-encoded dimensions, or `null`. */
  dimensions: string | null
  /** Primary asset URL. */
  url: URL
  /** Srcset value, or `null`. */
  srcset: string | null
  /** Author user ID, or `null`. */
  author_id: UserID | null
  /** ISO 8601 creation timestamp. */
  date_created: string
  /** ISO 8601 modification timestamp. */
  date_modified: string
}

/** Parameters for creating a media dimension preset via `POST /mediadimensions`. */
export type CreateMediaDimensionParams = {
  /** Label for this dimension, or `null`. */
  label: string | null
  /** Width in pixels, or `null`. */
  width: number | null
  /** Height in pixels, or `null`. */
  height: number | null
  /** Aspect ratio string, or `null`. */
  aspect_ratio: string | null
}

// ---------------------------------------------------------------------------
// Update params
// ---------------------------------------------------------------------------

/** Parameters for updating a media record via `PUT /media/`. */
export type UpdateMediaParams = {
  /** ID of the media asset to update. */
  media_id: MediaID
  /** Updated filename, or `null`. */
  name: string | null
  /** Updated display name, or `null`. */
  display_name: string | null
  /** Updated alt text, or `null`. */
  alt: string | null
  /** Updated caption, or `null`. */
  caption: string | null
  /** Updated description, or `null`. */
  description: string | null
  /** Updated CSS class, or `null`. */
  class: string | null
  /** Updated MIME type, or `null`. */
  mimetype: string | null
  /** Updated dimensions JSON, or `null`. */
  dimensions: string | null
  /** Updated URL. */
  url: URL
  /** Updated srcset, or `null`. */
  srcset: string | null
  /** Author user ID, or `null`. */
  author_id: UserID | null
  /** ISO 8601 creation timestamp. */
  date_created: string
  /** ISO 8601 modification timestamp. */
  date_modified: string
}

/** Parameters for updating a media dimension preset via `PUT /mediadimensions/`. */
export type UpdateMediaDimensionParams = {
  /** ID of the dimension preset to update. */
  md_id: string
  /** Updated label, or `null`. */
  label: string | null
  /** Updated width, or `null`. */
  width: number | null
  /** Updated height, or `null`. */
  height: number | null
  /** Updated aspect ratio, or `null`. */
  aspect_ratio: string | null
}
