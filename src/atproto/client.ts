/**
 * A thin, typed facade over `@atcute/client` for the repo operations rolld needs
 * (Phase 2). It keeps the atcute generics and the `repo`/`collection` plumbing in
 * one place so the rest of the app writes records without touching XRPC details.
 *
 * Constructed from an authenticated `Client` (an `OAuthUserAgent` handler) plus the
 * signed-in DID. Read-only public reads (other users' repos) can use a `Client`
 * built with `simpleFetchHandler` — see `reads` in Phase 3.
 */
import './register.js';
import { type Client, ok } from '@atcute/client';
import type { ActorIdentifier, Nsid } from '@atcute/lexicons/syntax';
import type { BlobRef } from '../records/types.js';

type Record_ = Record<string, unknown>;

export interface WriteResult {
  uri: string;
  cid: string;
}

export interface ListPage<T> {
  records: { uri: string; cid: string; value: T }[];
  cursor?: string;
}

export class RolldAgent {
  constructor(
    readonly rpc: Client,
    readonly did: string,
  ) {}

  private get repo(): ActorIdentifier {
    return this.did as ActorIdentifier;
  }

  /** Create a record; omit `rkey` to let the PDS assign a TID (used for plays). */
  async createRecord(collection: string, record: unknown, rkey?: string): Promise<WriteResult> {
    const data = await ok(
      this.rpc.post('com.atproto.repo.createRecord', {
        input: {
          repo: this.repo,
          collection: collection as Nsid,
          record: record as Record_,
          ...(rkey ? { rkey } : {}),
        },
      }),
    );
    return { uri: data.uri, cid: data.cid };
  }

  /** Create-or-replace at a known rkey (used for ratings keyed on the BGG id, profile=self). */
  async putRecord(collection: string, rkey: string, record: unknown): Promise<WriteResult> {
    const data = await ok(
      this.rpc.post('com.atproto.repo.putRecord', {
        input: {
          repo: this.repo,
          collection: collection as Nsid,
          rkey,
          record: record as Record_,
        },
      }),
    );
    return { uri: data.uri, cid: data.cid };
  }

  async deleteRecord(collection: string, rkey: string): Promise<void> {
    await ok(
      this.rpc.post('com.atproto.repo.deleteRecord', {
        input: { repo: this.repo, collection: collection as Nsid, rkey },
        as: null,
      }),
    );
  }

  /** Read one record from any repo (defaults to the signed-in user). Null if absent. */
  async getRecord<T>(collection: string, rkey: string, repo?: string): Promise<T | null> {
    try {
      const data = await ok(
        this.rpc.get('com.atproto.repo.getRecord', {
          params: { repo: (repo ?? this.did) as ActorIdentifier, collection: collection as Nsid, rkey },
        }),
      );
      return data.value as T;
    } catch {
      return null;
    }
  }

  /** Upload a blob (resized/compressed image ≤1MB, D-33) → a blob ref to embed. */
  async uploadBlob(bytes: Blob): Promise<BlobRef> {
    const data = await ok(
      this.rpc.post('com.atproto.repo.uploadBlob', {
        input: bytes,
        headers: { 'content-type': bytes.type || 'application/octet-stream' },
      }),
    );
    return data.blob as unknown as BlobRef;
  }
}
