/**
 * Repo reads. "My data" — my plays, my ratings — comes straight from the
 * user's OWN PDS via `listRecords`, no Constellation and no server (which is why
 * the personal dashboard keeps working even when Constellation is down). The same
 * `listRecords` reads any *public* repo for profile/play-log pages — Slingshot has
 * no list endpoint (D-23/D-26), so enumeration always hits the resolved PDS.
 *
 * A read-only public `Client` is built with `simpleFetchHandler` pointed at the
 * target PDS (from the MiniDoc); the signed-in user's own reads reuse their authed
 * agent's `Client`.
 */
import './../atproto/register.js';
import { Client, ok, simpleFetchHandler } from '@atcute/client';
import type { ActorIdentifier, Nsid } from '@atcute/lexicons/syntax';
import { COLLECTION } from '../config.js';
import type { PlayRecord, RatingRecord } from '../records/types.js';

/** A typed record as listed from a repo. */
export interface RepoRecord<T> {
  uri: string;
  cid: string;
  rkey: string;
  value: T;
}

export interface ListPage<T> {
  records: RepoRecord<T>[];
  cursor?: string;
}

/** A read-only client against a specific PDS (for public reads). */
export function pdsClient(pdsUrl: string): Client {
  return new Client({ handler: simpleFetchHandler({ service: pdsUrl }) });
}

const rkeyOf = (uri: string): string => uri.slice(uri.lastIndexOf('/') + 1);

/** Generic `listRecords` against a repo, mapped to typed `RepoRecord`s. */
export async function listRecords<T>(
  client: Client,
  repo: string,
  collection: string,
  opts: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<ListPage<T>> {
  const data = await ok(
    client.get('com.atproto.repo.listRecords', {
      params: {
        repo: repo as ActorIdentifier,
        collection: collection as Nsid,
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    }),
  );
  return {
    records: data.records.map((r) => ({
      uri: r.uri,
      cid: r.cid,
      rkey: rkeyOf(r.uri),
      value: r.value as T,
    })),
    ...(data.cursor ? { cursor: data.cursor } : {}),
  };
}

/** List a repo's plays (most PDSes return TID-keyed records newest-last; sort on read). */
export const listPlays = (
  client: Client,
  repo: string,
  opts?: { limit?: number; cursor?: string; signal?: AbortSignal },
): Promise<ListPage<PlayRecord>> => listRecords<PlayRecord>(client, repo, COLLECTION.play, opts);

export const listRatings = (
  client: Client,
  repo: string,
  opts?: { limit?: number; cursor?: string; signal?: AbortSignal },
): Promise<ListPage<RatingRecord>> => listRecords<RatingRecord>(client, repo, COLLECTION.rating, opts);

/** Read one record's value from a repo (e.g. a single entry permalink), or null. */
export async function getRecordValue<T>(
  client: Client,
  repo: string,
  collection: string,
  rkey: string,
): Promise<T | null> {
  try {
    const data = await ok(
      client.get('com.atproto.repo.getRecord', {
        params: { repo: repo as ActorIdentifier, collection: collection as Nsid, rkey },
      }),
    );
    return data.value as T;
  } catch {
    return null;
  }
}
