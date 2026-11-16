// Photo processing with sharp: auto-rotate, strip metadata, max 1600 px long
// edge, WebP. sharp is imported lazily so that text-only flows keep working
// even if the native module failed to load on the platform.

export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const MAX_EDGE = 1600;

export class ImageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageError';
    this.code = code; // 'too_large' | 'not_an_image' | 'unavailable'
  }
}

export async function processImage(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new ImageError('not_an_image', 'leere Datei');
  if (input.length > MAX_INPUT_BYTES) throw new ImageError('too_large', 'Datei zu groß');

  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (err) {
    throw new ImageError('unavailable', `sharp nicht ladbar: ${err.message}`);
  }

  const render = (quality) => sharp(input, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
    .rotate() // applies EXIF orientation; metadata is dropped on output by default
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  try {
    let out = await render(78);
    if (out.data.length > MAX_OUTPUT_BYTES) out = await render(60);
    if (out.data.length > MAX_OUTPUT_BYTES) throw new ImageError('too_large', 'Bild auch nach dem Verkleinern zu groß');
    return { bytes: out.data, width: out.info.width, height: out.info.height, mimeType: 'image/webp' };
  } catch (err) {
    if (err instanceof ImageError) throw err;
    throw new ImageError('not_an_image', `kein lesbares Bild: ${err.message}`);
  }
}
