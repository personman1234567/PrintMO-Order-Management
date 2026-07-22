const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const fetch = require('node-fetch');
const { app, safeStorage, shell } = require('electron');

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function jwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('OIDC provider did not return a JWT ID token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

class DesktopOidcAuth {
  constructor(config) {
    this.issuer = String(config.oidcIssuer || '').replace(/\/+$/, '');
    this.clientId = String(config.oidcClientId || '');
    this.scopes = String(config.oidcScopes || 'openid profile offline_access');
    this.idToken = null;
    this.exp = 0;
    this.discovery = null;
    this.refreshPath = path.join(app.getPath('userData'), 'oidc-refresh-token.bin');
  }

  assertConfigured() {
    if (!this.issuer || !this.clientId) throw new Error('OIDC issuer/client ID are not configured for Electron');
  }

  async metadata() {
    if (this.discovery) return this.discovery;
    const response = await fetch(`${this.issuer}/.well-known/openid-configuration`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
    const metadata = await response.json();
    if (metadata.issuer !== this.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint) {
      throw new Error('OIDC discovery metadata is invalid');
    }
    this.discovery = metadata;
    return metadata;
  }

  readRefreshToken() {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(this.refreshPath)) return null;
    try { return safeStorage.decryptString(fs.readFileSync(this.refreshPath)); } catch (_) { return null; }
  }

  saveRefreshToken(token) {
    if (!token || !safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(path.dirname(this.refreshPath), { recursive: true });
    fs.writeFileSync(this.refreshPath, safeStorage.encryptString(token), { mode: 0o600 });
  }

  clearRefreshToken() {
    try { fs.rmSync(this.refreshPath, { force: true }); } catch (_) {}
  }

  acceptTokens(tokens, expectedNonce) {
    if (!tokens.id_token) throw new Error('OIDC token response did not include id_token');
    const payload = jwtPayload(tokens.id_token);
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== this.issuer || !audience.includes(this.clientId)) throw new Error('OIDC ID token issuer/audience mismatch');
    if (expectedNonce && payload.nonce !== expectedNonce) throw new Error('OIDC nonce mismatch');
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('OIDC ID token is expired');
    this.idToken = tokens.id_token;
    this.exp = payload.exp;
    if (tokens.refresh_token) this.saveRefreshToken(tokens.refresh_token);
    return this.idToken;
  }

  async tokenRequest(params) {
    const metadata = await this.metadata();
    const response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString()
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error_description || body.error || `OIDC token request failed (${response.status})`);
    return body;
  }

  async refresh() {
    const refreshToken = this.readRefreshToken();
    if (!refreshToken) return null;
    try {
      const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.clientId });
      return this.acceptTokens(tokens);
    } catch (err) {
      this.clearRefreshToken();
      throw err;
    }
  }

  async signIn() {
    this.assertConfigured();
    const metadata = await this.metadata();
    const state = base64url(crypto.randomBytes(24));
    const nonce = base64url(crypto.randomBytes(24));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());

    let resolveCallback;
    let rejectCallback;
    const callback = new Promise((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>PrintMO sign-in</title><p>Sign-in complete. You may close this window.</p>');
      if (url.searchParams.get('state') !== state) rejectCallback(new Error('OIDC state mismatch'));
      else if (url.searchParams.get('error')) rejectCallback(new Error(url.searchParams.get('error_description') || url.searchParams.get('error')));
      else resolveCallback(url.searchParams.get('code'));
    });

    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', err => err ? reject(err) : resolve()));
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.search = new URLSearchParams({ response_type: 'code', client_id: this.clientId, redirect_uri: redirectUri, scope: this.scopes, state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    const timer = setTimeout(() => rejectCallback(new Error('OIDC sign-in timed out')), 180000);
    try {
      await shell.openExternal(authUrl.toString());
      const code = await callback;
      if (!code) throw new Error('OIDC authorization code missing');
      const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: this.clientId, code_verifier: verifier });
      return this.acceptTokens(tokens, nonce);
    } finally {
      clearTimeout(timer);
      server.close();
    }
  }

  async getToken(interactive = false) {
    this.assertConfigured();
    if (this.idToken && this.exp > Math.floor(Date.now() / 1000) + 30) return this.idToken;
    try { if (await this.refresh()) return this.idToken; } catch (_) {}
    if (!interactive) throw new Error('Electron sign-in required');
    return this.signIn();
  }
}

module.exports = { DesktopOidcAuth };
