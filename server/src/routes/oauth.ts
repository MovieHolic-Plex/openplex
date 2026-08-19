import type { FastifyInstance } from 'fastify';
import type { GptOauthSession } from '../agent/gpt-oauth.js';
import { ApiError } from './errors.js';

export function registerOauthRoutes(
  fastify: FastifyInstance,
  options: { readonly session?: GptOauthSession },
): void {
  fastify.get('/api/agent/oauth/start', async () => {
    if (!options.session) {
      throw new ApiError(503, 'AGENT_OAUTH_UNAVAILABLE', 'GPT OAuth is not configured');
    }
    return options.session.start();
  });

  fastify.post(
    '/api/agent/oauth/exchange',
    {
      schema: {
        body: {
          type: 'object',
          required: ['code', 'state'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', minLength: 1 },
            state: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      if (!options.session) {
        throw new ApiError(503, 'AGENT_OAUTH_UNAVAILABLE', 'GPT OAuth is not configured');
      }
      const { code, state } = request.body as { code: string; state: string };
      try {
        const token = await options.session.exchange({ code, state });
        return { authorized: true, expiresAt: token.expiresAt };
      } catch (error) {
        if (error instanceof Error) {
          throw new ApiError(400, 'AGENT_OAUTH_FAILED', error.message);
        }
        throw error;
      }
    },
  );

  fastify.get('/api/agent/oauth/status', async () => ({
    configured: options.session !== undefined,
    authorized: options.session?.hasToken() === true,
  }));

  fastify.get(
    '/api/agent/oauth/callback',
    async (request) => {
      if (!options.session) {
        throw new ApiError(503, 'AGENT_OAUTH_UNAVAILABLE', 'GPT OAuth is not configured');
      }
      const query = request.query as { code?: string; state?: string };
      if (!query.code || !query.state) {
        throw new ApiError(400, 'AGENT_OAUTH_FAILED', 'code and state are required');
      }
      try {
        const token = await options.session.exchange({ code: query.code, state: query.state });
        return { authorized: true, expiresAt: token.expiresAt };
      } catch (error) {
        if (error instanceof Error) {
          throw new ApiError(400, 'AGENT_OAUTH_FAILED', error.message);
        }
        throw error;
      }
    },
  );
}
