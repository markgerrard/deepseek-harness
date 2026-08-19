/**
 * Local-path image attach for the TUI. Terminals do not deliver clipboard
 * images to Ink, so `/attach <path>` reads a file and hands it to
 * `ctx.attachments.saveImage`. If the store rejects a tiny-but-valid
 * raster, magic-byte headers still produce a chip. Non-images become
 * an `@path` mention.
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

function readU32BE(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 24 | (data[offset + 1] ?? 0) << 16
    | (data[offset + 2] ?? 0) << 8 | (data[offset + 3] ?? 0)) >>> 0
}

function readU16LE(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)
}

/**
 * Read intrinsic width/height from a raster header. Used when
 * `ctx.attachments.saveImage` refuses a tiny-but-valid file.
 * @param data - file bytes.
 * @returns dimensions, or undefined when the header is too short.
 */
export function probeRasterSize(data: Uint8Array): { width: number; height: number } | undefined {
  const mediaType = detectImageMediaType(data)
  if (mediaType === 'image/png' && data.length >= 24
    && data[12] === 0x49 && data[13] === 0x48 && data[14] === 0x44 && data[15] === 0x52) {
    const width = readU32BE(data, 16)
    const height = readU32BE(data, 20)
    if (width > 0 && height > 0) return { width, height }
  }
  if (mediaType === 'image/gif' && data.length >= 10) {
    const width = readU16LE(data, 6)
    const height = readU16LE(data, 8)
    if (width > 0 && height > 0) return { width, height }
  }
  if (mediaType === 'image/jpeg') {
    const sof = jpegSofSize(data)
    if (sof !== undefined) return sof
  }
  if (mediaType === 'image/webp' && data.length >= 30) {
    const width = readU16LE(data, 26) & 0x3fff
    const height = readU16LE(data, 28) & 0x3fff
    if (width > 0 && height > 0) return { width, height }
  }
  if (mediaType !== undefined) return { width: 1, height: 1 }
  return undefined
}

function jpegSofSize(data: Uint8Array): { width: number; height: number } | undefined {
  let i = 2
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) break
    const marker = data[i + 1] ?? 0
    const size = ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = ((data[i + 5] ?? 0) << 8) | (data[i + 6] ?? 0)
      const width = ((data[i + 7] ?? 0) << 8) | (data[i + 8] ?? 0)
      if (width > 0 && height > 0) return { width, height }
      return undefined
    }
    if (size < 2) break
    i += 2 + size
  }
  return undefined
}

/**
 * Build a pending chip from magic bytes when the DSH store rejects the file.
 * @param name - display name.
 * @param data - file bytes already verified as a raster.
 * @returns a local pending attachment.
 */
export function fallbackPendingAttachment(name: string, data: Uint8Array): PendingAttachment | undefined {
  const mediaType = detectImageMediaType(data)
  if (mediaType === undefined) return undefined
  const size = probeRasterSize(data) ?? { width: 1, height: 1 }
  return {
    name,
    mediaType,
    attachmentId: `local:${name}:${data.byteLength}`,
    bytes: data.byteLength,
    width: size.width,
    height: size.height,
  }
}
