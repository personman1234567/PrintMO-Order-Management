(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StudioActivityModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const imageExtension = /\.(png|jpe?g|webp|gif|avif|svg|heic|heif)$/i;
  const kinds = ['all', 'mockups', 'uploads', 'ai'];
  function metadata(value = {}) {
    return Object.fromEntries(Object.entries(value || {}).map(([key, val]) => [key.toLowerCase(), val]));
  }
  function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function inputDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year, month, day] = value.split('-').map(Number), result = new Date(year, month - 1, day);
    return dateKey(result) === value ? result : null;
  }
  function rangeBounds(start, end) {
    let first = inputDate(start), last = inputDate(end);
    if (!first || !last) return null;
    if (first > last) [first, last] = [last, first];
    const after = new Date(last); after.setDate(after.getDate() + 1);
    return { start: dateKey(first), end: dateKey(last), after: first.toISOString(), before: after.toISOString() };
  }
  // Upload directories are UTC dates; UI ranges are local calendar dates.
  function rangeDates(bounds) {
    const dates = [], cursor = new Date(bounds.after), last = new Date(new Date(bounds.before).getTime() - 1);
    cursor.setUTCHours(0, 0, 0, 0);
    last.setUTCHours(0, 0, 0, 0);
    while (cursor <= last) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    return dates.reverse();
  }
  function normalizeItem(object = {}, kind) {
    const meta = metadata(object.metadata || object.customMetadata || object.custom_metadata);
    const key = String(object.key || object.name || object.objectKey || object.Key ||
      (object.id ? `${meta.source === 'studio-checkout' ? 'checkout' : 'upload'}:${object.id}` : ''));
    return {
      key, kind, uploadId: kind === 'uploads' ? object.id : null,
      checkoutAssetId: meta.source === 'studio-checkout' && kind === 'mockups' ? object.id : null,
      filename: object.filename || key.split('/').pop() || '', metadata: meta,
      contentType: object.contentType || object.httpMetadata?.contentType || '', size: object.size ?? null,
      uploadedAt: object.uploadedAt || object.uploaded || object.lastModified || object.mtime || null,
      storageDate: /\/(\d{4}-\d{2}-\d{2})(?:\/|$)/.exec(key)?.[1] || ''
    };
  }
  function timestamp(item) {
    const value = item.metadata.createdat || item.uploadedAt || (item.storageDate ? `${item.storageDate}T12:00:00Z` : '');
    return Date.parse(value) || 0;
  }
  function identity(item) {
    const meta = item.metadata;
    return String(meta.identitykey || meta.customerid || meta.customeremail || meta.guestid || '');
  }
  function customer(item) {
    const meta = item.metadata;
    return String(meta.customername || meta.customeremail || (meta.audience === 'guest' || meta.guestid || String(meta.identitykey || '').startsWith('guest:') ? 'Guest' : ''));
  }
  function isImage(item) { return /^image\//i.test(item.contentType) || imageExtension.test(item.filename); }
  function mergePromptMetadata(items) {
    const sidecars = new Map(items.filter(item => /\.json$/i.test(item.key)).map(item => [item.key.replace(/\.json$/i, ''), item.metadata]));
    return items.map(item => ({ ...item, metadata: { ...(sidecars.get(item.key.replace(/\.[^.]+$/, '')) || {}), ...item.metadata } }));
  }
  function searchText(item) {
    const meta = item.metadata;
    return [item.key, item.filename, meta.customername, meta.customeremail, meta.customerid, meta.guestid, meta.identitykey,
      meta.designref, meta.workspaceid, meta.producthandle, meta.producttitle, meta.color, meta.side, meta.role,
      meta.promptshort, meta.style, meta.audience, meta.ordername, meta.ordergid].filter(Boolean).join(' ').toLowerCase();
  }
  function fileLabel(item) {
    const meta = item.metadata;
    const role = { mockup: 'Mockup', design: 'Print artwork', 'mobile-preview': 'Mobile preview' }[meta.role];
    return [role || (item.kind === 'ai' ? 'AI image' : item.kind === 'uploads' ? 'Uploaded artwork' : 'Preview'),
      meta.side, meta.color].filter(Boolean).join(' · ');
  }
  function coverRank(item) { return ({ mockup: 0, design: 1, 'mobile-preview': 3 })[item.metadata.role] ?? 2; }
  function buildFeed({ previews = [], prompts = [], uploads = [], filter = 'all', query = '', bounds = null } = {}) {
    const entries = new Map(), sources = [...previews, ...mergePromptMetadata(prompts), ...uploads];
    for (const item of sources) {
      if (!item.key || !isImage(item)) continue;
      const time = timestamp(item);
      if (bounds && time && (time < Date.parse(bounds.after) || time >= Date.parse(bounds.before))) continue;
      const meta = item.metadata;
      // Same-customer/date and same-product are not proof of the same export.
      // Legacy files without a workspace identity remain independently accessible.
      const id = item.kind === 'mockups' && meta.designref && meta.workspaceid
        ? JSON.stringify(['export', identity(item), meta.designref, meta.workspaceid]) : JSON.stringify([item.kind, item.key]);
      if (!entries.has(id)) entries.set(id, { id, kind: item.kind, items: [], timestamp: time });
      const entry = entries.get(id);
      if (!entry.items.some(file => file.key === item.key)) entry.items.push(item);
      entry.timestamp = Math.max(entry.timestamp, time);
    }
    const text = query.trim().toLowerCase();
    return [...entries.values()].map(entry => {
      entry.items.sort((a, b) => coverRank(a) - coverRank(b) || timestamp(b) - timestamp(a) || a.key.localeCompare(b.key));
      entry.cover = entry.items[0];
      const meta = entry.cover.metadata;
      entry.checkout = Boolean(entry.cover.checkoutAssetId);
      const orderFile = entry.items.find(item => item.metadata.ordergid);
      entry.orderName = orderFile?.metadata.ordername || '';
      entry.action = entry.checkout ? (orderFile ? 'Purchased' : 'Checkout created')
        : { mockups: 'Mockup exported', ai: 'AI generated', uploads: 'Artwork uploaded' }[entry.kind];
      entry.title = String(entry.kind === 'mockups' ? meta.producttitle || 'Design export'
        : entry.kind === 'ai' ? meta.promptshort || 'AI image' : 'Uploaded artwork');
      entry.date = entry.timestamp ? dateKey(new Date(entry.timestamp)) : '';
      return entry;
    }).filter(entry => (filter === 'all' || filter === entry.kind)
      && (!text || entry.items.some(item => searchText(item).includes(text))))
      .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  }
  function relativeTime(time, now = Date.now()) {
    if (!time) return 'Date unavailable';
    const minutes = Math.floor((now - time) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function dayLabel(key, now = new Date()) {
    if (!key) return 'Date unavailable';
    if (key === dateKey(now)) return 'Today';
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (key === dateKey(yesterday)) return 'Yesterday';
    return inputDate(key)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) || key;
  }
  return Object.freeze({ kinds, metadata, dateKey, inputDate, rangeBounds, rangeDates, normalizeItem, timestamp, customer,
    mergePromptMetadata, searchText, fileLabel, buildFeed, relativeTime, dayLabel });
});
