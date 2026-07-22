const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

function jwt(secret, payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function rsaJwt(privateKey, kid, payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
  return `${header}.${body}.${signature}`;
}

async function run() {
  const root = path.join(__dirname, '..');
  const workerSource = fs.readFileSync(path.join(root, 'order-manager-proxy', 'worker.js'), 'utf8');
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`)).default;
  const secret = 'phase1-test-secret';
  const now = Math.floor(Date.now() / 1000);
  const token = jwt(secret, {
    iss: 'https://printmo-test.myshopify.com/admin',
    dest: 'https://printmo-test.myshopify.com',
    aud: 'phase1-client',
    sub: 'partner-1',
    iat: now,
    nbf: now - 1,
    exp: now + 60
  });
  const env = {
    SHOPIFY_API_KEY: 'phase1-client',
    SHOPIFY_API_SECRET: secret,
    SHOPIFY_SHOP_DOMAIN: 'printmo-test.myshopify.com',
    PARTNER_USER_IDS: 'partner-1,partner-2',
    UPSTREAM_BASE: 'https://render.example.test',
    ORDER_MANAGER_ADMIN_KEY: 'render-admin-key'
  };

  const unauthorized = await worker.fetch(new Request('https://worker.test/order-manager/v1/legacy/queue'), env);
  assert.equal(unauthorized.status, 401, 'queue must reject missing bearer tokens');

  const requests = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const result = String(url).endsWith('/legacy/queue') ? [] : { success: true, count: 1, updated: [] };
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const queue = await worker.fetch(new Request('https://worker.test/order-manager/v1/legacy/queue', { headers }), env);
    assert.equal(queue.status, 200, 'valid Shopify token must reach queue adapter');
    const mutation = await worker.fetch(new Request('https://worker.test/order-manager/v1/legacy/queue/mutate', {
      method: 'POST', headers, body: JSON.stringify({ orderName: '#1 – Test', patch: { status: 'print' } })
    }), env);
    assert.equal(mutation.status, 200, 'authenticated mutation must succeed');
    assert(requests.at(-1).url.endsWith('/order-manager/v1/legacy/queue/mutate'), 'legacy mutation must use the Render data adapter');
    assert.equal(requests.at(-1).options.headers.get('X-Order-Manager-Key'), 'render-admin-key', 'Render adapter calls must carry the server-only admin key');

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: 'jwk' });
    publicJwk.kid = 'phase1-key';
    publicJwk.alg = 'RS256';
    const oidcToken = rsaJwt(privateKey, publicJwk.kid, {
      iss: 'https://identity.example.test', aud: 'desktop-client', sub: 'desktop-partner', iat: now, nbf: now - 1, exp: now + 60
    });
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({ issuer: 'https://identity.example.test', jwks_uri: 'https://identity.example.test/jwks' }), { status: 200 });
      }
      if (String(url).endsWith('/jwks')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const oidcResponse = await worker.fetch(new Request('https://worker.test/order-manager/v1/legacy/queue', {
      headers: { Authorization: `Bearer ${oidcToken}` }
    }), {
      OIDC_ISSUER: 'https://identity.example.test', OIDC_CLIENT_ID: 'desktop-client', PARTNER_SUBJECT_IDS: 'desktop-partner',
      UPSTREAM_BASE: 'https://render.example.test', ORDER_MANAGER_ADMIN_KEY: 'render-admin-key'
    });
    assert.equal(oidcResponse.status, 200, 'valid Electron OIDC token must reach queue adapter');
  } finally {
    globalThis.fetch = nativeFetch;
  }

  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const web = fs.readFileSync(path.join(root, 'order-manager-web', 'web-shim.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert(!main.includes('REDIS_URL') && !main.includes('SS_API_KEY'), 'Electron must not contain infrastructure credential paths');
  assert(!JSON.stringify(pkg.build.extraResources).includes('.env'), 'Electron package must not include .env');
  assert(pkg.build.files.includes('!.env'), 'Electron app.asar must explicitly exclude .env');
  assert(!web.includes('/order-manager/orders/status') && !web.includes('/order-manager/orders/process-batch'), 'web queue writes must use the unified adapter');
  console.log('Phase 1 contract verification passed.');
}

if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { run };
