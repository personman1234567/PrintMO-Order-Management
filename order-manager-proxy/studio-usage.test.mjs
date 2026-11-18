import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioUsageHandler } from './studio-usage.mjs';

const NOW = Date.parse('2026-11-16T18:00:00Z');
const env = { STUDIO_ANALYTICS_TOKEN: 'server-only-test-secret' };
const after = '2026-11-15T06:00:00.000Z', before = '2026-11-16T06:00:00.000Z';
function request(extra = {}, method = 'GET') {
  return new Request(`https://example.test/order-manager/studio-usage?${new URLSearchParams({ after, before, ...extra })}`, { method });
}
function row(eventName, events, source = 'other', reason = 'unknown') {
  return { eventName, source, reason, events, retainedRows: 1, maxInterval: events, latestReceivedAt: '2026-11-15 12:00:00' };
}
function provider(data) { return Response.json({ data, rows: data.length }); }
function setup(summary = [], buckets = []) {
  const calls = [];
  const handler = createStudioUsageHandler({ now: () => NOW, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return provider(options.body.includes('AS bucket') ? buckets : summary);
  } });
  return { handler, calls };
}

test('weighted event estimates and categorical intake stay distinct from people and payments', async () => {
  const summary = [row('designer.session_started', 10), row('designer.upload.accepted', 3, 'local-upload'),
    row('designer.upload.accepted', 2, 'ai-generated'), row('designer.upload.accepted', 4, 'library'),
    row('designer.ai.generate.success', 5), row('designer.add_to_cart.start', 7),
    row('designer.add_to_cart.success', 6), row('designer.add_to_cart.failure', 2, 'other', 'timeout')];
  const bucket = Date.parse('2026-11-15T12:00:00Z') / 1000;
  const { handler, calls } = setup(summary, [{ bucket, eventName: 'designer.session_started', events: 10 },
    { bucket, eventName: 'designer.add_to_cart.failure', events: 2 }]);
  const result = await handler(request({ timeZone: 'America/Chicago', offsetMinutes: '-360' }), env);
  assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  const body = await result.json();
  assert.deepEqual(body.totals, { opens: 10, localUploads: 3, aiGenerations: 5 });
  assert.deepEqual(body.artwork, { local: 3, ai: 2, library: 4 });
  assert.deepEqual(body.cart.reasons, [{ reason: 'timeout', count: 2 }]);
  assert.equal(body.cart.starts, 7); assert.equal(body.cart.successes, 6); assert.equal(body.bucketSeconds, 900);
  assert.equal(body.cart.failureBuckets[0].count, 2); assert.equal(body.opensBuckets[0].count, 10);
  assert.deepEqual(body.sampling, { maxInterval: 10, retainedRows: 8, estimatedEvents: 39 });
  assert.equal(body.latestReceivedAt, '2026-11-15T12:00:00.000Z'); assert.equal(body.notes.directCheckoutIncluded, false);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.body, /SUM\(_sample_interval\)/); assert.match(call.body, /blob3 = 'production' AND blob19 = 'external'/);
    assert.equal(call.headers.Authorization, `Bearer ${env.STUDIO_ANALYTICS_TOKEN}`);
    assert.match(call.url, /accounts\/74199fe95754f474f49f509e327cef0f\/analytics_engine\/sql$/);
    assert.doesNotMatch(call.body, /blob20|identityHash|customerId|sessionId/);
  }
  assert.doesNotMatch(JSON.stringify(body), /server-only-test-secret|conversionRate|paidOrders|uniqueVisitors/);
});

test('invalid dates, injection, duplicate params, retention and timezone fail before upstream access', async () => {
  const { handler, calls } = setup();
  for (const extra of [{ after: "2026-11-15T06:00:00Z' OR 1=1" }, { after: '2026-02-30T00:00:00Z' },
    { after: '2026-08-01T00:00:00Z' }, { before: after }, { before: '2027-01-01T00:00:00Z' },
    { after: '2026-10-01T06:00:00Z' }, { after: '2026-11-15T06:00:00.001Z' },
    { timeZone: 'Not/AZone' }, { offsetMinutes: 'Infinity' }, { offsetMinutes: '999' }, { sql: 'DROP TABLE' }]) {
    assert.equal((await handler(request(extra), env)).status, 400, JSON.stringify(extra));
  }
  const duplicate = new Request(request().url + '&after=' + encodeURIComponent(after));
  assert.equal((await handler(duplicate, env)).status, 400); assert.equal(calls.length, 0);
  assert.equal((await handler(request({}, 'POST'), env)).status, 405);
});

