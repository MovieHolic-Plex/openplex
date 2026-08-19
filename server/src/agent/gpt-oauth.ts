import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type GptOauthToken = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
  readonly tokenType: string;
};

export type GptOauthStart = {
  readonly authorizeUrl: string;
  readonly state: string;
};

export interface GptOauthStore {
  get(): GptOauthToken | null;
  set(token: GptOauthToken): void;
  clear(): void;
}

export class FileGptOauthStore implements GptOauthStore {
  constructor(private readonly filePath: string) {}

  public get(): GptOauthToken | null {
    if (!fs.existsSync(this.filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<GptOauthToken>;
    if (typeof raw.accessToken !== 'string' || raw.accessToken.length === 0) return null;
    return {
      accessToken: raw.accessToken,
      refreshToken: typeof raw.refreshToken === 'string' ? raw.refreshToken : null,
      expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : null,
      tokenType: typeof raw.tokenType === 'string' ? raw.tokenType : 'Bearer',
    };
  }

  public set(token: GptOauthToken): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(token));
  }

  public clear(): void {
    if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
  }
}

type PendingAuth = {
  readonly state: string;
  readonly verifier: string;
};

export type GptOauthSessionOptions = {
  readonly store: GptOauthStore;
  readonly clientId: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly redirectUri: string;
  readonly scope?: string;
  readonly chatUrl?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

export class GptOauthSession {
  private pending: PendingAuth | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: GptOauthSessionOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  public get chatUrl(): string {
    return this.options.chatUrl ?? 'https://api.openai.com/v1/chat/completions';
  }

  public get model(): string {
    return this.options.model ?? 'gpt-4o-mini';
  }

  public start(): GptOauthStart {
    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    this.pending = { state, verifier };
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(this.options.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('scope', this.options.scope ?? 'openid profile email');
    return { authorizeUrl: url.toString(), state };
  }

  public async exchange(input: { readonly code: string; readonly state: string }): Promise<GptOauthToken> {
    if (!this.pending || this.pending.state !== input.state) {
      throw new Error('OAuth state is invalid');
    }
    const token = await this.requestToken({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: this.options.redirectUri,
      client_id: this.options.clientId,
      code_verifier: this.pending.verifier,
    });
    this.pending = null;
    this.options.store.set(token);
    return token;
  }

  public async accessToken(): Promise<string> {
    const current = this.options.store.get();
    if (!current) throw new Error('GPT OAuth token is not configured');
    if (current.expiresAt !== null && current.expiresAt <= this.now() + 30_000) {
      if (!current.refreshToken) throw new Error('GPT OAuth token is expired');
      const refreshed = await this.requestToken({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        client_id: this.options.clientId,
      });
      this.options.store.set(refreshed);
      return refreshed.accessToken;
    }
    return current.accessToken;
  }

  public hasToken(): boolean {
    return this.options.store.get() !== null;
  }

  private async requestToken(fields: Record<string, string>): Promise<GptOauthToken> {
    const response = await this.fetchImpl(this.options.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
    });
    if (!response.ok) throw new Error(`OAuth token request failed (${response.status})`);
    const body = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
      throw new Error('OAuth token response was missing access_token');
    }
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      expiresAt: typeof body.expires_in === 'number' ? this.now() + body.expires_in * 1000 : null,
      tokenType: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
    };
  }
}
