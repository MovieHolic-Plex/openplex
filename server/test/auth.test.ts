import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOOPBACK_HOST, buildServer, startServer } from '../src/index.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const servers: FastifyInstance[] = [];
const tempDirectories: string[] = [];
const openStores: SQLiteStore[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('remote bind and token auth', () => {
  it('refuses a non-loopback bind when no token is configured', async () => {
    await expect(startServer({ port: 0, host: '0.0.0.0', logger: false })).rejects.toThrow(
      'OPENPLEX_AUTH_TOKEN is required when OPENPLEX_BIND is not loopback',
    );
  });

  it('binds 0.0.0.0 when a token is provided', async () => {
    const server = await startServer({
      port: 0,
      host: '0.0.0.0',
      authToken: 'secret-token',
      logger: false,
      serveStatic: false,
    });
    servers.push(server);
    const address = server.server.address() as AddressInfo;
    expect(address.address).toBe('0.0.0.0');
  });

  it('rejects protected routes without the token and accepts bearer, header, and query', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-auth-'));
    tempDirectories.push(directory);
    const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
    openStores.push(store);
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      authToken: 'secret-token',
      dependencies: { store, mediaRoot: path.join(directory, 'media') },
    });
    servers.push(app);
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const denied = await app.inject({ method: 'GET', url: '/api/profiles' });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error.code).toBe('AUTH_REQUIRED');

    const bearer = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(bearer.statusCode).toBe(200);

    const header = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { 'x-openplex-token': 'secret-token' },
    });
    expect(header.statusCode).toBe(200);

    const query = await app.inject({ method: 'GET', url: '/api/profiles?token=secret-token' });
    expect(query.statusCode).toBe(200);

    const wrong = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { authorization: 'Bearer other' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('keeps loopback access open when no token is configured', async () => {
    const server = await startServer({ port: 0, logger: false, serveStatic: false });
    servers.push(server);
    const address = server.server.address() as AddressInfo;
    expect(address.address).toBe(LOOPBACK_HOST);

    const app = await buildServer({ logger: false, serveStatic: false });
    servers.push(app);
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/profiles' });
    expect(response.statusCode).toBe(200);
  });
});
