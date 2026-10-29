import { mapConcurrent } from './prepared-publish-progress.mjs';

const prefix = env => `admin-prepared-orders/v1/${encodeURIComponent(env.SHOPIFY_SHOP_DOMAIN.toLowerCase())}/`;
export function preparedDraftSummary(record) {
  const first = record.items[0];
  const mockup = record.mockups.find(image => image.itemIds?.includes(first?.id)) || record.mockups[0];
  const thumbnail = first?.proofAssetId ? { assetId: first.proofAssetId, mime: 'image/png' }
    : mockup && /^image\/(png|jpeg|webp)$/.test(mockup.mime) ? { assetId: mockup.assetId, mime: mockup.mime }
    : { image: first?.image || '' };
  return { listVersion: 2, id: record.id, title: record.title, preparedFor: record.preparedFor,
    updatedAt: record.updatedAt, deletedAt: record.deletedAt || null,
    itemCount: record.items.length, mockupCount: record.mockups.length, thumbnail };
}

export function preparedListLinkState(mapping, revision, now = Date.now()) {
  if (mapping?.publishingAt && now - Date.parse(mapping.publishingAt) < 120000) return 'publishing';
  const link = mapping?.link;
  if (!link) return 'none';
  if (['revoked', 'purged'].includes(link.status)) return 'disabled';
  if (Date.parse(link.expiresAt) <= now || link.status === 'expired') return 'expired';
  if (link.status !== 'active') return 'disabled';
  return (mapping.sourceRevision || link.sourceRevision) === revision ? 'ready' : 'changes';
}

async function metadata(bucket, keyPrefix) {
  const entries = []; let cursor;
  do {
    const result = await bucket.list({ prefix: keyPrefix, limit: 1000, cursor, include: ['customMetadata'] });
    entries.push(...result.objects); cursor = result.truncated ? result.cursor : null;
  } while (cursor);
  return entries;
}
function parsed(entry, field) { try { return JSON.parse(entry.customMetadata?.[field] || 'null'); } catch { return null; } }

export async function browsePreparedOrders(env, options, read) {
  const bucket = env.R2_BUCKET, root = prefix(env);
  const q = String(options.q || '').trim().slice(0, 120).toLocaleLowerCase();
  const view = ['current', 'archived', 'all'].includes(options.view) ? options.view : 'current';
  const sort = options.sort === 'name' ? 'name' : 'recent';
  const [entries, management] = await Promise.all([metadata(bucket, root + 'drafts/'), metadata(bucket, root + 'management/')]);
  const flags = new Map(management.map(entry => { const value = parsed(entry, 'management'); return [value?.id, value]; }));
  let rows = entries.map(entry => {
    const summary = parsed(entry, 'summary');
    return summary && !summary.deletedAt ? { ...summary, revision: entry.etag, archivedAt: flags.get(summary.id)?.archivedAt || null } : null;
  }).filter(Boolean);
  // Search all saved garments, including records beyond the visible page.
  if (q) {
    const matching = new Set();
    await mapConcurrent(rows, 4, async row => {
      if (`${row.title} ${row.preparedFor}`.toLocaleLowerCase().includes(q)) { matching.add(row.id); return; }
      const record = await read(row.id);
      if (record.items.some(item => `${item.title} ${item.color} ${item.variantTitle}`.toLocaleLowerCase().includes(q))) matching.add(row.id);
    });
    rows = rows.filter(row => matching.has(row.id));
  }
  const counts = { current: rows.filter(row => !row.archivedAt).length, archived: rows.filter(row => row.archivedAt).length, all: rows.length };
  rows = rows.filter(row => view === 'all' || (view === 'archived' ? row.archivedAt : !row.archivedAt));
  rows.sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  const offset = /^\d{1,8}$/.test(options.cursor || '') ? Number(options.cursor) : 0;
  const page = rows.slice(offset, offset + 25);
  await mapConcurrent(page, 4, async row => {
    if (row.listVersion !== 2) Object.assign(row, preparedDraftSummary(await read(row.id)));
    try {
      const stored = await bucket.get(root + 'links/' + row.id + '.json');
      const mapping = stored ? await stored.json() : null;
      row.linkState = preparedListLinkState(mapping, row.revision);
      row.hasLink = Boolean(mapping?.link);
    } catch { row.linkState = 'unknown'; row.hasLink = true; }
  });
  return { drafts: page, counts, total: rows.length, cursor: offset + page.length < rows.length ? String(offset + page.length) : null };
}
