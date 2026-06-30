/**
 * Client-side image prep for play photos (D-33): resize/compress to ≤1MB before
 * upload (the user's PDS storage is theirs, so keep blobs light) and read the
 * natural dimensions for `aspectRatio` (clean layout without loading the blob). The
 * canvas work only runs in the browser; it's DOM glue, lightly relied on.
 */
import type { AspectRatio } from '../records/types.js';

export interface PreparedImage {
  blob: Blob;
  aspectRatio: AspectRatio;
}

const MAX_BYTES = 1_000_000;
const MAX_DIMENSION = 1600;

/** Resize an image file down to ≤1MB and return the blob + its aspect ratio. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const aspectRatio = { width: bitmap.width, height: bitmap.height };

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Step quality down until the blob fits the cap.
  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_BYTES && quality > 0.4) {
    quality -= 0.15;
    blob = await canvasToBlob(canvas, quality);
  }
  return { blob, aspectRatio };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}
