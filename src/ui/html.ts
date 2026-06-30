/**
 * Auto-escaping `html` tagged-template helper (D-19).
 *
 * rolld renders from data with plain template literals. Every interpolated value
 * is HTML-escaped by default, so this is the first line of XSS defence for any
 * user content rendered outside the Markdown pipeline (handles, notes shown as
 * plain text, game names from BGG, …). Markdown notes go through their own
 * sanitizer (D-20) and are then wrapped with `raw()` to opt out of double-escaping.
 *
 * Contract:
 *   - interpolated strings / numbers      → escaped
 *   - interpolated `SafeHtml` (a nested  → inserted verbatim (already safe)
 *     `html`…`` result, or `raw(...)`)
 *   - arrays                              → joined, each item handled per its type
 *   - null / undefined / false            → empty string (convenient for `cond && html`…``)
 */

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escape the five characters that can break out of text / attribute context. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPE[c]!);
}

/** A string that is already safe to inject as HTML. Never built directly from untrusted input. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/**
 * Mark a string as trusted HTML (skips escaping). Only pass markup you produced
 * or ran through a sanitizer — e.g. the output of the Markdown pipeline (D-20).
 */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

type Interpolated = SafeHtml | string | number | null | undefined | false | Interpolated[];

function resolve(value: Interpolated): string {
  if (value == null || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(resolve).join('');
  return escapeHtml(String(value));
}

/** The tagged-template entry point. Returns a `SafeHtml` so results nest without re-escaping. */
export function html(strings: TemplateStringsArray, ...values: Interpolated[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += resolve(values[i] ?? null) + (strings[i + 1] ?? '');
  }
  return new SafeHtml(out);
}

/** Replace a container's contents with rendered markup. The render-from-state primitive. */
export function render(container: Element, ...parts: SafeHtml[]): void {
  container.innerHTML = parts.map((p) => p.value).join('');
}
