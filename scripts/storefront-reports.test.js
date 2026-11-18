const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const model = import(pathToFileURL(path.join(root, 'order-manager-web/storefront-reports-model.mjs')).href);
const now = new Date('2026-11-11T20:30:00Z');
test('Central-time presets, leap year and inclusive range validation', async () => {
  const m = await model;
  assert.deepEqual(m.defaultPeriod('month-to-date', now), { start: '2026-11-01', end: '2026-11-11' });
  assert.deepEqual(m.defaultPeriod('last-month', new Date('2024-03-01T12:00:00Z')), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(m.defaultPeriod('month-to-date', new Date('2026-11-01T03:00:00Z')), { start: '2026-10-01', end: '2026-10-31' });
  for (const p of [{start:'2026-02-30',end:'2026-03-01'}, {start:'2026-11-05',end:'2026-11-01'}, {start:'2026-11-01',end:'2026-12-01'}]) assert.throws(() => m.validatePeriod(p, now));
});
test('sample snapshot reconciles details and groups; frozen and owner isolated', async () => {
  const m = await model; const range={start:'2026-11-01',end:'2026-11-11'};
  const d = m.createSampleSnapshot('dr-dallas', range, now);
  assert.equal(d.mode, 'sample'); assert.equal(d.totals.salesCents,73000); assert.equal(d.totals.baseCents,38500);
  assert.equal(d.totals.fulfilledEarningsCents,25000); assert.equal(d.totals.pendingEarningsCents,9500); assert.equal(d.totals.earningsCents,34500);
  assert.equal(d.products.reduce((s,p)=>s+p.earningsCents,0),34500);
  assert.ok(Object.isFrozen(d.orders[0])); assert.ok(Object.isFrozen(d.period));
  assert.equal(m.createSampleSnapshot('dr-dallas',{start:'2026-11-03',end:'2026-11-03'},now).orders.length,1);
  const empty=m.createSampleSnapshot('dr-dallas',{start:'2026-10-01',end:'2026-10-31'},now);
  assert.equal(empty.noActivity,true); assert.equal(empty.totals.earningsCents,0);
  const other=m.createSampleSnapshot('sample-owner',range,now);
  assert.equal(other.owner.logoUrl,null); assert.ok(other.orders.every(o=>!d.orders.some(r=>r.id===o.id)));
  assert.throws(()=>m.createSampleSnapshot('unknown',range,now)); assert.throws(()=>m.money(NaN));
});
test('ZIP stores exact PDF bytes with correct CRC, safe names and owner boundaries', async () => {
  const {createZip}=await model;const entries=[{name:'Dallas.pdf',bytes:new TextEncoder().encode('123456789')},{name:'Sample.pdf',bytes:new Uint8Array([37,80,68,70,45])}];
  const zip=createZip(entries);const view=new DataView(zip.buffer);let offset=0;
  for (const [i,e] of entries.entries()) {
    assert.equal(view.getUint32(offset,true),0x04034b50);assert.equal(view.getUint16(offset+6,true),0x0800);
    if(i===0)assert.equal(view.getUint32(offset+14,true),0xcbf43926);
    const length=view.getUint16(offset+26,true),data=offset+30+length;
    assert.equal(new TextDecoder().decode(zip.slice(offset+30,data)),e.name);assert.deepEqual(zip.slice(data,data+e.bytes.length),e.bytes);offset=data+e.bytes.length;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(zip.length-22,true),0x06054b50);assert.equal(view.getUint16(zip.length-12,true),2);
  for(const name of ['../other.pdf','folder/a.pdf','bad.txt'])assert.throws(()=>createZip([{name,bytes:entries[0].bytes}]));
  assert.throws(()=>createZip([entries[0],entries[0]]));assert.throws(()=>createZip([]));
});
test('report libraries/styles remain lazy and pinned assets match packages', () => {
  const html=fs.readFileSync(path.join(root,'order-manager-web/index.html'),'utf8');
  assert.match(html,/data-view="reports"[^>]*hidden/);assert.doesNotMatch(html,/<link[^>]+storefront-reports\.css/);
  assert.doesNotMatch(html,/src="[^\"]*(?:pdf-lib|fontkit|pdf\.mjs|pdf\.worker)/);
  const loader=fs.readFileSync(path.join(root,'order-manager-web/storefront-reports.js'),'utf8');
  assert.doesNotMatch(loader,/get\('reports'\)/);
  assert.match(loader,/url\.search = source\.search/);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'order-manager-web/report-assets/vendor/manifest.json'),'utf8'));
  for(const [name,entry] of Object.entries(manifest.files)){
    const bytes=fs.readFileSync(path.join(root,'order-manager-web/report-assets/vendor',name));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    if(entry.source.startsWith('node_modules/'))assert.deepEqual(bytes,fs.readFileSync(path.join(root,entry.source)));
  }
});

test('all-time preset uses the full sample history with resolved preview/export dates',async()=>{const m=await model;assert.deepEqual(m.defaultPeriod('all-time',now),{preset:'all-time',start:'',end:'2026-11-11'});const snapshot=m.createSampleSnapshot('dr-dallas',{preset:'all-time'},now);assert.equal(snapshot.period.start,'2026-11-02');assert.equal(snapshot.period.end,'2026-11-11');assert.equal(snapshot.period.preset,'all-time');assert.equal(snapshot.orders.length,6);assert.equal(snapshot.totals.earningsCents,34500);});
