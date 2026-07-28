export const API_BASE = 'https://order-manager-proxy.printmobusiness.workers.dev';

export const STAGE_OPTIONS = [
  {value: 'received', label: 'Received'},
  {value: 'to_order', label: 'Create blanks order'},
  {value: 'blanks_cart', label: 'Blanks'},
  {value: 'blanks_ordered', label: 'Blanks'},
  {value: 'print', label: 'Ready to print'},
  {value: 'completed', label: 'Production complete'},
];

export const DISPLAY_STAGE_OPTIONS = [
  {value: 'received', label: 'Received'},
  {value: 'to_order', label: 'Create blanks order'},
  {value: 'blanks', label: 'Blanks'},
  {value: 'print', label: 'Ready to print'},
  {value: 'completed', label: 'Production complete'},
];

const MUTABLE_FIELDS = [
  ['stage', 'stage'],
  ['internalNotes', 'internal_notes'],
  ['printedCount', 'printed_count'],
  ['blanksStatus', 'blanks_status'],
  ['blanksOrdered', 'blanks_ordered'],
  ['printsStatus', 'prints_status'],
  ['printsOrdered', 'prints_ordered'],
];

const STAGE_RANK = new Map(DISPLAY_STAGE_OPTIONS.map((option, index) => [option.value, index]));

export function productionPath(gid) {
  if (!gid) throw new Error('Shopify did not provide an order ID.');
  return `/order-manager/v1/orders/${encodeURIComponent(gid)}/production`;
}

export function normalizeProduction(value = {}) {
  const garmentCount = Number(value.garmentCount);
  return {
    id: value.id || null,
    stage: STAGE_OPTIONS.some((option) => option.value === value.stage) ? value.stage : 'received',
    version: Number.isInteger(Number(value.version)) ? Number(value.version) : 0,
    bundleId: value.bundleId || '',
    blanksPo: Array.isArray(value.blanksPo) ? value.blanksPo : [],
    garmentCount: Number.isInteger(garmentCount) && garmentCount >= 0 ? garmentCount : 0,
    printedCount: Math.max(0, Number(value.printedCount) || 0),
    blanksStatus: Number(value.blanksStatus) ? 1 : 0,
    blanksOrdered: Number(value.blanksOrdered) ? 1 : 0,
    printsStatus: Number(value.printsStatus) ? 1 : 0,
    printsOrdered: Number(value.printsOrdered) ? 1 : 0,
    internalNotes: String(value.internalNotes || '').slice(0, 5000),
    archivedAt: value.archivedAt || null,
    archivedBy: value.archivedBy || null,
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

  // Stage and blanksOrdered jointly encode the two canonical Blanks substages.
  // Whenever either changes, send both so another client can never observe an
  // impossible mixed state.
  if ('stage' in patch || 'blanks_ordered' in patch) {
    patch.stage = after.stage;
    patch.blanks_ordered = after.blanksOrdered;
  }
  return patch;
}

export function displayStage(stage) {
  return stage === 'blanks_cart' || stage === 'blanks_ordered' ? 'blanks' : stage;
}

export function stageLabel(stage) {
  return DISPLAY_STAGE_OPTIONS.find((option) => option.value === displayStage(stage))?.label || 'Received';
}

export function stageRank(stage) {
  return STAGE_RANK.get(displayStage(stage)) ?? 0;
}

export function blanksSubstage(production = {}) {
  return production.stage === 'blanks_ordered' || Number(production.blanksOrdered)
    ? 'ordered'
    : 'cart';
}

export function setBlanksSubstage(current, substage) {
  const ordered = substage === 'ordered';
  return {
    ...current,
    stage: ordered ? 'blanks_ordered' : 'blanks_cart',
    blanksOrdered: ordered ? 1 : 0,
  };
}

export function applyDisplayStageTransition(current, nextDisplayStage) {
  const next = {...current};
  const previousDisplayStage = displayStage(current.stage);
  if (nextDisplayStage === 'blanks') {
    next.stage = 'blanks_cart';
    next.blanksOrdered = 0;
  } else {
    next.stage = nextDisplayStage;
  }
  if (previousDisplayStage === 'blanks' && nextDisplayStage === 'print') {
    next.blanksStatus = 1;
  }
  if (nextDisplayStage === 'completed') {
    next.printedCount = Math.max(0, Number(current.garmentCount) || 0);
  }
  return next;
}

export function updateReadinessDependency(current, orderedField, readyField, checked) {
  const next = {...current, [orderedField]: checked ? 1 : 0};
  const clearedReady = !checked && Boolean(next[readyField]);
  if (clearedReady) next[readyField] = 0;
  return {next, clearedReady};
}

function touchedClientFields(original, draft) {
  const before = normalizeProduction(original);
  const after = normalizeProduction({...before, ...draft});
  const touched = new Set(
    MUTABLE_FIELDS
      .map(([clientField]) => clientField)
      .filter((clientField) => before[clientField] !== after[clientField]),
  );
  if (touched.has('stage') || touched.has('blanksOrdered')) {
    touched.add('stage');
    touched.add('blanksOrdered');
  }
  return touched;
}

export function currentProductionSatisfiesDraft(original, draft, current) {
  const after = normalizeProduction({...normalizeProduction(original), ...draft});
  const latest = normalizeProduction(current);
  return [...touchedClientFields(original, draft)]
    .every((field) => latest[field] === after[field]);
}

export function mergeProductionConflict(original, draft, current) {
  const latest = normalizeProduction(current);
  const operatorDraft = normalizeProduction({...normalizeProduction(original), ...draft});
  const merged = {...latest};
  for (const field of touchedClientFields(original, draft)) merged[field] = operatorDraft[field];
  return merged;
}

export function printedCountError(value, garmentCount) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return 'Enter a whole number.';
  const count = Number(text);
  if (!Number.isSafeInteger(count)) return 'Enter a smaller whole number.';
  if (count > garmentCount) return `Pieces printed cannot exceed ${garmentCount}.`;
  return '';
}

export function responseError(status, body) {
  const nested = body?.error;
  const message = typeof nested === 'string'
    ? nested
    : nested?.message || body?.message || `Request failed (${status})`;
  const error = new Error(message);
  const details = nested?.details || body?.details || {};
  error.status = status;
  error.code = nested?.code || body?.code || null;
  error.currentVersion = details.currentVersion ?? nested?.currentVersion;
  error.currentProduction = details.current || nested?.current;
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

export function idempotencyKey(_gid, cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const random = new Uint8Array(12);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(random);
  } else {
    for (let index = 0; index < random.length; index += 1) {
      random[index] = Math.floor(Math.random() * 256);
    }
  }
  const entropy = Array.from(random, (value) => value.toString(16).padStart(2, '0')).join('');
  return `admin:${Date.now().toString(36)}:${entropy}`;
}
