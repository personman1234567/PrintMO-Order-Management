// Private Designer ledger reports. All callers must be below staff authentication.
const UPSTREAM = 'https://designer-preview-upload.printmobusiness.workers.dev';
const ROOT = '/order-manager/studio-usage/projects/';
const REF = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UNAVAILABLE = 'Saved project and account activity could not load. Try again shortly.';
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid outcome report');
}
function count(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid outcome count'); return value; }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('Invalid outcome date');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) throw new Error('Invalid outcome date');
  return new Date(time).toISOString();
}
function coverageCount(value, from, period) {
  if (!from || Date.parse(from) >= period.end) { if (value !== null) throw new Error('Missing outcome coverage'); return null; }
  return count(value);
}
function reference(value) { return typeof value === 'string' && value.length <= 4096 && REF.test(value); }
export function validateOutcomeReport(value, period) {
  exact(value, ['after', 'before', 'coverage', 'projects', 'accounts']);
  if (date(value.after) !== period.after || date(value.before) !== period.before) throw new Error('Outcome bounds differ');
  exact(value.coverage, ['savesFrom', 'reopensFrom', 'frontendFrom']);
  const coverage = Object.fromEntries(Object.entries(value.coverage).map(([key, value]) => [key, value === null ? null : date(value)]));
  exact(value.projects, ['saved', 'reopened', 'created', 'items']);
  const saved = coverageCount(value.projects.saved, coverage.savesFrom, period), reopened = coverageCount(value.projects.reopened, coverage.reopensFrom, period);
  if (!Array.isArray(value.projects.items) || value.projects.items.length > 20) throw new Error('Too many outcomes');
  const seen = new Set();
  const items = value.projects.items.map(item => {
    exact(item, ['ref', 'title', 'action', 'occurredAt', 'hasThumbnail']);
    if (!reference(item.ref) || typeof item.title !== 'string' || item.title.length > 200 || /[\u0000-\u001f\u007f]/.test(item.title)
      || !['saved', 'reopened'].includes(item.action) || typeof item.hasThumbnail !== 'boolean') throw new Error('Invalid outcome item');
    const occurredAt = date(item.occurredAt), time = Date.parse(occurredAt);
    const from = coverage[item.action === 'saved' ? 'savesFrom' : 'reopensFrom'];
    if (time < period.start || time >= period.end || !from || time < Date.parse(from)) throw new Error('Outcome outside coverage');
    const key = item.ref + '/' + item.action + '/' + occurredAt;
    if (seen.has(key)) throw new Error('Duplicate outcome item');
    seen.add(key);
    return { ref: item.ref, title: item.title, action: item.action, occurredAt, hasThumbnail: item.hasThumbnail };
  });
  exact(value.accounts, ['newAccounts', 'existingAccounts', 'savedAccounts', 'pendingAccounts']);
  const accounts = Object.fromEntries(Object.entries(value.accounts).map(([key, value]) => [key, count(value)]));
  return { status: 'ready', after: period.after, before: period.before, coverage,
    projects: { saved, reopened, created: count(value.projects.created), items }, accounts };
}
async function limitedBody(response, maximum) {
  const declared = response.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new Error('Outcome too large');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('Outcome too large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function designerRequest(env, path, fetcher, timeoutMs, accept, consume) {
  if (typeof env.PREPARED_ORDER_ADMIN_TOKEN !== 'string' || !env.PREPARED_ORDER_ADMIN_TOKEN.trim()) throw new Error('Outcomes not configured');
  const transport = env.PREPARED_ORDER_SERVICE ? env.PREPARED_ORDER_SERVICE.fetch.bind(env.PREPARED_ORDER_SERVICE) : fetcher;
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([(async () => {
      const upstream = await transport(UPSTREAM + path, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Origin: 'https://print-mo.com', 'X-PM-Admin-Token': env.PREPARED_ORDER_ADMIN_TOKEN, Accept: accept } });
      if (!upstream.ok) throw Object.assign(new Error('Outcome unavailable'), { upstreamStatus: upstream.status });
      return consume(upstream);
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Outcome timeout')); }, timeoutMs); })]);
  } finally { clearTimeout(timer); }
}
export async function loadOutcomeReport(env, period, fetcher, timeoutMs) {
  try {
    const query = new URLSearchParams({ after: period.after, before: period.before });
    return await designerRequest(env, '/api/admin/studio-usage?' + query, fetcher, timeoutMs, 'application/json', async upstream => {
      if (upstream.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new Error('Invalid outcome type');
      const bytes = await limitedBody(upstream, 131072);
      return validateOutcomeReport(JSON.parse(new TextDecoder().decode(bytes)), period);
    });
  } catch { return { status: 'unavailable', error: UNAVAILABLE }; }
}
function json(error, status) { return Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function createStudioUsageProjectThumbnailHandler({ fetcher = globalThis.fetch, timeoutMs = 10000 } = {}) {
  return async function studioUsageProjectThumbnail(request, env) {
    if (request.method !== 'GET') return json('Use GET to load a saved project thumbnail.', 405);
    const url = new URL(request.url), match = url.pathname.startsWith(ROOT) && url.pathname.endsWith('/thumbnail') ? url.pathname.slice(ROOT.length, -'/thumbnail'.length) : '';
    if (!reference(match) || url.search) return json('Choose an available saved project thumbnail.', 400);
    try {
      return await designerRequest(env, '/api/admin/studio-usage/projects/' + match + '/thumbnail', fetcher, timeoutMs, 'image/*', async upstream => {
        const type = upstream.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'].includes(type)) throw new Error('Invalid thumbnail type');
        const bytes = await limitedBody(upstream, 8 * 1024 * 1024);
        return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store',
          'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
      });
    } catch (error) {
      const status = [404, 410, 429].includes(error.upstreamStatus) ? error.upstreamStatus : 503;
      return json(status === 404 || status === 410 ? 'This project thumbnail is no longer available.' : 'Project thumbnail could not load. Try again shortly.', status);
    }
  };
}
export const handleStudioUsageProjectThumbnail = createStudioUsageProjectThumbnailHandler();
