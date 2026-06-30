/**
 * Markdown → plain text, for the record's `textContent` field (D-11). When a user
 * writes a Markdown note, the write path stores BOTH the `content` markpub object
 * AND a plain-text rendering here — `textContent` is the universal fallback for any
 * consumer that can't render the union's `$type`, and the field to index for
 * search/previews (the same discipline standard.site applies).
 *
 * This is the lightweight strip-formatting pass. The full Markdown → *sanitized
 * HTML* renderer (D-20) is a read/display-side concern; this pure
 * reduction is all the write path needs. Unit-tested.
 */

/** Reduce Markdown to readable plain text (strip syntax, keep the words). */
export function markdownToPlain(markdown: string): string {
  let text = markdown;

  // Fenced code blocks → their inner text (drop the fences + language hint).
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => code);
  text = text.replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, (_m, code: string) => code);

  // Images ![alt](url) → alt; links [text](url) → text; bare autolinks <url> → url.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/<((?:https?|mailto):[^>]+)>/g, '$1');

  // Inline code, emphasis, strikethrough markers.
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)(.+?)\1/g, '$2');

  // Block prefixes: headings, blockquotes, list bullets, numbered list markers.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, '');

  // Horizontal rules → gone. Stray HTML tags → gone.
  text = text.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '');
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // Collapse 3+ blank lines to a single paragraph break; trim trailing spaces.
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
