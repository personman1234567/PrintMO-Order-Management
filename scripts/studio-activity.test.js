const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const model = require('../order-manager-web/studio-activity-model');
const file = (key, metadata = {}, kind = 'mockups', uploadedAt = '2026-11-16T15:00:00Z') => model.normalizeItem({ key, customMetadata: metadata, uploadedAt }, kind);

test('an export groups only its explicit workspace; duplicates, variants, artwork and derivatives remain available', () => {
  const common = { designref: 'export-1', workspaceid: 'original', identitykey: 'guest:one', producttitle: 'Performance polo' };
  const files = [file('previews/2026-11-16/export-1/mockup.png', { ...common, role: 'mockup' }),
    file('previews/2026-11-16/export-1/print.svg', { ...common, role: 'design', side: 'front' }),
    file('previews/2026-11-16/export-1/mobile.png', { ...common, role: 'mobile-preview', side: 'front' }),
    file('previews/2026-11-16/export-1/duplicate.png', { ...common, workspaceid: 'duplicate', role: 'mockup' }),
    file('previews/2026-11-16/export-1/other-person.png', { ...common, identitykey: 'guest:two' })];
  const feed = model.buildFeed({ previews: [...files, files[0]] });
  assert.equal(feed.length, 3);
  const original = feed.find(entry => entry.items.length === 3);
  assert.equal(original.cover.metadata.role, 'mockup');
  assert.equal(original.title, 'Performance polo');
  assert.equal(original.items[2].metadata.role, 'mobile-preview');
  assert.equal(feed.reduce((sum, entry) => sum + entry.items.length, 0), 5);
});

test('unknown legacy associations are never merged merely by customer, product or date', () => {
  const metadata = { customerid: '123', producttitle: 'Polo', designref: 'legacy' };
  assert.equal(model.buildFeed({ previews: [file('previews/2026-11-16/a.png', metadata), file('previews/2026-11-16/b.png', metadata)] }).length, 2);
});

test('AI metadata sidecars attach to their image without producing a second activity; source filtering and exact reference search preserve the bundle', () => {
  const prompts = [file('prompts/guest/date/a.png', {}, 'ai'), file('prompts/guest/date/a.json', { promptshort: 'Green truck', style: 'vector' }, 'ai')];
  const previews = [file('previews/date/x.png', { workspaceid: 'ws', designref: 'ref', role: 'mockup' }), file('previews/date/art.svg', { workspaceid: 'ws', designref: 'ref', role: 'design' })];
  const uploads = [model.normalizeItem({ id: 'opaque-ref', filename: 'original.svg', contentType: 'image/svg+xml', uploadedAt: '2026-11-16T14:00:00Z' }, 'uploads')];
  const all = model.buildFeed({ previews, prompts, uploads });
  assert.equal(all.length, 3);
  assert.equal(all.find(entry => entry.kind === 'ai').title, 'Green truck');
  assert.equal(model.buildFeed({ prompts, query: 'vector' }).length, 1);
  const reference = model.buildFeed({ previews, query: 'art.svg' });
  assert.equal(reference.length, 1); assert.equal(reference[0].items.length, 2);
  assert.equal(model.buildFeed({ previews, prompts, uploads, filter: 'uploads' })[0].cover.uploadId, 'opaque-ref');
});

test('mixed creation sources sort by actual creation time, not filename or JSON ordering', () => {
  const a = file('previews/2026-11-16/zzz.png', { createdat: '2026-11-16T10:00:00Z' });
  const b = file('prompts/guest/2026-11-16/aaa.png', { createdat: '2026-11-16T16:00:00Z' }, 'ai');
  const upload = model.normalizeItem({ id: 'upload', filename: 'upload.png', uploadedAt: '2026-11-16T12:00:00Z' }, 'uploads');
  assert.deepEqual(model.buildFeed({ previews: [a], prompts: [b], uploads: [upload] }).map(entry => entry.kind), ['ai', 'uploads', 'mockups']);
});

test('Chicago local date selection includes both UTC prefix dates and handles the 25-hour DST day', () => {
  const path = require.resolve('../order-manager-web/studio-activity-model');
  const run = spawnSync(process.execPath, ['-e', `const m=require(${JSON.stringify(path)});const b=m.rangeBounds('2026-11-01','2026-11-01');process.stdout.write(JSON.stringify({b,dates:m.rangeDates(b)}))`], { env: { ...process.env, TZ: 'America/Chicago' }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); const result = JSON.parse(run.stdout);
  assert.equal(Date.parse(result.b.before) - Date.parse(result.b.after), 25 * 3600000);
  assert.deepEqual(result.dates, ['2026-11-02', '2026-11-01']);
});

test('range boundaries exclude neighboring-day records; rejected dates cannot turn into successful empty results', () => {
  assert.equal(model.rangeBounds('2026-02-30', '2026-03-01'), null);
  assert.equal(model.rangeBounds('', '2026-03-01'), null);
  const bounds = model.rangeBounds('2026-11-16', '2026-11-16');
  const before = new Date(Date.parse(bounds.after) - 1).toISOString(), start = bounds.after, end = bounds.before;
  const previews = [file('old.png', { createdat: before }), file('in.png', { createdat: start }), file('next.png', { createdat: end })];
  assert.deepEqual(model.buildFeed({ previews, bounds }).map(entry => entry.cover.key), ['in.png']);
});

test('private checkout proof and sides share one entry that becomes purchased with the same identity', () => {
  const common = { source: 'studio-checkout', designref: 'draft-42', workspaceid: 'design-one', producttitle: 'Cotton tee' };
  const assets = [
    { id: 'mockup-1', filename: 'proof.png', metadata: { ...common, role: 'mockup' } },
    { id: 'svg-front', filename: 'front.svg', metadata: { ...common, role: 'design', side: 'front' } },
    { id: 'svg-back', filename: 'back.svg', metadata: { ...common, role: 'design', side: 'back' } },
  ];
  const [created] = model.buildFeed({ previews: assets.map(asset => model.normalizeItem(asset, 'mockups')) });
  assert.equal(created.action, 'Checkout created');
  assert.equal(created.cover.checkoutAssetId, 'mockup-1');
  assert.deepEqual(created.items.map(model.fileLabel).sort(), ['Mockup', 'Print artwork · back', 'Print artwork · front']);
  const purchased = model.buildFeed({ previews: assets.map(asset => model.normalizeItem({ ...asset,
    metadata: { ...asset.metadata, ordergid: 'gid://shopify/Order/84', ordername: '#1084' },
  }, 'mockups')), query: '#1084' });
  assert.equal(purchased.length, 1);
  assert.equal(purchased[0].id, created.id);
  assert.equal(purchased[0].action, 'Purchased');
  assert.equal(purchased[0].orderName, '#1084');
});
