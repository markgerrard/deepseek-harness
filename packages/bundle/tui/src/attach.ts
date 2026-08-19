/**
 * Local-path image attach for the TUI. Terminals do not deliver clipboard
 * images to Ink, so `/attach <path>` reads a file and hands it to
 * `ctx.attachments.saveImage`. Non-images become an `@path` mention.
 * @module @deepseek-ai/dsh-tui/attach
 */

/** Raster types `ctx.attachments` accepts. */
export type AttachMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One pending image waiting to ride the next submitted prompt. */
export interface PendingAttachment {
  readonly name: string
  readonly mediaType: AttachMediaType
  readonly attachmentId: string
  readonly bytes: number
  readonly width: number
  readonly height: number
}

/**
 * Detect a raster media type from magic bytes. Extension is not trusted.
 * @param data - file bytes.
 * @returns a supported media type, or undefined when this is not a raster.
 */
export function detectImageMediaType(data: Uint8Array): AttachMediaType | undefined {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (data.length >= 6
    && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38
    && (data[4] === 0x37 || data[4] === 0x39) && data[5] === 0x61) {
    return 'image/gif'
  }
  if (data.length >= 12
    && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return 'image/webp'
  }
  return undefined
}

/**
 * One muted chip above the prompt for a pending image.
 * @param name - display name (basename, never a full path).
 * @param width - available columns.
 * @returns `image  photo.png`, truncated.
 */
export function formatAttachChip(name: string, width: number): string {
  const collapsed = name.replace(/\s+/g, ' ').trim() || 'image'
  const line = `image  ${collapsed}`
  if (width <= 0) return ''
  if (line.length <= width) return line
  if (width === 1) return '…'
  return `${line.slice(0, width - 1)}…`
}

/**
 * Basename with local directories stripped. Used as the attachment display name.
 * @param path - user-typed path.
 * @returns the last path segment.
 */
export function attachDisplayName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  const last = parts[parts.length - 1]
  return last === undefined || last === '' ? 'image' : last
}