test('comparison is complete within one response, nonoverlapping and permits DST hour difference', async () => {
  const { handler, calls } = setup();
  const result = await handler(request({ compareAfter: '2026-11-14T05:00:00Z', compareBefore: after }), env);
  assert.equal(result.status, 200); const body = await result.json();
  assert.equal(body.comparison.generatedAt, body.generatedAt); assert.equal(calls.length, 4);
  assert.equal(body.comparison.latestReceivedAt, null);
  for (const extra of [{ compareAfter: after }, { compareAfter: after, compareBefore: before },
    { compareAfter: '2026-11-10T06:00:00Z', compareBefore: after }]) {
    assert.equal((await handler(request(extra), env)).status, 400);
  }
});

test('cache is bounded in time and isolated by credential and exact bounds', async () => {
  let clock = NOW, calls = 0;
  const handler = createStudioUsageHandler({ now: () => clock, fetcher: async () => { calls++; return provider([]); } });
  await handler(request(), env); await handler(request(), env); assert.equal(calls, 2);
  await handler(request(), { STUDIO_ANALYTICS_TOKEN: 'different' }); assert.equal(calls, 4);
  await handler(request({ before: '2026-11-16T05:00:00Z' }), env); assert.equal(calls, 6);
  clock += 61000; await handler(request(), env); assert.equal(calls, 8);
});

test('missing credentials and provider failures return purposeful errors without provider secrets', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request(), {})).status, 503); assert.equal(calls.length, 0);
  assert.equal((await handler(request(), { ...env, STUDIO_ANALYTICS_ACCOUNT_ID: '../bad' })).status, 503);
  const failed = createStudioUsageHandler({ now: () => NOW, fetcher: async () => new Response('private-provider-error', { status: 403 }) });
  const result = await failed(request(), env); assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /private-provider-error|server-only-test-secret/);
});

test('upstream timeout is bounded even when fetch does not reject on abort', async () => {
  let attempts = 0;
  const handler = createStudioUsageHandler({ now: () => NOW, timeoutMs: 5, fetcher: async () => { attempts++; return new Promise(() => {}); } });
  const result = await handler(request(), env); assert.equal(result.status, 503); assert.equal(attempts, 2);
});

test('malformed, nonfinite, negative, truncated, unknown or privacy-unsafe results fail closed', async () => {
  for (const change of [{ events: 'NaN' }, { events: Infinity }, { events: -1 }, { retainedRows: 99 },
    { reason: 'customer private free text' }, { source: 'private-file.png' }, { latestReceivedAt: 'invalid' },
    { latestReceivedAt: '2026-11-14 12:00:00' }, { eventName: 'purchase' }]) {
    const { handler } = setup([{ ...row('designer.add_to_cart.failure', 3), ...change }]);
    const result = await handler(request(), env); assert.equal(result.status, 503, JSON.stringify(change));
    assert.doesNotMatch(await result.text(), /customer private|private-file/);
  }
  for (const value of [{}, { data: [], rows: 1 }, { data: Array.from({ length: 193 }, () => row('designer.session_started', 1)) }]) {
    const handler = createStudioUsageHandler({ now: () => NOW, fetcher: async () => Response.json(value) });
    assert.equal((await handler(request(), env)).status, 503);
  }
});

test('preaggregation rows-before-limit metadata does not imply truncated aggregate output', async () => {
  const handler = createStudioUsageHandler({ now: () => NOW, fetcher: async (_url, options) => {
    const buckets = options.body.includes('AS bucket');
    return Response.json({ data: buckets ? [] : [row('designer.session_started', 10)], rows: buckets ? 0 : 1,
      rows_before_limit_at_least: buckets ? 0 : 267 });
  } });
  const result = await handler(request(), env);
  assert.equal(result.status, 200); assert.equal((await result.json()).totals.opens, 10);
});

test('quarter-hour buckets preserve non-hour local midnight and invalid bucket times fail closed', async () => {
  const bucket = Date.parse('2026-11-15T18:15:00Z') / 1000;
  const { handler } = setup([], [{ bucket, eventName: 'designer.session_started', events: 1 }]);
  const result = await handler(request({ timeZone: 'Asia/Kathmandu', offsetMinutes: '345' }), env);
  assert.equal(result.status, 200); assert.equal((await result.json()).opensBuckets[0].timestamp, '2026-11-15T18:15:00.000Z');
  const bad = setup([], [{ bucket: bucket + 1, eventName: 'designer.session_started', events: 1 }]);
  assert.equal((await bad.handler(request(), env)).status, 503);
});
import { createStudioUsageProjectThumbnailHandler } from './studio-usage.mjs';

