/**
 * Upload a play photo and produce the embedded `defs#image` (D-33). One upload to
 * the user's PDS yields a blob ref reused three ways (the play record, the bsky
 * embed, the per-game gallery) — this helper does the upload half: resize/compress
 * (≤1MB), `uploadBlob`, then assemble the embed with its required alt text and
 * aspect ratio.
 */
import { prepareImage } from '../ui/image.js';
import type { ImageEmbed } from '../records/types.js';
import type { RolldAgent } from './client.js';

export async function uploadAndEmbed(
  agent: RolldAgent,
  file: File,
  alt: string,
): Promise<ImageEmbed> {
  const { blob, aspectRatio } = await prepareImage(file);
  const ref = await agent.uploadBlob(blob);
  return { image: ref, alt: alt.trim() || 'A board game photo', aspectRatio };
}
