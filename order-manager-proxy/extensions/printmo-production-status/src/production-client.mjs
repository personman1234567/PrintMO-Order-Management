export const API_BASE = 'https://order-manager-proxy.printmobusiness.workers.dev';

export const STAGE_OPTIONS = [
  {value: 'received', label: 'Received'},
  {value: 'to_order', label: 'Create blanks order'},
  {value: 'blanks_cart', label: 'Blanks cart'},
  {value: 'blanks_ordered', label: 'Blanks ordered'},
  {value: 'print', label: 'Ready to print'},
  {value: 'completed', label: 'Completed'},
];

const MUTABLE_FIELDS = [
  ['stage', 'stage'],
  ['bundleId', 'bundle_id'],
  ['internalNotes', 'internal_notes'],
  ['printedCount', 'printed_count'],
  ['blanksStatus', 'blanks_status'],
  ['printsStatus', 'prints_status'],
  ['printsOrdered', 'prints_ordered'],
];

export function productionPath(gid) {
  if (!gid) throw new Error('Shopify did not provide an order ID.');
  return `/order-manager/v1/orders/${encodeURIComponent(gid)}/production`;
}

export function normalizeProduction(value = {}) {
  return {
    id: value.id || null,
    stage: STAGE_OPTIONS.some((option) => option.value === value.stage) ? value.stage : 'received',
    version: Number.isInteger(Number(value.version)) ? Number(value.version) : 0,
    bundleId: value.bundleId || '',
    blanksPo: Array.isArray(value.blanksPo) ? value.blanksPo : [],
    printedCount: Math.max(0, Number(value.printedCount) || 0),
    blanksStatus: Number(value.blanksStatus) ? 1 : 0,
    printsStatus: Number(value.printsStatus) ? 1 : 0,
    printsOrdered: Number(value.printsOrdered) ? 1 : 0,
    internalNotes: value.internalNotes || '',
    updatedAt: value.updatedAt || null,
  };
}

export function buildProductionPatch(original, draft) {
  const before = normalizeProduction(original);
  const after = normalizeProduction({...before, ...draft});
  const patch = {};
  for (const [clientField, apiField] of MUTABLE_FIELDS) {
    if (after[clientField] !== before[clientField]) patch[apiField] = after[clientField];
  }
  return patch;
}

export function stageLabel(stage) {
  return STAGE_OPTIONS.find((option) => option.value === stage)?.label || 'Received';
}

export function responseError(status, body) {
  const nested = body?.error;
  const message = typeof nested === 'string'
    ? nested
    : nested?.message || body?.message || `Request failed (${status})`;
  const error = new Error(message);
  error.status = status;
  error.code = nested?.code || body?.code || null;
  error.currentVersion = nested?.currentVersion;
  return error;
}

export async function authenticatedRequest(path, options = {}) {
  const token = await shopify.auth.idToken();
  if (!token) throw new Error('Shopify authentication did not return an ID token.');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    // The status still gives the operator an actionable failure.
  }
  if (!response.ok) throw responseError(response.status, body);
  return body;
}

export function idempotencyKey(gid) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${gid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
