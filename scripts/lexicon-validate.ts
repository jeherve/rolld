/**
 * Lexicon validation. Before the `at.rolld.*` schemas are published as a
 * public standard (D-37), they must be internally consistent: well-formed, ids
 * matching their filenames, and every cross-reference resolving. Publishing is a
 * commitment (the frozen-constraints rules, D-8, bind hard afterwards), so this is
 * the gate run before `goat lex` ever touches the network. Pure validator + a thin
 * runner; the runner exits non-zero on any problem.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LexiconFile {
  name: string; // filename, e.g. "play.json"
  doc: Record<string, unknown>;
}

const RECORD_TYPES = new Set(['at.rolld.play', 'at.rolld.rating', 'at.rolld.profile']);

/** Collect every def reference target the schemas declare (`<id>#<def>` and `#<def>`). */
function collectDefs(files: LexiconFile[]): Set<string> {
  const defs = new Set<string>();
  for (const { doc } of files) {
    const id = doc.id as string;
    const defObj = (doc.defs ?? {}) as Record<string, unknown>;
    for (const defName of Object.keys(defObj)) {
      defs.add(`${id}#${defName}`);
      defs.add(`#${defName}@${id}`); // local form, scoped to this file
    }
  }
  return defs;
}

/** Walk a value tree, yielding every `ref` string found. */
function* refs(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    for (const v of value) yield* refs(v);
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.ref === 'string') yield obj.ref;
    if (Array.isArray(obj.refs)) for (const r of obj.refs) if (typeof r === 'string') yield r;
    for (const v of Object.values(obj)) yield* refs(v);
  }
}

function isExternal(ref: string): boolean {
  // Anything outside the at.rolld namespace is a foreign schema we don't resolve here.
  return !ref.startsWith('at.rolld.') && !ref.startsWith('#');
}

/** Validate the whole lexicon set; returns human-readable problems (empty = valid). */
export function validateLexicons(files: LexiconFile[]): string[] {
  const errs: string[] = [];
  const defs = collectDefs(files);

  for (const { name, doc } of files) {
    const where = name;
    if (doc.lexicon !== 1) errs.push(`${where}: "lexicon" must be 1`);
    const id = doc.id;
    if (typeof id !== 'string' || !id.startsWith('at.rolld.')) {
      errs.push(`${where}: "id" must be an at.rolld.* NSID`);
      continue;
    }
    const expectedName = `${id.split('.').pop()}.json`;
    if (name !== expectedName) errs.push(`${where}: filename should be ${expectedName} for id ${id}`);

    const defObj = doc.defs as Record<string, unknown> | undefined;
    if (!defObj || typeof defObj !== 'object') {
      errs.push(`${where}: missing "defs"`);
      continue;
    }

    if (RECORD_TYPES.has(id)) {
      const main = defObj.main as Record<string, unknown> | undefined;
      if (!main || main.type !== 'record') errs.push(`${where}: record schema needs defs.main type "record"`);
      else {
        if (!main.key) errs.push(`${where}: record main needs a "key"`);
        const record = main.record as Record<string, unknown> | undefined;
        const required = (record?.required ?? []) as string[];
        // The two game-anchored records must require game + the frozen target (D-9).
        if (id === 'at.rolld.play' || id === 'at.rolld.rating') {
          for (const f of ['game', 'target']) {
            if (!required.includes(f)) errs.push(`${where}: must require "${f}" (D-9)`);
          }
        }
      }
    }

    // Every ref resolves: at.rolld.* must exist in the set; #local must exist in this file.
    for (const ref of refs(doc)) {
      if (isExternal(ref)) continue;
      const resolved = ref.startsWith('#') ? defs.has(`${ref}@${id}`) : defs.has(ref);
      if (!resolved) errs.push(`${where}: unresolved ref "${ref}"`);
    }
  }

  // gameRef must require id + name (the self-describing snapshot, D-7/D-32).
  const defsFile = files.find((f) => f.doc.id === 'at.rolld.defs');
  const gameRef = (defsFile?.doc.defs as Record<string, { required?: string[] }> | undefined)?.gameRef;
  for (const f of ['id', 'name']) {
    if (!gameRef?.required?.includes(f)) errs.push(`defs.json: gameRef must require "${f}" (D-32)`);
  }

  return errs;
}

/** Load the four lexicon JSONs from a directory. */
export function loadLexicons(dir: string): LexiconFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({ name, doc: JSON.parse(readFileSync(join(dir, name), 'utf8')) }));
}

// Runner: `tsx scripts/lexicon-validate.ts`
if (process.argv[1] && process.argv[1].endsWith('lexicon-validate.ts')) {
  const dir = join(process.cwd(), 'lexicons', 'at', 'rolld');
  const problems = validateLexicons(loadLexicons(dir));
  if (problems.length) {
    console.error('Lexicon validation failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('All at.rolld.* lexicons are valid and cross-references resolve.');
}