const ADMIN_ENV = { ...env, PREPARED_ORDER_ADMIN_TOKEN: 'private-designer-admin-token' };
const FRONTEND = '2026-11-14T00:00:00.000Z';
const REF = 'v1.cHJvamVjdA.c2VhbGVk';
function outcomes(periodAfter = after, periodBefore = before, coverage = { savesFrom: FRONTEND, reopensFrom: FRONTEND, frontendFrom: FRONTEND }) {
  return { after: periodAfter, before: periodBefore, coverage,
    projects: { saved: 0, reopened: 0, created: 2, items: [] },
    accounts: { newAccounts: 1, existingAccounts: 2, savedAccounts: 3, pendingAccounts: 1 } };
}
function integrated(summary = [], { report = outcomes(), buckets = [], now = () => NOW, timeoutMs = 100, service } = {}) {
  const calls = [];
  const handler = createStudioUsageHandler({ now, timeoutMs, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (url.startsWith('https://api.cloudflare.com/')) return provider(options.body.includes('AS bucket') ? buckets : summary);
    if (report instanceof Response) return report.clone();
    return Response.json(typeof report === 'function' ? report(url) : report);
  } });
  return { handler, calls, environment: service ? { ...ADMIN_ENV, PREPARED_ORDER_SERVICE: service } : ADMIN_ENV };
}

test('actions, problems, placements and auth remain weighted events with independent outcome units', async () => {
  const summary = [row('designer.text.added', 4), row('designer.product_selected', 6),
    row('designer.artwork.placed', 3, 'local-upload'), row('designer.artwork.placed', 2, 'ai-generated'), row('designer.artwork.placed', 7, 'library'),
    { ...row('designer.auth.state_resolved', 5), authState: 'guest' },
    { ...row('designer.auth.state_resolved', 3), authState: 'authenticated' }, row('designer.auth.state_resolved', 2),
    row('designer.ai.generate.failure', 4), row('designer.ai.enhance.failure', 1), row('designer.ai.reuse.failure', 2),
    row('designer.ai.history.fetch.failure', 3), row('designer.ai.history.delete.failure', 1),
    row('designer.upload.rejected', 2), row('designer.svg.rejected_active_content', 4),
    row('designer.save_share.preview.failure', 3), row('designer.capture.stage.failure', 1), row('designer.mockup.failure', 2),
    row('designer.template.share_link.failure', 2), row('designer.template.create.failure', 3), row('designer.resume.autosave.failure', 4),
    row('designer.save_share.native_share.failure', 1), row('designer.save_share.download.failure', 2), row('designer.resume.restore.failure', 1),
    row('designer.template.apply.failure', 1), row('designer.template.library_fetch.failure', 1),
    row('designer.add_to_cart.failure', 5, 'other', 'pricing'), row('designer.upload.accepted', 9, 'library')];
  const { handler, calls, environment } = integrated(summary);
  const response = await handler(request(), environment), body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.actions, { textAdditions: 4, artworkPlacements: 12, garmentChanges: 6 });
  assert.deepEqual(body.placement, { local: 3, ai: 2, library: 7 });
  assert.deepEqual(body.auth, { guest: 5, authenticated: 3, unknown: 2 });
  assert.deepEqual(body.problems, [{ kind: 'ai', count: 11 }, { kind: 'uploads', count: 6 }, { kind: 'preview', count: 6 }, { kind: 'saving', count: 15 }, { kind: 'cart', count: 5 }]);
  assert.equal(body.artwork.library, 9); assert.equal(body.outcomeReport.projects.created, 2);
  assert.deepEqual(body.coverage, { frontendFrom: FRONTEND, frontend: 'complete' });
  assert.equal(body.notes.auth, 'auth-state-resolution-events'); assert.equal(body.notes.outcomes, 'ledger-record-counts');
  const sql = calls.find(call => call.body?.includes('AS authState')).body;
  assert.match(sql, /blob12 IN \('guest','authenticated'\)/);
  assert.doesNotMatch(sql, /blob20|GROUP BY[^\n]*(?:blob5|blob6|blob9|blob11|blob14|blob17)/);
  assert.doesNotMatch(JSON.stringify(body), /private-designer-admin-token|newVisitors|conversionRate|paidOrders|uniqueVisitors/);
});

test('missing frontend tracking coverage leaves new metrics unknown and legacy semantic counts intact', async () => {
  for (const frontendFrom of [null, before, '2026-11-17T00:00:00.000Z']) {
    const report = outcomes(); report.coverage.frontendFrom = frontendFrom;
    const { handler, environment } = integrated([row('designer.text.added', 4), row('designer.product_selected', 6),
      row('designer.upload.accepted', 5, 'local-upload'), row('designer.artwork.placed', 2, 'library'), { ...row('designer.auth.state_resolved', 2), authState: 'guest' }], { report });
    const body = await (await handler(request(), environment)).json();
    assert.deepEqual(body.actions, { textAdditions: 4, garmentChanges: 6, artworkPlacements: null });
    assert.deepEqual(body.placement, { local: null, ai: null, library: null });
    assert.deepEqual(body.auth, { guest: null, authenticated: null, unknown: null });
    assert.equal(body.totals.localUploads, 5); assert.equal(body.artwork.local, 5); assert.equal(body.coverage.frontend, 'unavailable');
  }
});

