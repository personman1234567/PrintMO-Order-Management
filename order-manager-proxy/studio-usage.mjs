import { loadOutcomeReport } from './studio-usage-outcomes.mjs';
export { createStudioUsageProjectThumbnailHandler, handleStudioUsageProjectThumbnail } from './studio-usage-outcomes.mjs';
// Read-only Analytics Engine reports. Call only after the Worker's staff authentication.
const DATASET = 'pm_designer_telemetry';
const DEFAULT_ACCOUNT = '74199fe95754f474f49f509e327cef0f';
const DAY = 86400000;
const MAX_RANGE = 31 * DAY + 3600000; // A local calendar range may cross DST.
const PROBLEM_EVENTS = {
  'designer.ai.generate.failure': 'ai', 'designer.ai.enhance.failure': 'ai', 'designer.ai.reuse.failure': 'ai',
  'designer.ai.history.fetch.failure': 'ai', 'designer.ai.history.delete.failure': 'ai',
  'designer.upload.rejected': 'uploads', 'designer.svg.rejected_active_content': 'uploads',
  'designer.save_share.preview.failure': 'preview', 'designer.capture.stage.failure': 'preview', 'designer.mockup.failure': 'preview',
  'designer.template.share_link.failure': 'saving', 'designer.template.create.failure': 'saving',
  'designer.resume.autosave.failure': 'saving', 'designer.resume.restore.failure': 'saving',
  'designer.template.apply.failure': 'saving', 'designer.template.library_fetch.failure': 'saving', 'designer.save_share.native_share.failure': 'saving', 'designer.save_share.download.failure': 'saving',
  'designer.add_to_cart.failure': 'cart',
};
const EVENTS = ['designer.session_started', 'designer.upload.accepted', 'designer.ai.generate.success',
  'designer.add_to_cart.start', 'designer.add_to_cart.success', 'designer.text.added', 'designer.product_selected',
  'designer.artwork.placed', 'designer.auth.state_resolved', ...Object.keys(PROBLEM_EVENTS)];
const FRONTEND_EVENTS = ['designer.artwork.placed', 'designer.auth.state_resolved'];
const BUCKET_EVENTS = ['designer.session_started', 'designer.add_to_cart.failure', 'designer.upload.accepted', 'designer.ai.generate.success'];
const MAX_SUMMARY_ROWS = EVENTS.length * 4 * 8 * 3 * 3;
const MAX_BUCKET_ROWS = 12000;
const REASONS = new Set(['timeout', 'network', 'export', 'preview', 'validation', 'inventory', 'pricing', 'unknown']);

