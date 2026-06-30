import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLexicons, validateLexicons, type LexiconFile } from '../scripts/lexicon-validate.js';

const DIR = resolve(process.cwd(), 'lexicons/at/rolld');
const FILES = loadLexicons(DIR);

describe('at.rolld.* lexicons (Phase 5 publish gate)', () => {
  it('loads all four schemas', () => {
    expect(FILES.map((f) => f.doc.id).sort()).toEqual([
      'at.rolld.defs',
      'at.rolld.play',
      'at.rolld.profile',
      'at.rolld.rating',
    ]);
  });

  it('is internally consistent with every cross-reference resolving', () => {
    expect(validateLexicons(FILES)).toEqual([]);
  });

  it('catches a record that drops the frozen target (D-9)', () => {
    const broken: LexiconFile[] = FILES.map((f) =>
      f.doc.id === 'at.rolld.play'
        ? {
            name: f.name,
            doc: {
              ...f.doc,
              defs: {
                main: {
                  ...(f.doc.defs as { main: object }).main,
                  record: { type: 'object', required: ['game'], properties: {} },
                },
              },
            },
          }
        : f,
    );
    expect(validateLexicons(broken)).toContain('play.json: must require "target" (D-9)');
  });

  it('catches an unresolved internal ref', () => {
    const broken: LexiconFile[] = [
      { name: 'play.json', doc: { lexicon: 1, id: 'at.rolld.play', defs: { main: { type: 'record', key: 'tid', record: { required: ['game', 'target'], properties: { game: { type: 'ref', ref: 'at.rolld.defs#nope' } } } } } } },
      ...FILES.filter((f) => f.doc.id !== 'at.rolld.play'),
    ];
    expect(validateLexicons(broken)).toContain('play.json: unresolved ref "at.rolld.defs#nope"');
  });
});
