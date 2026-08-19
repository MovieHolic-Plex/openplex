import { describe, it, expect } from 'vitest';
import { buildServer } from './index.js';

describe('Server health check', () => {
  it('should return 200 and status ok for /health', async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });
});