function response(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
function iso(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) invalid(`${name} must be a UTC ISO timestamp.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) invalid(`${name} must be a valid UTC ISO timestamp.`);
  return time;
}
function bounds(params, afterName, beforeName, now) {
  const after = iso(params.get(afterName), afterName), before = iso(params.get(beforeName), beforeName);
  if (before <= after || before - after > MAX_RANGE) invalid('Choose a date range of at most 31 days.');
  if (after < now - 90 * DAY || after > now || before > now + DAY) invalid('Choose dates within the last 90 days.');
  return { after: new Date(after).toISOString(), before: new Date(before).toISOString(), start: after, end: before };
}
function requestOptions(request, now) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(['after', 'before', 'compareAfter', 'compareBefore', 'offsetMinutes', 'timeZone']);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) invalid('Unsupported or repeated report parameter.');
  const period = bounds(params, 'after', 'before', now);
  if (params.has('offsetMinutes')) {
    const offset = params.get('offsetMinutes');
    if (!/^-?\d{1,3}$/.test(offset || '') || Number(offset) < -840 || Number(offset) > 840) invalid('Invalid local time offset.');
  }
  if (params.has('timeZone')) {
    const zone = params.get('timeZone');
    if (!zone || zone.length > 80) invalid('Invalid time zone.');
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); } catch { invalid('Invalid time zone.'); }
  }
  let comparison = null;
  if (params.has('compareAfter') || params.has('compareBefore')) {
    comparison = bounds(params, 'compareAfter', 'compareBefore', now);
    if (Math.abs((period.end - period.start) - (comparison.end - comparison.start)) > 3600000) invalid('Comparison periods must have the same calendar length.');
    if (period.start < comparison.end && comparison.start < period.end) invalid('Comparison periods must not overlap.');
  }
  return { period, comparison };
}
function sqlTime(value) { return `toDateTime('${value.slice(0, 19).replace('T', ' ')}')`; }
function filter(period) {
  // Legacy SQL timestamps have second precision. Browser date boundaries are exact seconds.
  if (period.start % 1000 || period.end % 1000) invalid('Report boundaries must use whole seconds.');
  return `timestamp >= ${sqlTime(period.after)} AND timestamp < ${sqlTime(period.before)} AND blob3 = 'production' AND blob19 = 'external'`;
}
function queries(period, frontendFrom = null) {
  const where = filter(period), events = EVENTS.map(value => `'${value}'`).join(',');
  // AE timestamps have whole-second precision. Round coverage up so events in
  // the ambiguous activation second cannot be counted as production activity.
  const cutoff = frontendFrom ? Math.ceil(Date.parse(frontendFrom) / 1000) : null;
  const frontendEvents = FRONTEND_EVENTS.map(value => `'${value}'`).join(',');
  const frontendGuard = `blob1 NOT IN (${frontendEvents})${cutoff !== null && cutoff * 1000 < period.end ? ` OR toUInt32(timestamp) >= ${cutoff}` : ''}`;
  // Only categorical reasons leave the provider; free-text reasons, payloads and IDs do not.
  const reason = [['timeout', 'timeout'], ['network', 'network'], ['export', 'export'], ['preview', 'preview'],
    ['inventory', 'inventory'], ['price', 'pricing'], ['validation', 'validation']].reduceRight(
    (fallback, [match, category]) => `if(lower(blob10) LIKE '%${match}%' OR lower(blob18) LIKE '%${match}%', '${category}', ${fallback})`, "'unknown'");
  return [
    `SELECT blob1 AS eventName, if(blob12 IN ('local-upload','ai-generated','library'), blob12, 'other') AS source,
      ${reason} AS reason, if(blob1 = 'designer.auth.state_resolved' AND blob12 IN ('guest','authenticated'), blob12, 'unknown') AS authState, if(blob1 = 'designer.auth.state_resolved' AND blob14 IN ('initial','change'), blob14, 'other') AS authOperation, SUM(_sample_interval) AS events, COUNT() AS retainedRows,
      MAX(_sample_interval) AS maxInterval, MAX(timestamp) AS latestReceivedAt
      FROM ${DATASET} WHERE ${where} AND (${frontendGuard}) AND blob1 IN (${events}) GROUP BY eventName,source,reason,authState,authOperation LIMIT ${MAX_SUMMARY_ROWS} FORMAT JSON`,
    `SELECT intDiv(toUInt32(timestamp),900)*900 AS bucket, blob1 AS eventName, SUM(_sample_interval) AS events
      FROM ${DATASET} WHERE ${where} AND blob1 IN (${BUCKET_EVENTS.map(value => `'${value}'`).join(',')}) AND (blob1 != 'designer.upload.accepted' OR blob12 = 'local-upload')
      GROUP BY bucket,eventName ORDER BY bucket ASC LIMIT ${MAX_BUCKET_ROWS} FORMAT JSON`,
  ];
}
function number(value, minimum = 0) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) throw new Error('Invalid report number');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error('Invalid report number');
  return result;
}
function add(first, second) { return number(first + second); }
function receivedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(value)) throw new Error('Invalid report date');
  const normalized = value.replace(' ', 'T').replace(/Z?$/, 'Z');
  const result = Date.parse(normalized);
  if (!Number.isFinite(result)) throw new Error('Invalid report date');
  return new Date(result).toISOString();
}
function assemble(period, summary, hourly, generatedAt, outcomeReport) {
  const frontendFrom = outcomeReport.status === 'ready' ? outcomeReport.coverage.frontendFrom : null;
  const frontendCovered = Boolean(frontendFrom && Date.parse(frontendFrom) < period.end);
  const result = { outcomeReport,
    coverage: { frontendFrom, frontend: !frontendCovered ? 'unavailable' : Date.parse(frontendFrom) > period.start ? 'partial' : 'complete' },
    actions: { textAdditions: 0, artworkPlacements: frontendCovered ? 0 : null, garmentChanges: 0 },
    placement: { local: frontendCovered ? 0 : null, ai: frontendCovered ? 0 : null, library: frontendCovered ? 0 : null },
    auth: { guest: frontendCovered ? 0 : null, authenticated: frontendCovered ? 0 : null, unknown: frontendCovered ? 0 : null },
    authInitial: { guest: frontendCovered ? 0 : null, authenticated: frontendCovered ? 0 : null, unknown: frontendCovered ? 0 : null },
    authChanges: { guest: frontendCovered ? 0 : null, authenticated: frontendCovered ? 0 : null, unknown: frontendCovered ? 0 : null },
    problems: Object.values(PROBLEM_EVENTS).filter((value, index, values) => values.indexOf(value) === index).map(kind => ({ kind, count: 0 })),
    uploadBuckets: [], aiBuckets: [], after: period.after, before: period.before, generatedAt, latestReceivedAt: null,
    totals: { opens: 0, localUploads: 0, aiGenerations: 0 }, artwork: { local: 0, ai: 0, library: 0 },
    cart: { starts: 0, successes: 0, failures: 0, reasons: [], failureBuckets: [] }, opensBuckets: [], bucketSeconds: 900,
    sampling: { maxInterval: null, retainedRows: 0, estimatedEvents: 0 },
    notes: { directCheckoutIncluded: false, traffic: 'production/external', bucketTimeZone: 'UTC', counts: 'recorded-event-estimates', artwork: 'accepted-upload-or-reuse-events', placement: 'committed-artwork-placement-events', auth: 'auth-state-resolution-events', authInitial: 'initial-auth-state-resolution-events-including-reloads', authChanges: 'changed-auth-state-resolution-events', outcomes: 'ledger-record-counts', frontendCutoff: 'whole-second-timestamps-rounded-up' } };
  const reasons = new Map(), seen = new Set();
  for (const row of summary) {
    if (!EVENTS.includes(row.eventName) || !['local-upload', 'ai-generated', 'library', 'other'].includes(row.source) || !REASONS.has(row.reason)) throw new Error('Invalid report category');
    const authState = row.authState ?? 'unknown';
    if (!['guest', 'authenticated', 'unknown'].includes(authState) || row.eventName !== 'designer.auth.state_resolved' && authState !== 'unknown') throw new Error('Invalid auth category');
    const authOperation = row.authOperation ?? 'other';
    if (!['initial', 'change', 'other'].includes(authOperation) || row.eventName !== 'designer.auth.state_resolved' && authOperation !== 'other') throw new Error('Invalid auth operation');
    const key = `${row.eventName}/${row.source}/${row.reason}/${authState}/${authOperation}`;
    if (seen.has(key)) throw new Error('Duplicate report row');
    seen.add(key);
    const count = number(row.events, 1), retained = number(row.retainedRows, 1), interval = number(row.maxInterval, 1);
    if (count < retained || count > retained * interval) throw new Error('Invalid report sampling');
    const latest = receivedAt(row.latestReceivedAt), time = Date.parse(latest);
    if (time < period.start || time >= period.end) throw new Error('Report date outside period');
    if (!result.latestReceivedAt || latest > result.latestReceivedAt) result.latestReceivedAt = latest;
    result.sampling.estimatedEvents = add(result.sampling.estimatedEvents, count);
    result.sampling.retainedRows = add(result.sampling.retainedRows, retained);
    result.sampling.maxInterval = Math.max(result.sampling.maxInterval || 1, interval);
    const problem = result.problems.find(problem => problem.kind === PROBLEM_EVENTS[row.eventName]);
    if (problem) problem.count = add(problem.count, count);
    if (row.eventName === 'designer.text.added') result.actions.textAdditions = add(result.actions.textAdditions, count);
    if (row.eventName === 'designer.product_selected') result.actions.garmentChanges = add(result.actions.garmentChanges, count);
    if (frontendCovered && row.eventName === 'designer.artwork.placed') {
      const source = { 'local-upload': 'local', 'ai-generated': 'ai', library: 'library' }[row.source];
      if (!source) throw new Error('Invalid placement source');
      result.actions.artworkPlacements = add(result.actions.artworkPlacements, count);
      result.placement[source] = add(result.placement[source], count);
    }
    if (frontendCovered && row.eventName === 'designer.auth.state_resolved') {
      result.auth[authState] = add(result.auth[authState], count);
      const operationCounts = authOperation === 'initial' ? result.authInitial : authOperation === 'change' ? result.authChanges : null;
      if (operationCounts) operationCounts[authState] = add(operationCounts[authState], count);
    }
    if (row.eventName === 'designer.session_started') result.totals.opens = add(result.totals.opens, count);
    if (row.eventName === 'designer.ai.generate.success') result.totals.aiGenerations = add(result.totals.aiGenerations, count);
    if (row.eventName === 'designer.upload.accepted') {
      const name = { 'local-upload': 'local', 'ai-generated': 'ai', library: 'library' }[row.source];
      if (name) result.artwork[name] = add(result.artwork[name], count);
      if (row.source === 'local-upload') result.totals.localUploads = add(result.totals.localUploads, count);
    }
    const name = { 'designer.add_to_cart.start': 'starts', 'designer.add_to_cart.success': 'successes', 'designer.add_to_cart.failure': 'failures' }[row.eventName];
    if (name) result.cart[name] = add(result.cart[name], count);
    if (name === 'failures') reasons.set(row.reason, add(reasons.get(row.reason) || 0, count));
  }
  result.cart.reasons = [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const hoursSeen = new Set();
  for (const row of hourly) {
    if (!BUCKET_EVENTS.includes(row.eventName)) throw new Error('Invalid hourly category');
    const bucket = number(row.bucket), count = number(row.events, 1), milliseconds = bucket * 1000;
    if (bucket % 900 || milliseconds < Math.floor(period.start / 900000) * 900000 || milliseconds >= period.end) throw new Error('Invalid bucket date');
    const key = `${row.eventName}/${bucket}`;
    if (hoursSeen.has(key)) throw new Error('Duplicate hourly row');
    hoursSeen.add(key);
    const destination = { 'designer.session_started': result.opensBuckets, 'designer.add_to_cart.failure': result.cart.failureBuckets, 'designer.upload.accepted': result.uploadBuckets, 'designer.ai.generate.success': result.aiBuckets }[row.eventName];
    destination.push({ timestamp: new Date(milliseconds).toISOString(), count });
  }
  for (const entries of [result.opensBuckets, result.cart.failureBuckets, result.uploadBuckets, result.aiBuckets]) entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return result;
}

export function createStudioUsageHandler({ fetcher = globalThis.fetch, now = Date.now, timeoutMs = 10000 } = {}) {
  const cache = new Map();
  return async function studioUsage(request, env) {
    if (request.method !== 'GET') return response({ error: 'Use GET to load Studio usage.' }, 405);
    let options;
    try { options = requestOptions(request, now()); queries(options.period); if (options.comparison) queries(options.comparison); }
    catch (error) { return response({ error: error.status === 400 ? error.message : 'Invalid report dates.' }, 400); }
    const token = env.STUDIO_ANALYTICS_TOKEN, account = env.STUDIO_ANALYTICS_ACCOUNT_ID || DEFAULT_ACCOUNT;
    if (typeof token !== 'string' || !token.trim() || !/^[a-f0-9]{32}$/.test(account)) return response({ error: 'Studio usage is temporarily unavailable.' }, 503);
    // Credential identity stays server-side and prevents cached results crossing credentials.
    const key = JSON.stringify([account, token, env.PREPARED_ORDER_ADMIN_TOKEN || null, options]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return response(cached.value);
    async function run(sql) {
      const controller = new AbortController();
      let timer;
      try {
        const timedOut = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Report timeout')); }, timeoutMs); });
        const result = await Promise.race([(async () => {
          const upstream = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
            method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: sql, signal: controller.signal });
          if (!upstream.ok) throw new Error('Report unavailable');
          const data = await upstream.json();
          // Provider preaggregation metadata counts inputs, not missing aggregate rows.
          // Every grouping dimension is bounded categorical; quarter-hour/event rows
          // are bounded independently across the maximum 31-day + DST range.
          const maxRows = sql.includes('AS bucket') ? MAX_BUCKET_ROWS : MAX_SUMMARY_ROWS;
          if (!data || !Array.isArray(data.data) || data.data.length > maxRows
            || data.rows !== undefined && number(data.rows) !== data.data.length) throw new Error('Incomplete report');
          return data.data;
        })(), timedOut]);
        return result;
      } finally { clearTimeout(timer); }
    }
    try {
      const generatedAt = new Date(now()).toISOString();
      const periods = [options.period, ...(options.comparison ? [options.comparison] : [])];
      const reports = await Promise.all(periods.map(async period => {
        // Coverage must be validated before querying newly introduced events.
        // Ledger failure still leaves all legacy telemetry available.
        const outcomeReport = await loadOutcomeReport(env, period, fetcher, timeoutMs);
        const frontendFrom = outcomeReport.status === 'ready' ? outcomeReport.coverage.frontendFrom : null;
        const [summary, hourly] = await Promise.all(queries(period, frontendFrom).map(run));
        return assemble(period, summary, hourly, generatedAt, outcomeReport);
      }));
      const value = { ...reports[0], ...(reports[1] ? { comparison: reports[1] } : {}) };
      for (const [entryKey, entry] of cache) if (entry.expires <= now()) cache.delete(entryKey);
      if (cache.size >= 50) cache.delete(cache.keys().next().value);
      cache.set(key, { expires: now() + (reports.every(report => report.outcomeReport.status === 'ready') ? 60000 : 5000), value });
      return response(value);
    } catch { return response({ error: 'Studio usage could not load. Try again shortly.' }, 503); }
  };
}

export const handleStudioUsage = createStudioUsageHandler();
