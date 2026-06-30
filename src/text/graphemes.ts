/**
 * Grapheme-aware counting for the Bluesky share modal (CC-3, D-16). Bluesky's
 * 300-character post limit is measured in *graphemes* (user-perceived characters),
 * not bytes or UTF-16 code units — so an emoji or a combined character counts once.
 * The live counter in the modal must match what Bluesky enforces, or users get
 * surprise rejections. Pure logic, unit-tested.
 */

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Bluesky's post limit, in graphemes. */
export const BSKY_POST_LIMIT = 300;

/** Count user-perceived characters (graphemes). Falls back to code points if needed. */
export function countGraphemes(text: string): number {
  if (!segmenter) return [...text].length;
  const iterator = segmenter.segment(text)[Symbol.iterator]();
  let count = 0;
  while (!iterator.next().done) count++;
  return count;
}

/** Truncate to at most `max` graphemes without splitting a grapheme cluster. */
export function truncateGraphemes(text: string, max: number): string {
  if (max <= 0) return '';
  if (!segmenter) {
    const points = [...text];
    return points.length <= max ? text : points.slice(0, max).join('');
  }
  let count = 0;
  let end = text.length;
  for (const { index } of segmenter.segment(text)) {
    if (count === max) {
      end = index;
      break;
    }
    count++;
  }
  return count < max ? text : text.slice(0, end);
}

/** Graphemes remaining against a limit (negative when over). */
export function graphemesRemaining(text: string, limit = BSKY_POST_LIMIT): number {
  return limit - countGraphemes(text);
}