test('partial frontend coverage is explicit and ledger cutoffs retain null for uncovered periods', async () => {
  const report = outcomes(); report.coverage = { savesFrom: null, reopensFrom: before, frontendFrom: '2026-11-15T10:00:00.000Z' };
  report.projects.saved = null; report.projects.reopened = null;
  const { handler, environment } = integrated([row('designer.artwork.placed', 2, 'library')], { report });
  const body = await (await handler(request(), environment)).json();
  assert.equal(body.coverage.frontend, 'partial'); assert.equal(body.actions.artworkPlacements, 2);
  assert.equal(body.outcomeReport.projects.saved, null); assert.equal(body.outcomeReport.projects.reopened, null);
  assert.equal(body.outcomeReport.coverage.savesFrom, null);
});

test('private outcome relay uses service binding, exact interval and redacted allowlisted DTO', async () => {
  const calls = [], report = outcomes(); report.projects.saved = 1;
  report.projects.items = [{ ref: REF, title: 'Saved studio project', action: 'saved', occurredAt: '2026-11-15T12:00:00.000Z', hasThumbnail: true }];
  const service = { async fetch(url, options) { assert.equal(this, service); calls.push({ url, ...options }); return Response.json(report); } };
  const { handler, environment } = integrated([], { service });
  const response = await handler(request(), environment), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.outcomeReport.status, 'ready'); assert.equal(calls.length, 1);
  const call = calls[0], url = new URL(call.url);
  assert.equal(url.origin, 'https://designer-preview-upload.printmobusiness.workers.dev');
  assert.equal(url.pathname, '/api/admin/studio-usage'); assert.equal(url.searchParams.get('after'), after); assert.equal(url.searchParams.get('before'), before);
  assert.equal(call.method, 'GET'); assert.equal(call.redirect, 'manual'); assert.equal(call.headers.Origin, 'https://print-mo.com');
  assert.equal(call.headers['X-PM-Admin-Token'], ADMIN_ENV.PREPARED_ORDER_ADMIN_TOKEN); assert.ok(call.signal instanceof AbortSignal);
  assert.deepEqual(body.outcomeReport.projects.items, report.projects.items);
  assert.doesNotMatch(JSON.stringify(body), /X-PM-Admin-Token|private-designer-admin-token|objectKey|ownerKey|signedUrl/);
});

test('outcome outages do not zero or discard Analytics Engine metrics and recover after short cache', async () => {
  let clock = NOW, outcomeCalls = 0;
  const service = { async fetch() { outcomeCalls++; return new Response('private R2 key and provider details', { status: 500 }); } };
  const { handler, environment } = integrated([row('designer.session_started', 7)], { service, now: () => clock });
  let body = await (await handler(request(), environment)).json();
  assert.equal(body.totals.opens, 7); assert.equal(body.outcomeReport.status, 'unavailable');
  assert.equal(body.outcomeReport.projects, undefined); assert.equal(body.auth.guest, null); assert.equal(body.actions.artworkPlacements, null);
  assert.doesNotMatch(JSON.stringify(body), /private R2|provider details/);
  await handler(request(), environment); assert.equal(outcomeCalls, 1);
  clock += 5001; await handler(request(), environment); assert.equal(outcomeCalls, 2);
});

test('comparison outcomes retain independent before-cutoff nulls alongside complete current coverage', async () => {
  const cutoff = after;
  const report = url => {
    const params = new URL(url).searchParams, a = params.get('after'), b = params.get('before');
    const value = outcomes(a, b, { savesFrom: cutoff, reopensFrom: cutoff, frontendFrom: cutoff });
    value.projects.saved = a === after ? 2 : null; value.projects.reopened = a === after ? 1 : null;
    return value;
  };
  const { handler, calls, environment } = integrated([], { report });
  const response = await handler(request({ compareAfter: '2026-11-14T06:00:00.000Z', compareBefore: after }), environment), body = await response.json();
  assert.equal(response.status, 200); assert.equal(calls.length, 6);
  assert.equal(body.outcomeReport.projects.saved, 2); assert.equal(body.comparison.outcomeReport.projects.saved, null);
  assert.equal(body.auth.guest, 0); assert.equal(body.comparison.auth.guest, null);
  assert.equal(body.coverage.frontend, 'complete'); assert.equal(body.comparison.coverage.frontend, 'unavailable');
});

