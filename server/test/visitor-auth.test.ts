import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { isVisitorAllowlisted } from '../src/auth/token.js';
import { LibraryStore } from '../src/store/library-store.js';
import { LocalMediaStore } from '../src/store/local-media-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const mp4Bytes = Buffer.from('tiny-fake-mp4-payload-0123456789');
const TOKEN = 'secret';

describe('visitor allowlist auth', () => {
  let app: FastifyInstance;
  let tempDirectory: string;
  let store: SQLiteStore;
  let library: LibraryStore;
  let mediaRoot: string;
  let unitId: number;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-visitor-'));
    mediaRoot = path.join(tempDirectory, 'media');
    fs.mkdirSync(mediaRoot, { recursive: true });
    store = new SQLiteStore(path.join(tempDirectory, 'db.sqlite'));
    app = await buildServer({
      logger: false,
      serveStatic: false,
      authToken: TOKEN,
      dependencies: { store, mediaRoot },
    });
    await app.ready();
    library = new LibraryStore(store.db);

    fs.writeFileSync(path.join(mediaRoot, 'movie.mp4'), mp4Bytes);
    const work = library.upsertWork({ kind: 'movie', title: 'Local Movie' }, 1_000);
    const unit = library.upsertUnit({
      workId: work.id,
      kind: 'episode',
      ordinal: 0,
      title: 'Local Movie',
    }, 1_001);
    library.addAsset(
      { unitId: unit.id, kind: 'file', path: 'movie.mp4', sizeBytes: mp4Bytes.length },
      1_002,
    );
    unitId = unit.id;
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it('blocks the library while private', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/library' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('allows allowlisted routes for visitors when the library is public', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { visibility: 'public' },
    });
    expect(put.statusCode).toBe(200);

    const libraryResponse = await app.inject({ method: 'GET', url: '/api/library' });
    expect(libraryResponse.statusCode).toBe(200);

    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.statusCode).toBe(200);
    expect((settings.json() as { visitor: boolean }).visitor).toBe(true);
  });

  it('keeps non-allowlisted routes protected for visitors', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { visibility: 'public' },
    });
    expect(put.statusCode).toBe(200);

    const profiles = await app.inject({ method: 'GET', url: '/api/profiles' });
    expect(profiles.statusCode).toBe(401);

    const stream = await app.inject({ method: 'POST', url: '/api/stream/drama/1/0' });
    expect(stream.statusCode).toBe(401);

    const scan = await app.inject({ method: 'POST', url: '/api/library/scan' });
    expect(scan.statusCode).toBe(401);

    const hls = await app.inject({ method: 'GET', url: '/hls/x/playlist.m3u8' });
    expect(hls.statusCode).toBe(401);

    const media = await app.inject({ method: 'GET', url: '/media/movie/1/0/media.mp4' });
    expect(media.statusCode).toBe(401);
  });

  it('lets visitors stream units and track progress under a guest profile', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { visibility: 'public' },
    });
    expect(put.statusCode).toBe(200);

    const stream = await app.inject({ method: 'POST', url: `/api/library/units/${unitId}/stream` });
    expect(stream.statusCode).toBe(200);

    const progress = await app.inject({
      method: 'PUT',
      url: `/api/library/units/${unitId}/progress`,
      headers: { 'content-type': 'application/json' },
      payload: { pageIndex: 0, pageCount: 10 },
    });
    expect(progress.statusCode).toBe(200);
    const guestId = new LocalMediaStore(store.db).getGuestProfileId();
    expect(guestId).not.toBe(null);
    expect(guestId).not.toBe(1);
    expect(library.getProgress(guestId!, unitId)?.position).toBe(0);
    expect(library.getProgress(1, unitId)).toBe(null);

    const history = await app.inject({
      method: 'GET',
      url: '/api/history',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-profile-id': '1' },
    });
    expect(history.statusCode).toBe(200);
    expect((history.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('visitor home returns shelves without owner watch state', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { visibility: 'public' },
    });
    expect(put.statusCode).toBe(200);

    store.upsertHistory(1, {
      category: 'movie',
      id: 1_000,
      epIdx: 0,
      title: 'Local Movie',
      thumb: '',
      position_sec: 300,
      duration_sec: 1_000,
    });

    const visitorHome = await app.inject({ method: 'GET', url: '/api/home' });
    expect(visitorHome.statusCode).toBe(200);
    const visitorPayload = visitorHome.json() as {
      sections: Array<{ title: string }>;
      continueWatching: unknown[];
      nextUp: unknown[];
    };
    expect(visitorPayload.continueWatching.length).toBe(0);
    expect(visitorPayload.nextUp.length).toBe(0);
    expect(visitorPayload.sections.map((section) => section.title)).toContain('보관함');

    const ownerHome = await app.inject({
      method: 'GET',
      url: '/api/home',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-profile-id': '1' },
    });
    expect(ownerHome.statusCode).toBe(200);
    const ownerPayload = ownerHome.json() as { continueWatching: unknown[] };
    expect(ownerPayload.continueWatching.length).toBe(1);
  });

  it('never mixes visitor progress into an owner profile named Guest', async () => {
    const ownerGuest = store.createProfile('Guest');
    expect(ownerGuest.id).not.toBe(1);
    const localMedia = new LocalMediaStore(store.db);
    expect(localMedia.getGuestProfileId()).toBe(null);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { visibility: 'public' },
    });
    expect(put.statusCode).toBe(200);

    const progress = await app.inject({
      method: 'PUT',
      url: `/api/library/units/${unitId}/progress`,
      headers: { 'content-type': 'application/json' },
      payload: { pageIndex: 0, pageCount: 10 },
    });
    expect(progress.statusCode).toBe(200);

    // Owner's Guest profile history must be untouched.
    expect(library.getProgress(ownerGuest.id, unitId)).toBe(null);
    expect(library.getProgress(1, unitId)).toBe(null);

    const guestId = localMedia.getGuestProfileId();
    expect(guestId).not.toBe(null);
    expect(guestId).not.toBe(1);
    expect(guestId).not.toBe(ownerGuest.id);
    expect(library.getProgress(guestId!, unitId)?.position).toBe(0);

    const guestProfile = store.listProfiles().find((candidate) => candidate.id === guestId);
    expect(guestProfile?.name.startsWith('Guest (shared')).toBe(true);
  });
});

describe('visitor allowlist runtime table', () => {
  it('denies agent, metadata lookup, and library scan to visitors', () => {
    expect(isVisitorAllowlisted('POST', '/api/agent/turn')).toBe(false);
    expect(isVisitorAllowlisted('POST', '/api/metadata/lookup')).toBe(false);
    expect(isVisitorAllowlisted('POST', '/api/library/scan')).toBe(false);
  });
});
