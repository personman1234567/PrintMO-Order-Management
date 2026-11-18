import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleStudioUploads } from './studio-activity.mjs';

const root = 'https://worker.test/order-manager/storage/uploads';
const id = 'v1.aGVsbG8.cHJpdmF0ZQ';
const item = { id, filename: 'Logo.svg', uploadedAt: '2026-11-16T12:00:00.000Z', size: 14, contentType: 'image/svg+xml', metadata: { audience: 'guest', identitykey: 'guest:example' } };
const listed = { items: [item], cursor: null, hasMore: false, coverage: 'saved-and-recent-guest' };
const request = suffix => new Request(root + suffix, { headers: { Authorization: 'Bearer staff-browser-token' } });

test('Studio relay forwards only allowed query parameters with server staff credentials', async () => {
    const requests = [];
    const env = { PREPARED_ORDER_ADMIN_TOKEN: 'server-only-secret', PREPARED_ORDER_SERVICE: { fetch: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return Response.json({ ...listed, original_key: 'private-root', items: [{ ...item, customer_key: 'private-owner', original_key: 'private-key', metadata: { ...item.metadata, objectkey: 'private-key' } }] });
    } } };
    const response = await handleStudioUploads(request('?after=2026-11-01T00%3A00%3A00Z&before=2026-11-17T00%3A00%3A00Z&limit=25&cursor=' + id + '&key=private&url=https://evil.test'), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items[0].id, id);
    assert.equal(body.coverage, 'saved-and-recent-guest');
    assert.doesNotMatch(JSON.stringify(body), /private-owner|private-key|private-root|server-only-secret|objectkey|original_key|customer_key/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const { url, options } = requests[0];
    assert.equal(url.origin, 'https://designer-preview-upload.printmobusiness.workers.dev');
    assert.equal(url.pathname, '/api/admin/studio-uploads');
    assert.deepEqual([...url.searchParams.keys()], ['after', 'before', 'cursor', 'limit']);
    assert.equal(options.headers['X-PM-Admin-Token'], 'server-only-secret');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Origin, 'https://print-mo.com');
    assert.equal(options.redirect, 'manual', 'use a supported Workers mode without forwarding staff credentials through redirects');
});

test('private Studio originals preserve MIME and receive private SVG response guards', async () => {
    const env = { PREPARED_ORDER_ADMIN_TOKEN: 'secret', PREPARED_ORDER_SERVICE: { fetch: async url => {
        assert.equal(new URL(url).pathname, '/api/admin/studio-uploads/' + id);
        return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public', 'Location': 'https://public.test/key' } });
    } } };
    const response = await handleStudioUploads(request('/' + id), env);
    assert.equal(await response.text(), '<svg/>');
    assert.equal(response.headers.get('Content-Type'), 'image/svg+xml');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
    assert.equal(response.headers.get('Location'), null);
});

test('relay rejects invalid references, unsupported methods and missing service credentials', async () => {
    assert.equal((await handleStudioUploads(request('/../../private'), {})).status, 400);
    assert.equal((await handleStudioUploads(request('/v1.bad/path'), {})).status, 400);
    assert.equal((await handleStudioUploads(new Request(root, { method: 'POST' }), {})).status, 405);
    assert.equal((await handleStudioUploads(request(''), {})).status, 503);
});

test('upstream errors and malformed DTOs do not leak infrastructure details or partial success', async () => {
    for (const upstream of [new Response(null, { status: 302, headers: { Location: 'https://private-key.test' } }), new Response('private object_key=secret', { status: 500 }), Response.json({ items: [], error: 'private DB info' }), Response.json({ ...listed, items: [{ id: '../private-key' }] })]) {
        const response = await handleStudioUploads(request(''), { PREPARED_ORDER_ADMIN_TOKEN: 'secret', PREPARED_ORDER_SERVICE: { fetch: async () => upstream } });
        assert.equal(response.status, 503);
        assert.doesNotMatch(await response.text(), /object_key|private DB|secret|private-key/);
    }
    const removed = await handleStudioUploads(request('/' + id), { PREPARED_ORDER_ADMIN_TOKEN: 'secret', PREPARED_ORDER_SERVICE: { fetch: async () => new Response('private-key', { status: 404 }) } });
    assert.equal(removed.status, 404);
    assert.match(await removed.text(), /no longer available/);
});

test('Studio upload dispatch remains below the existing staff authentication boundary', () => {
    const worker = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
    const dispatch = worker.indexOf('const response = await handleStudioUploads(request, env)');
    assert.ok(dispatch > worker.indexOf('identity = await authenticateRequest(request, env)'));
    assert.ok(dispatch > worker.indexOf('// AUTHENTICATED R2 STORAGE ENDPOINTS'));
});