test('malformed or expanded private outcome DTOs fail closed without disrupting usage estimates', async () => {
  const mutations = [
    report => { report.objectKey = 'private'; }, report => { report.coverage.ownerKey = 'private'; },
    report => { delete report.coverage.frontendFrom; }, report => { report.projects.customerEmail = 'private'; },
    report => { report.accounts.token = 'private'; }, report => { report.accounts.newAccounts = -1; },
    report => { report.accounts.savedAccounts = null; }, report => { report.projects.created = '2'; },
    report => { report.after = before; }, report => { report.coverage.savesFrom = null; },
    report => { report.projects.saved = null; }, report => { report.coverage.frontendFrom = '2026-02-30T00:00:00Z'; },
    report => { report.projects.items = [{ ref: 'private/key', title: 'Project', action: 'saved', occurredAt: '2026-11-15T12:00:00Z', hasThumbnail: true }]; },
    report => { report.projects.items = Array.from({ length: 21 }, () => ({})); },
    report => { report.projects.items = [{ ref: REF, title: 'Project', action: 'saved', occurredAt: '2026-11-15T12:00:00Z', hasThumbnail: true, objectKey: 'private' }]; },
    report => { report.projects.items = [{ ref: REF, title: 'Project', action: 'saved', occurredAt: '2026-11-16T12:00:00Z', hasThumbnail: true }]; },
    report => { report.projects.items = [{ ref: REF, title: 'Project', action: 'deleted', occurredAt: '2026-11-15T12:00:00Z', hasThumbnail: true }]; },
  ];
  for (const mutate of mutations) {
    const report = outcomes(); mutate(report);
    const { handler, environment } = integrated([row('designer.session_started', 4)], { report });
    const response = await handler(request(), environment), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.totals.opens, 4); assert.equal(body.outcomeReport.status, 'unavailable', mutate.toString());
    assert.doesNotMatch(JSON.stringify(body), /objectKey|ownerKey|customerEmail|private-designer-admin-token/);
  }
});

test('local upload and AI quarter-hour series are bounded independently', async () => {
  const bucket = Date.parse('2026-11-15T12:00:00Z') / 1000;
  const { handler, environment, calls } = integrated([], { buckets: [{ bucket, eventName: 'designer.upload.accepted', events: 3 }, { bucket, eventName: 'designer.ai.generate.success', events: 5 }] });
  const body = await (await handler(request(), environment)).json();
  assert.deepEqual(body.uploadBuckets, [{ timestamp: '2026-11-15T12:00:00.000Z', count: 3 }]);
  assert.deepEqual(body.aiBuckets, [{ timestamp: '2026-11-15T12:00:00.000Z', count: 5 }]);
  assert.match(calls.find(call => call.body?.includes('AS bucket')).body, /blob1 != 'designer.upload.accepted' OR blob12 = 'local-upload'/);
});

function thumbnailRequest(ref = REF, suffix = '', method = 'GET') { return new Request('https://om.test/order-manager/studio-usage/projects/' + ref + '/thumbnail' + suffix, { method }); }

test('project thumbnail relay returns private bytes and CSP without storage URLs or keys', async () => {
  const calls = [], bytes = new Uint8Array([137, 80, 78, 71]);
  const handler = createStudioUsageProjectThumbnailHandler({ fetcher: async (url, options) => {
    calls.push({ url, ...options }); return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'X-Object-Key': 'private', Location: 'https://private.test/object' } });
  } });
  const result = await handler(thumbnailRequest(), ADMIN_ENV);
  assert.equal(result.status, 200); assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store'); assert.equal(result.headers.get('Content-Disposition'), 'inline');
  assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(result.headers.get('Content-Security-Policy'), /default-src 'none'.*sandbox/);
  assert.equal(result.headers.get('X-Object-Key'), null); assert.equal(result.headers.get('Location'), null);
  assert.equal(calls[0].url, 'https://designer-preview-upload.printmobusiness.workers.dev/api/admin/studio-usage/projects/' + REF + '/thumbnail');
  assert.equal(calls[0].redirect, 'manual'); assert.equal(calls[0].headers['X-PM-Admin-Token'], ADMIN_ENV.PREPARED_ORDER_ADMIN_TOKEN);
});

