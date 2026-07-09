/**
 * rpg.actor presence (D-60). rpg.actor is a sibling atproto app: it keeps RPG
 * characters — a pixel sprite and per-system stat sheets — as records on each
 * user's OWN PDS, keyed on the same DIDs rolld already reads. So a rolld profile
 * can surface "this person also plays RPGs on rpg.actor" for FREE: a read over the
 * same repo, no rolld lexicon, nothing written, no dependency on rpg.actor's server
 * (records come straight from the owner's PDS via the same `pdsClient` the play log
 * uses). Two apps composing over one identity the user owns — the atproto dream.
 *
 * Everything here is defensive: these records are authored by another app and
 * fetched from arbitrary PDSes, cast with no runtime check, so a missing or
 * malformed field must degrade to "absent", never throw. Zero usable records →
 * `fetchRpgActorPresence` returns `null` and the profile card stays dormant, the
 * same way the atstore review flow does when unconfigured (D-59).
 *
 * The pure shape logic (`summarizeSystems`, `spriteFrame`) is unit-tested; the
 * network is mocked at the `getRecordValue`/`listRecords` boundary.
 */
import type { Client } from '@atcute/client';
import { getRecordValue, listRecords, type RepoRecord } from './repo.js';

/** rpg.actor's collections (their namespace, not ours — we only ever read them). */
export const RPG_STATS_COLLECTION = 'actor.rpg.stats';
export const RPG_SPRITE_COLLECTION = 'actor.rpg.sprite';
/** The sprite sheet lives at a fixed rkey; the deprecated stats aggregate shares it. */
export const RPG_SELF_RKEY = 'self';

/** A blob reference as it appears in a record value (guarded on read). */
interface BlobRef {
  ref?: { $link?: string };
}

/** The `actor.rpg.sprite/self` record — a sprite sheet plus its self-describing grid. */
export interface RpgSprite {
  spriteSheet?: BlobRef;
  columns?: number;
  rows?: number;
  frameWidth?: number;
  frameHeight?: number;
  width?: number;
  height?: number;
}

/** One `actor.rpg.stats` record: a character sheet for a single game system. */
export interface RpgStatsValue {
  system?: string;
  data?: unknown;
}

/** A game system the person keeps a character in, with a display name. */
export interface RpgSystem {
  system: string;
  name: string;
}

/**
 * Where one frame of the sprite sheet sits, so the card can crop to a single
 * portrait instead of showing the whole 12-frame sheet. All numbers in the sheet's
 * own pixels; the view scales with `image-rendering: pixelated`.
 */
export interface SpriteFrame {
  frameW: number;
  frameH: number;
  sheetW: number;
  sheetH: number;
  /** Background-position for the front-idle frame (negative offsets), in px. */
  offsetX: number;
  offsetY: number;
}

/** What a profile owner has on rpg.actor. `null` from the fetch means nothing at all. */
export interface RpgActorPresence {
  did: string;
  /** The front-idle sprite portrait, or null if they have no sprite. */
  sprite: { cid: string; frame: SpriteFrame } | null;
  /** The systems they keep characters in (may be empty if only a sprite exists). */
  systems: RpgSystem[];
}

/**
 * Friendly labels for rpg.actor's reserved system keys (display only — extend
 * freely). A named record carries its own `data._meta.name`; these cover the
 * built-in systems that don't, so we show "D&D" rather than the raw "dnd" key.
 */
const KNOWN_SYSTEM_LABELS: Record<string, string> = {
  dnd: 'D&D',
  dcc: 'DCC',
  mage: 'Mage',
  cyberpunk2020: 'Cyberpunk 2020',
  vampire: 'Vampire',
  rmmz: 'RPG Maker MZ',
  reverie: 'Reverie',
  playtopia: 'Playtopia',
};

/** A positive integer from untrusted data, or a fallback. */
const posInt = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

/** The display name a stats record wants, if it declared one (`data._meta.name`). */
function declaredName(value: RpgStatsValue): string {
  const data = value.data;
  if (data && typeof data === 'object' && '_meta' in data) {
    const meta = (data as { _meta?: unknown })._meta;
    if (meta && typeof meta === 'object' && 'name' in meta) {
      const name = (meta as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return '';
}

/**
 * Reduce a repo's `actor.rpg.stats` records to a de-duplicated system list. The
 * per-system rkey IS the system key by design, so a record whose `system` field is
 * missing still counts (fall back to its rkey); the deprecated `self` aggregate is
 * dropped. Name preference: the record's own `_meta.name`, then a known label, then
 * the raw key — honest over pretty. First occurrence wins; order is preserved.
 */
export function summarizeSystems(records: RepoRecord<RpgStatsValue>[]): RpgSystem[] {
  const seen = new Set<string>();
  const out: RpgSystem[] = [];
  for (const record of records) {
    const value = record.value;
    const key =
      typeof value.system === 'string' && value.system.trim() ? value.system.trim() : record.rkey;
    if (key === RPG_SELF_RKEY || seen.has(key)) continue;
    seen.add(key);
    out.push({ system: key, name: declaredName(value) || KNOWN_SYSTEM_LABELS[key] || key });
  }
  return out;
}

/**
 * The front-idle frame of the sprite sheet. rpg.actor sheets are RPG Maker-style
 * grids that describe themselves (`columns`/`rows`/`frameWidth`/`frameHeight`);
 * missing fields fall back to the standard 3×4 / 48px layout. Front-idle is the top
 * row (facing the viewer), middle column (the standing pose) — the natural portrait.
 */
export function spriteFrame(sprite: RpgSprite): SpriteFrame {
  const columns = posInt(sprite.columns, 3);
  const rows = posInt(sprite.rows, 4);
  const frameW = posInt(sprite.frameWidth, Math.floor(posInt(sprite.width, columns * 48) / columns) || 48);
  const frameH = posInt(sprite.frameHeight, Math.floor(posInt(sprite.height, rows * 48) / rows) || 48);
  const midColumn = Math.floor(columns / 2);
  return {
    frameW,
    frameH,
    sheetW: frameW * columns,
    sheetH: frameH * rows,
    // Guard the single-column case so the offset is a clean 0, not -0.
    offsetX: midColumn > 0 ? -(midColumn * frameW) : 0,
    offsetY: 0,
  };
}

/**
 * Read a DID's public rpg.actor presence from its PDS. The sprite and the stats
 * list are fetched together; either failing degrades to absent (a repo with no
 * rpg.actor records simply 404s the sprite and lists nothing). Returns `null` when
 * there is neither a sprite nor a single system — the caller then renders nothing,
 * so the card only ever appears for people who are actually on rpg.actor.
 */
export async function fetchRpgActorPresence(
  client: Client,
  did: string,
): Promise<RpgActorPresence | null> {
  const [spriteValue, statsPage] = await Promise.all([
    getRecordValue<RpgSprite>(client, did, RPG_SPRITE_COLLECTION, RPG_SELF_RKEY),
    listRecords<RpgStatsValue>(client, did, RPG_STATS_COLLECTION, { limit: 100 }).catch(() => ({
      records: [] as RepoRecord<RpgStatsValue>[],
    })),
  ]);

  const cid =
    spriteValue && typeof spriteValue.spriteSheet?.ref?.$link === 'string'
      ? spriteValue.spriteSheet.ref.$link
      : '';
  const sprite = cid ? { cid, frame: spriteFrame(spriteValue!) } : null;
  const systems = summarizeSystems(statsPage.records);

  if (!sprite && systems.length === 0) return null;
  return { did, sprite, systems };
}
