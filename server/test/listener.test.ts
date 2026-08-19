import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK_HOST, startServer } from '../src/index.js';

const servers: Awaited<ReturnType<typeof startServer>>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('loopback-only real listener', () => {
  it('binds a real socket exclusively to 127.0.0.1', async () => {
    const server = await startServer({ port: 0, logger: false });
    servers.push(server);

    const address = server.server.address() as AddressInfo;
    expect(address.address).toBe(LOOPBACK_HOST);
    expect(address.family).toBe('IPv4');
    expect(server.addresses()).toEqual([
      expect.objectContaining({ address: LOOPBACK_HOST, family: 'IPv4' }),
    ]);
  });

  it('still defaults to 127.0.0.1 when host is omitted', async () => {
    const server = await startServer({ port: 0, logger: false, serveStatic: false });
    servers.push(server);
    const address = server.server.address() as AddressInfo;
    expect(address.address).toBe(LOOPBACK_HOST);
  });
});