test('thumbnail reference validation and credentials fail before network access', async () => {
  let calls = 0; const handler = createStudioUsageProjectThumbnailHandler({ fetcher: async () => { calls++; throw new Error('should not fetch'); } });
  for (const ref of ['invalid', 'v1.private/key.seal', 'v1.%2Fkey.seal', 'v1..seal', 'v1.' + 'a'.repeat(4096) + '.seal']) assert.equal((await handler(thumbnailRequest(ref), ADMIN_ENV)).status, 400);
  assert.equal((await handler(thumbnailRequest(REF, '?redirect=https://private.test'), ADMIN_ENV)).status, 400);
  assert.equal((await handler(thumbnailRequest(REF, '', 'POST'), ADMIN_ENV)).status, 405);
  assert.equal((await handler(thumbnailRequest(), {})).status, 503); assert.equal(calls, 0);
});

test('thumbnail redirects, non-images and oversized bodies never pass through provider details', async () => {
  for (const upstream of [new Response('private-provider-detail', { status: 302, headers: { Location: 'https://private.test/object' } }),
    new Response('private-provider-detail', { headers: { 'Content-Type': 'application/json' } }),
    new Response('private-provider-detail', { headers: { 'Content-Type': 'image/png', 'Content-Length': '99999999' } }),
    new Response('private-provider-detail', { status: 404 })]) {
    const handler = createStudioUsageProjectThumbnailHandler({ fetcher: async () => upstream });
    const response = await handler(thumbnailRequest(), ADMIN_ENV);
    assert.ok([503, 404].includes(response.status)); assert.doesNotMatch(await response.text(), /private-provider-detail|https:\/\//);
  }
});

test('outcomes and thumbnails enforce timeout when transport ignores abort', async () => {
  let signal;
  const service = { fetch: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } };
  const { handler, environment } = integrated([row('designer.session_started', 4)], { service, timeoutMs: 5 });
  const response = await handler(request(), environment), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.totals.opens, 4); assert.equal(body.outcomeReport.status, 'unavailable'); assert.equal(signal.aborted, true);
  const thumbnail = createStudioUsageProjectThumbnailHandler({ timeoutMs: 5, fetcher: service.fetch });
  assert.equal((await thumbnail(thumbnailRequest(), ADMIN_ENV)).status, 503); assert.equal(signal.aborted, true);
});

test('outcome and thumbnail service binding transport overrides injected network fetcher', async () => {
  let networkCalls = 0, serviceCalls = 0;
  const service = { async fetch() { serviceCalls++; assert.equal(this, service); return new Response('image', { headers: { 'Content-Type': 'image/svg+xml' } }); } };
  const handler = createStudioUsageProjectThumbnailHandler({ fetcher: async () => { networkCalls++; throw new Error('No network'); } });
  const result = await handler(thumbnailRequest(), { ...ADMIN_ENV, PREPARED_ORDER_SERVICE: service });
  assert.equal(result.status, 200); assert.match(result.headers.get('Content-Security-Policy'), /sandbox/);
  assert.equal(networkCalls, 0); assert.equal(serviceCalls, 1);
});

test('ready outcomes cache for 60s and cache identity includes private report credential', async () => {
  let clock = NOW;
  const { handler, environment, calls } = integrated([], { now: () => clock });
  await handler(request(), environment); await handler(request(), environment); assert.equal(calls.length, 3);
  clock += 59999; await handler(request(), environment); assert.equal(calls.length, 3);
  clock += 2; await handler(request(), environment); assert.equal(calls.length, 6);
  await handler(request(), { ...environment, PREPARED_ORDER_ADMIN_TOKEN: 'different-private-token' }); assert.equal(calls.length, 9);
});

test('expanded bounded categorical output may exceed legacy group limit without treating preaggregation as truncation', async () => {
  const events = ['designer.session_started', 'designer.upload.accepted', 'designer.ai.generate.success', 'designer.add_to_cart.start',
    'designer.add_to_cart.success', 'designer.text.added', 'designer.product_selected', 'designer.ai.generate.failure'];
  const sources = ['local-upload', 'ai-generated', 'library', 'other'];
  const reasons = ['timeout', 'network', 'export', 'preview', 'validation', 'inventory', 'pricing', 'unknown'];
  const summary = events.flatMap(event => sources.flatMap(source => reasons.map(reason => row(event, 1, source, reason))));
  assert.equal(summary.length, 256);
  const handler = createStudioUsageHandler({ now: () => NOW, fetcher: async (_url, options) => {
    const data = options.body.includes('AS bucket') ? [] : summary;
    return Response.json({ data, rows: data.length, rows_before_limit_at_least: 999999 });
  } });
  const result = await handler(request(), env), body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.sampling.estimatedEvents, 256); assert.equal(body.actions.textAdditions, 32);
  assert.equal(body.actions.artworkPlacements, null); assert.equal(body.outcomeReport.status, 'unavailable');
});

