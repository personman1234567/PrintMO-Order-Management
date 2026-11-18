// Report-only sample model. No Shopify, operational adapters or financial execution.
export const TEMPLATE_VERSION = 'redesign-sample-v1';
export const TIME_ZONE = 'America/Chicago';
export const OWNERS = Object.freeze([
  Object.freeze({ id: 'dr-dallas', name: 'The Dr. Dallas Show', logoUrl: './report-assets/dr-dallas-logo.png' }),
  Object.freeze({ id: 'sample-owner', name: 'Sample storefront', logoUrl: null })
]);
export function money(cents) {
  if (!Number.isSafeInteger(cents)) throw new TypeError('Amount must be whole currency cents.');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function dateOnly(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function defaultPeriod(preset = 'month-to-date', now = new Date()) {
  const today = dateOnly(now), month = today.slice(0, 7);
  if (preset === 'all-time') return { preset: 'all-time', start: '', end: today };
  if (preset === 'last-month') {
    const [year, mm] = month.split('-').map(Number);
    return { start: new Date(Date.UTC(year, mm - 2, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(year, mm - 1, 0)).toISOString().slice(0, 10) };
  }
  return { start: `${month}-01`, end: today };
}
export function validatePeriod({ start, end, preset } = {}, now = new Date()) {
  for (const date of [start, end]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Choose valid start and end dates.');
  }
  if (start > end) throw new Error('Start date must be on or before end date.');
  if (end > dateOnly(now)) throw new Error('End date cannot be in the future.');
  if (preset !== 'all-time' && (Date.parse(end) - Date.parse(start)) / 86400000 > 366) throw new Error('Choose a range of up to one year for this sample.');
  return { start, end };
}
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  return Object.freeze(value);
}
const SAMPLE_ROWS = [
  ['DEMO-001', '2026-11-02', 'Classic tee', 6, 14400, 6600, 'fulfilled'],
  ['DEMO-002', '2026-11-03', 'Premium tee', 5, 15000, 8000, 'fulfilled'],
  ['DEMO-003', '2026-11-05', 'Embroidered cap', 4, 10000, 5200, 'fulfilled'],
  ['DEMO-004', '2026-11-07', 'Pullover hoodie', 3, 14400, 9000, 'fulfilled'],
  ['DEMO-005', '2026-11-09', 'Premium tee', 4, 12000, 6400, 'pending'],
  ['DEMO-006', '2026-11-11', 'Classic tee', 3, 7200, 3300, 'pending']
];
export function createSampleSnapshot(ownerId, period, now = new Date()) {
  if(period?.preset==='all-time') period={preset:'all-time',start:'2026-11-02',end:dateOnly(now)};
  validatePeriod(period, now);
  const owner = OWNERS.find(o => o.id === ownerId);
  if (!owner) throw new Error('Choose a configured storefront owner.');
  const rows = ownerId === 'dr-dallas' ? SAMPLE_ROWS : [
    ['SAMPLE-001', '2026-11-03', 'Sample sweatshirt', 2, 9000, 5000, 'fulfilled'],
    ['SAMPLE-002', '2026-11-10', 'Sample tee', 3, 7500, 4200, 'pending']
  ];
  const orders = rows.filter(r => r[1] >= period.start && r[1] <= period.end).map(([label, date, product, quantity, salesCents, baseCents, status]) => ({
    id: `${ownerId}:${label}`, label, date, product, quantity, salesCents, baseCents, earningsCents: salesCents - baseCents, status
  }));
  const totals = { salesCents: 0, baseCents: 0, earningsCents: 0, fulfilledEarningsCents: 0, pendingEarningsCents: 0, fulfilledItems: 0, pendingItems: 0, itemCount: 0, orderCount: orders.length, fulfilledOrders: 0, pendingOrders: 0 };
  const products = new Map();
  for (const row of orders) {
    for (const key of ['salesCents', 'baseCents', 'earningsCents']) totals[key] += row[key];
    totals.itemCount += row.quantity;
    const prefix = row.status === 'fulfilled' ? 'fulfilled' : 'pending';
    totals[`${prefix}EarningsCents`] += row.earningsCents; totals[`${prefix}Items`] += row.quantity; totals[`${prefix}Orders`]++;
    if (!products.has(row.product)) products.set(row.product, { name: row.product, quantity: 0, salesCents: 0, baseCents: 0, earningsCents: 0 });
    const product = products.get(row.product); product.quantity += row.quantity;
    for (const key of ['salesCents', 'baseCents', 'earningsCents']) product[key] += row[key];
  }
  return deepFreeze({ id: `sample-${crypto.randomUUID()}`, owner: { ...owner }, period: { ...period, timeZone: TIME_ZONE, cutoffISO: now.toISOString() }, generatedAt: now.toISOString(), mode: 'sample', currency: 'USD', orders, products: [...products.values()], totals, noActivity: orders.length === 0, templateVersion: TEMPLATE_VERSION });
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
// ZIP STORE needs no extra library; every entry contains the exact preview bytes.
export function createZip(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw new Error('Choose between 1 and 20 completed PDFs.');
  const encoder = new TextEncoder(), chunks = [], central = [], names = new Set(); let offset = 0, total = 0;
  const header = size => { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; };
  for (const { name, bytes } of entries) {
    if (typeof name !== 'string' || !name.toLowerCase().endsWith('.pdf') || /[\\/\u0000-\u001f]/.test(name) || names.has(name)) throw new Error('Each PDF needs a unique, safe file name.');
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('A report PDF is missing or too large to download.');
    total += bytes.length; if (total > 50 * 1024 * 1024) throw new Error('Choose fewer reports for this download.');
    names.add(name); const filename = encoder.encode(name); if (filename.length > 200) throw new Error('Report file name is too long.'); const crc = crc32(bytes);
    const local = header(30); local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x0800, true); local.view.setUint16(12, 0x21, true); local.view.setUint32(14, crc, true); local.view.setUint32(18, bytes.length, true); local.view.setUint32(22, bytes.length, true); local.view.setUint16(26, filename.length, true);
    chunks.push(local.bytes, filename, bytes);
    const dir = header(46); dir.view.setUint32(0, 0x02014b50, true); dir.view.setUint16(4, 20, true); dir.view.setUint16(6, 20, true); dir.view.setUint16(8, 0x0800, true); dir.view.setUint16(14, 0x21, true); dir.view.setUint32(16, crc, true); dir.view.setUint32(20, bytes.length, true); dir.view.setUint32(24, bytes.length, true); dir.view.setUint16(28, filename.length, true); dir.view.setUint32(42, offset, true);
    central.push(dir.bytes, filename); offset += local.bytes.length + filename.length + bytes.length;
  }
  const dirSize = central.reduce((sum, b) => sum + b.length, 0), end = header(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, entries.length, true); end.view.setUint16(10, entries.length, true); end.view.setUint32(12, dirSize, true); end.view.setUint32(16, offset, true);
  const output = new Uint8Array(offset + dirSize + end.bytes.length); let cursor = 0;
  for (const part of [...chunks, ...central, end.bytes]) { output.set(part, cursor); cursor += part.length; }
  return output;
}
