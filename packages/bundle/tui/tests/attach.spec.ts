import { describe, expect, it } from 'vitest'
import { attachDisplayName, detectImageMediaType, fallbackPendingAttachment, formatAttachChip, probeRasterSize } from '../src/attach.ts'

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

describe('attach helpers', () => {
  it('detects raster magic bytes and rejects plain text', () => {
    expect(detectImageMediaType(png)).toBe('image/png')
    expect(detectImageMediaType(jpeg)).toBe('image/jpeg')
    expect(detectImageMediaType(gif)).toBe('image/gif')
    expect(detectImageMediaType(webp)).toBe('image/webp')
    expect(detectImageMediaType(new Uint8Array([0x68, 0x69]))).toBeUndefined()
    expect(detectImageMediaType(new Uint8Array())).toBeUndefined()
  })

  it('formats a chip and strips directories from the display name', () => {
    expect(formatAttachChip('photo.png', 40)).toBe('image  photo.png')
    expect(formatAttachChip('a very long image name.png', 12)).toBe('image  a ve…')
    expect(attachDisplayName('/tmp/shots/photo.png')).toBe('photo.png')
    expect(attachDisplayName('photo.png')).toBe('photo.png')
  })

  it('accepts a minimal 69-byte 1×1 PNG from magic bytes and IHDR', () => {
    const tiny = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
      0, 0, 0, 12, 73, 68, 65, 84, 120, 218, 99, 96, 96, 96, 0, 0,
      0, 4, 0, 1, 200, 234, 235, 249, 0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130,
    ])
    expect(tiny.byteLength).toBe(69)
    expect(detectImageMediaType(tiny)).toBe('image/png')
    expect(probeRasterSize(tiny)).toEqual({ width: 1, height: 1 })
    expect(fallbackPendingAttachment('tui-test.png', tiny)).toEqual({
      name: 'tui-test.png',
      mediaType: 'image/png',
      attachmentId: 'local:tui-test.png:69',
      bytes: 69,
      width: 1,
      height: 1,
    })
  })
})