test('initial sign-in state and later state changes remain separate weighted event estimates', async () => {
  const summary = [
    { ...row('designer.auth.state_resolved', 5), authState: 'guest', authOperation: 'initial' },
    { ...row('designer.auth.state_resolved', 3), authState: 'authenticated', authOperation: 'initial' },
    { ...row('designer.auth.state_resolved', 2), authState: 'unknown', authOperation: 'initial' },
    { ...row('designer.auth.state_resolved', 7), authState: 'authenticated', authOperation: 'change' },
    { ...row('designer.auth.state_resolved', 4), authState: 'guest', authOperation: 'change' },
    { ...row('designer.auth.state_resolved', 1), authState: 'unknown', authOperation: 'change' },
    { ...row('designer.auth.state_resolved', 9), authState: 'guest' },
  ];
  const { handler, environment, calls } = integrated(summary);
  const response = await handler(request(), environment), body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.authInitial, { guest: 5, authenticated: 3, unknown: 2 });
  assert.deepEqual(body.authChanges, { guest: 4, authenticated: 7, unknown: 1 });
  assert.deepEqual(body.auth, { guest: 18, authenticated: 10, unknown: 3 });
  assert.equal(body.notes.authInitial, 'initial-auth-state-resolution-events-including-reloads');
  assert.equal(body.notes.authChanges, 'changed-auth-state-resolution-events');
  const sql = calls.find(call => call.body?.includes('AS authOperation')).body;
  assert.match(sql, /blob14 IN \('initial','change'\)/);
  assert.match(sql, /GROUP BY eventName,source,reason,authState,authOperation/);
  assert.doesNotMatch(JSON.stringify(body), /signups|uniquePeople|newVisitors|conversionRate/);
});

test('initial and changed sign-in estimates remain unknown before frontend coverage', async () => {
  for (const frontendFrom of [null, before]) {
    const report = outcomes(); report.coverage.frontendFrom = frontendFrom;
    const { handler, environment } = integrated([
      { ...row('designer.auth.state_resolved', 5), authState: 'guest', authOperation: 'initial' },
      { ...row('designer.auth.state_resolved', 3), authState: 'authenticated', authOperation: 'change' },
    ], { report });
    const body = await (await handler(request(), environment)).json();
    assert.deepEqual(body.authInitial, { guest: null, authenticated: null, unknown: null });
    assert.deepEqual(body.authChanges, { guest: null, authenticated: null, unknown: null });
    assert.deepEqual(body.auth, { guest: null, authenticated: null, unknown: null });
  }
});

test('bounded auth operations reject provider free text and non-auth operation groups', async () => {
  for (const summary of [
    [{ ...row('designer.auth.state_resolved', 1), authOperation: 'private provider text' }],
    [{ ...row('designer.session_started', 1), authOperation: 'initial' }],
  ]) {
    const { handler, environment } = integrated(summary);
    const response = await handler(request(), environment);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private provider text/);
  }
});

test('validated frontend cutoff excludes only pre-activation artwork and auth events before weighted aggregation', async () => {
  const cutoff = '2026-11-15T12:00:00.123Z', calls = [];
  const report = outcomes(); report.coverage.frontendFrom = cutoff;
  const raw = [
    { ...row('designer.text.added', 4), latestReceivedAt: '2026-11-15T10:00:00.000Z' },
    { ...row('designer.text.added', 3), latestReceivedAt: '2026-11-15T13:00:00.000Z' },
    { ...row('designer.artwork.placed', 11, 'library'), latestReceivedAt: '2026-11-15T10:00:00.000Z' },
    { ...row('designer.artwork.placed', 17, 'library'), latestReceivedAt: '2026-11-15T12:00:00.000Z' },
    { ...row('designer.artwork.placed', 5, 'library'), latestReceivedAt: '2026-11-15T12:00:01.000Z' },
    { ...row('designer.auth.state_resolved', 7), authState: 'guest', authOperation: 'initial', latestReceivedAt: '2026-11-15T10:00:00.000Z' },
    { ...row('designer.auth.state_resolved', 2), authState: 'guest', authOperation: 'initial', latestReceivedAt: '2026-11-15T12:00:00.000Z' },
    { ...row('designer.auth.state_resolved', 3), authState: 'guest', authOperation: 'initial', latestReceivedAt: '2026-11-15T12:00:01.000Z' },
    { ...row('designer.auth.state_resolved', 4), authState: 'authenticated', authOperation: 'change', latestReceivedAt: '2026-11-15T13:00:00.000Z' },
  ];
  const handler = createStudioUsageHandler({ now: () => NOW, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (url.includes('/api/admin/studio-usage')) return Response.json(report);
    if (options.body.includes('AS bucket')) { assert.doesNotMatch(options.body, /auth\.state_resolved|artwork\.placed/); return provider([]); }
    const sql = options.body;
    assert.match(sql, /AND \(blob1 NOT IN \('designer.artwork.placed','designer.auth.state_resolved'\) OR toUInt32\(timestamp\) >= 1794744001\) AND blob1 IN/);
    const boundary = Number(sql.match(/OR toUInt32\(timestamp\) >= (\d+)/)?.[1]);
    const selected = raw.filter(value => !['designer.artwork.placed', 'designer.auth.state_resolved'].includes(value.eventName) || Date.parse(value.latestReceivedAt) / 1000 >= boundary);
    const grouped = new Map();
    for (const value of selected) {
      const key = [value.eventName, value.source, value.reason, value.authState, value.authOperation].join('/');
      const prior = grouped.get(key);
      grouped.set(key, prior ? { ...prior, events: prior.events + value.events, retainedRows: prior.retainedRows + 1, maxInterval: Math.max(prior.maxInterval, value.maxInterval), latestReceivedAt: value.latestReceivedAt > prior.latestReceivedAt ? value.latestReceivedAt : prior.latestReceivedAt } : value);
    }
    return provider([...grouped.values()]);
  } });
  const response = await handler(request(), ADMIN_ENV), body = await response.json();
  assert.equal(response.status, 200); assert.equal(calls.length, 3); assert.match(calls[0].url, /api\/admin\/studio-usage/);
  assert.deepEqual(body.actions, { textAdditions: 7, garmentChanges: 0, artworkPlacements: 5 });
  assert.deepEqual(body.placement, { local: 0, ai: 0, library: 5 });
  assert.deepEqual(body.authInitial, { guest: 3, authenticated: 0, unknown: 0 });
  assert.deepEqual(body.authChanges, { guest: 0, authenticated: 4, unknown: 0 });
  assert.deepEqual(body.auth, { guest: 3, authenticated: 4, unknown: 0 });
  assert.equal(body.coverage.frontend, 'partial'); assert.equal(body.notes.frontendCutoff, 'whole-second-timestamps-rounded-up');
  await handler(request(), ADMIN_ENV); assert.equal(calls.length, 3);
});

test('unavailable or out-of-period frontend coverage excludes new SQL events and preserves full-period legacy queries', async () => {
  for (const frontendFrom of [null, before, '2026-11-17T00:00:00.000Z']) {
    const report = outcomes(); report.coverage.frontendFrom = frontendFrom;
    const { handler, environment, calls } = integrated([row('designer.text.added', 8), row('designer.product_selected', 6)], { report });
    const body = await (await handler(request(), environment)).json();
    const sql = calls.find(call => call.body?.includes('AS authState')).body;
    assert.match(sql, /AND \(blob1 NOT IN \('designer.artwork.placed','designer.auth.state_resolved'\)\) AND blob1 IN/);
    assert.doesNotMatch(sql, /OR toUInt32\(timestamp\) >=/);
    assert.equal(body.actions.textAdditions, 8); assert.equal(body.actions.garmentChanges, 6); assert.equal(body.actions.artworkPlacements, null);
    assert.deepEqual(body.authInitial, { guest: null, authenticated: null, unknown: null }); assert.equal(calls.length, 3);
  }
  const { handler, environment, calls } = integrated([row('designer.session_started', 9)], { report: new Response('unavailable', { status: 503 }) });
  const body = await (await handler(request(), environment)).json();
  assert.equal(body.totals.opens, 9); assert.equal(body.outcomeReport.status, 'unavailable');
  assert.doesNotMatch(calls.find(call => call.body?.includes('AS authState')).body, /OR toUInt32\(timestamp\) >=/);
});

test('comparison applies independent cutoff guards without additional SQL requests', async () => {
  const cutoff = '2026-11-15T06:00:00.500Z';
  const report = url => {
    const params = new URL(url).searchParams, a = params.get('after'), b = params.get('before');
    return outcomes(a, b, { savesFrom: FRONTEND, reopensFrom: FRONTEND, frontendFrom: cutoff });
  };
  const { handler, environment, calls } = integrated([], { report });
  const body = await (await handler(request({ compareAfter: '2026-11-14T06:00:00.000Z', compareBefore: after }), environment)).json();
  assert.equal(calls.length, 6);
  const sql = calls.filter(call => call.body?.includes('AS authState')).map(call => call.body);
  assert.equal(sql.filter(query => /OR toUInt32\(timestamp\) >= 1794722401/.test(query)).length, 1);
  assert.equal(sql.filter(query => !/OR toUInt32\(timestamp\) >=/.test(query)).length, 1);
  assert.equal(body.coverage.frontend, 'partial'); assert.equal(body.comparison.coverage.frontend, 'unavailable');
  assert.equal(body.actions.artworkPlacements, 0); assert.equal(body.comparison.actions.artworkPlacements, null);
});
