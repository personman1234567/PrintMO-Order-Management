/* Same-origin, static-assets-only renderer. No application API or credentials. */
(() => {
  'use strict';
  const release = new URL(self.location.href).search;
  const assetRoot = new URL('./report-assets/', self.location.href);
  const assetUrl = name => { const url = new URL(name, assetRoot); url.search = release; return url.href; };
  let libraries;
  function loadLibraries() {
    if (!libraries) {
      importScripts(assetUrl('vendor/pdf-lib.min.js'), assetUrl('vendor/fontkit.umd.min.js'));
      libraries = self.PDFLib;
      if (!libraries || !self.fontkit) throw new Error('PDF assets are unavailable. Refresh the app and try again.');
    }
    return libraries;
  }
  async function staticBytes(url, limit) {
    const target = new URL(url);
    if (target.origin !== assetRoot.origin || !target.pathname.startsWith(assetRoot.pathname)) throw new Error('Report images must use approved local report assets.');
    const response = await fetch(target.href, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error('A report font or image could not load. Refresh the app and try again.');
    const length = Number(response.headers.get('content-length'));
    if (length > limit) throw new Error('A report asset exceeds the supported size.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('A report asset exceeds the supported size.');
    return bytes;
  }
  const number = (value, field) => { if (!Number.isSafeInteger(value)) throw new Error(`The report has an invalid ${field}. Check its calculation snapshot.`); return value; };
  const nullableMoney = (value, field) => value === null ? null : number(value, field);
  function validate(snapshot) {
    if (!snapshot?.owner?.id || !snapshot.owner.name || !snapshot.period?.start || !snapshot.period?.end || !snapshot.totals) throw new Error('Report identity or period is missing. Generate a fresh report.');
    if (snapshot.currency !== 'USD') throw new Error('This report template currently supports USD snapshots only.');
    if (!['sample', 'live'].includes(snapshot.mode)) throw new Error('The report mode is missing or unsupported. Generate a fresh report.');
    if (!Array.isArray(snapshot.products) || !Array.isArray(snapshot.orders)) throw new Error('Report rows are missing. Generate a fresh report.');
    if (snapshot.products.length > 2000 || snapshot.orders.length > 5000) throw new Error('This report has too many rows. Choose a shorter period.');
    for (const row of [...snapshot.products, ...snapshot.orders]) {
      number(row.quantity, 'quantity');
      if (snapshot.mode === 'live') nullableMoney(row.salesCents, 'salesCents'); else number(row.salesCents, 'salesCents');
      for (const key of ['baseCents', 'earningsCents']) nullableMoney(row[key], key);
      if (row.quantity < 0) throw new Error('A report quantity is invalid. Check its calculation snapshot.');
    }
    for (const row of snapshot.orders) if (!['fulfilled', 'pending'].includes(row.status)) throw new Error('A report row has an unknown fulfillment status.');
    for (const key of ['fulfilledItems', 'pendingItems', 'itemCount', 'orderCount', 'fulfilledOrders', 'pendingOrders']) number(snapshot.totals[key], key);
    if (snapshot.mode === 'live') nullableMoney(snapshot.totals.salesCents, 'salesCents'); else number(snapshot.totals.salesCents, 'salesCents');
    for (const key of ['fulfilledItems', 'pendingItems', 'itemCount', 'orderCount', 'fulfilledOrders', 'pendingOrders']) if (snapshot.totals[key] < 0) throw new Error('A report count is invalid. Generate a fresh report.');
    const moneyKeys = ['baseCents', 'earningsCents', 'fulfilledEarningsCents', 'pendingEarningsCents'];
    for (const key of moneyKeys) nullableMoney(snapshot.totals[key], key);
    if (snapshot.totals.knownEarningsCents !== undefined) nullableMoney(snapshot.totals.knownEarningsCents, 'knownEarningsCents');
    if (snapshot.totals.knownSalesCents !== undefined) nullableMoney(snapshot.totals.knownSalesCents, 'knownSalesCents');
    if (snapshot.exceptions !== undefined && !Array.isArray(snapshot.exceptions)) throw new Error('Report exceptions could not be read. Generate a fresh report.');
    if ((snapshot.exceptions?.length || 0) > 1000) throw new Error('This report has too many review items. Choose a shorter period.');
    const needsReview = snapshot.status === 'needs-review' || snapshot.completeness?.complete === false || snapshot.completeness?.financialComplete === false
      || (snapshot.mode === 'live' && (snapshot.status !== 'complete' || snapshot.completeness?.complete !== true || snapshot.completeness?.financialComplete !== true))
      || snapshot.totals.salesCents === null || moneyKeys.some(key => snapshot.totals[key] === null) || [...snapshot.orders, ...snapshot.products].some(row => row.salesCents === null || row.baseCents === null || row.earningsCents === null)
      || Boolean(snapshot.exceptions?.length);
    if (!needsReview && snapshot.totals.fulfilledEarningsCents + snapshot.totals.pendingEarningsCents !== snapshot.totals.earningsCents) throw new Error('Fulfilled and pending earnings do not reconcile. Check the report calculation.');
    if (!needsReview && snapshot.totals.salesCents - snapshot.totals.baseCents !== snapshot.totals.earningsCents) throw new Error('Sales, approved base and earnings do not reconcile. Check the report calculation.');
    if (!needsReview) for (const rows of [snapshot.orders, snapshot.products]) {
      for (const [field, total] of [['quantity', 'itemCount'], ['salesCents', 'salesCents'], ['baseCents', 'baseCents'], ['earningsCents', 'earningsCents']]) {
        const sum = rows.reduce((value, row) => value + row[field], 0);
        if (!Number.isSafeInteger(sum) || sum !== snapshot.totals[total]) throw new Error('Report rows do not reconcile with the summary. Generate a fresh calculation snapshot.');
      }
    }
    return { needsReview };
  }
  const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  function money(cents) { if (cents === null) return 'Not calculated'; const sign = cents < 0 ? '-' : ''; const absolute = Math.abs(cents); return `${sign}$${Math.floor(absolute / 100).toLocaleString('en-US')}.${String(absolute % 100).padStart(2, '0')}`; }
  function date(value, options = {}) { const input = clean(value), parsed = new Date(input.length === 10 ? `${input}T12:00:00Z` : input); return Number.isNaN(parsed.valueOf()) ? input || 'Not recorded' : new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', ...options }).format(parsed); }

  async function render(snapshot) {
    const { needsReview } = validate(snapshot);
    const { PDFDocument, rgb } = loadLibraries();
    const doc = await PDFDocument.create();
    doc.registerFontkit(self.fontkit);
    doc.setTitle(`${clean(snapshot.owner.name)} - Storefront earnings`);
    doc.setAuthor('Print-MO'); doc.setSubject(snapshot.mode === 'sample' ? 'Fictional design sample' : 'Storefront earnings preview');
    doc.setCreator(`Print-MO Storefront Reports ${clean(snapshot.templateVersion || '1')}`);
    const [regularBytes, boldBytes] = await Promise.all([staticBytes(assetUrl('Manrope-Regular.ttf'), 3000000), staticBytes(assetUrl('Manrope-Bold.ttf'), 3000000)]);
    const regular = await doc.embedFont(regularBytes, { subset: true }), bold = await doc.embedFont(boldBytes, { subset: true });
    const color = hex => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
    const C = { bg: color('edf4ff'), navy: color('1c3052'), muted: color('667d9b'), blue: color('087bfa'), line: color('d7e4f6'), white: rgb(1, 1, 1), stripe: color('f6f9ff'), total: color('e1edff'), review: color('88480e'), reviewBg: color('fff0d6') };
    async function logo(url) {
      try {
        const target = new URL(url, self.location.href);
        if (!/\.(png|jpe?g)$/i.test(target.pathname)) throw new Error('Unsupported image');
        target.search = release;
        const bytes = await staticBytes(target.href, 1500000);
        return /\.png$/i.test(target.pathname) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      } catch (_) { return null; }
    }
    const printmo = await logo(assetUrl('printmo-logo.png'));
    const partner = snapshot.owner.logoUrl ? await logo(snapshot.owner.logoUrl) : null;
    const pages = [], W = 612, H = 792, M = 42, WIDTH = W - M * 2;
    const text = (page, value, x, top, size = 9, font = regular, ink = C.navy) => page.drawText(clean(value), { x, y: H - top - size, size, font, color: ink });
    const right = (page, value, edge, top, size = 9, font = regular, ink = C.navy) => text(page, value, edge - font.widthOfTextAtSize(clean(value), size), top, size, font, ink);
    const box = (page, x, top, width, height, fill = C.white, border = C.line) => page.drawRectangle({ x, y: H - top - height, width, height, color: fill, borderColor: border, borderWidth: 0.6 });
    const rule = (page, top) => page.drawLine({ start: { x: M, y: H - top }, end: { x: W - M, y: H - top }, color: C.line, thickness: 0.7 });
    function wrap(value, maxWidth, font = regular, size = 9) {
      const lines = []; let line = '';
      for (const word of clean(value).split(' ')) {
        if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= maxWidth) { line = line ? `${line} ${word}` : word; continue; }
        if (line) { lines.push(line); line = ''; }
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > maxWidth && line) { lines.push(line); line = ''; }
          line += char;
        }
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    }
    function image(page, img, x, top, maxWidth, maxHeight) { const scale = Math.min(maxWidth / img.width, maxHeight / img.height); page.drawImage(img, { x, y: H - top - img.height * scale, width: img.width * scale, height: img.height * scale }); }
    const label = snapshot.mode === 'sample' ? 'FICTIONAL DESIGN SAMPLE' : needsReview ? 'NEEDS REVIEW' : 'REPORT PREVIEW';
    const headerOffset = needsReview ? 34 : 0, continuationTop = 184 + headerOffset;
    function newPage(title) {
      const page = doc.addPage([W, H]); pages.push(page);
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bg });
      if (printmo) image(page, printmo, M, 27, 106, 49); else text(page, 'Print-MO', M, 36, 23, bold);
      right(page, 'STOREFRONT REPORT', W - M, 34, 7, bold);
      right(page, label, W - M, 49, 7, bold, C.blue);
      rule(page, 89);
      if (needsReview) { box(page, M, 99, WIDTH, 25, C.reviewBg); text(page, 'NEEDS REVIEW / Earnings are incomplete. Review exceptions before relying on totals.', M + 10, 107, 8, bold, C.review); }
      if (title) { text(page, title, M, 113 + headerOffset, 23, bold); text(page, snapshot.owner.name, M, 148 + headerOffset, 10, regular, C.muted); }
      return page;
    }
    let page = newPage();
    const ownerLines = wrap(snapshot.owner.name.toUpperCase(), 421, bold, 10);
    if (ownerLines.length > 3) throw new Error('The owner display name is too long for the report heading. Use a shorter display name.');
    ownerLines.forEach((line, i) => text(page, line, M, 109 + headerOffset + i * 13, 10, bold, C.blue));
    const headingTop = 129 + headerOffset + (Math.min(ownerLines.length, 3) - 1) * 13;
    text(page, 'Storefront earnings', M, headingTop, 28, bold);
    text(page, `Orders placed ${date(snapshot.period.start)} - ${date(snapshot.period.end)}`, M, headingTop + 42, 10, regular, C.muted);
    const cutoff = snapshot.period.cutoffISO || snapshot.generatedAt;
    const asOf = snapshot.retrievalEndedAt || snapshot.retrievalEnd || snapshot.generatedAt || cutoff;
    text(page, cutoff ? `Placed-date cutoff ${date(cutoff, { hour: 'numeric', minute: '2-digit' })} Central` : 'Reporting period in Central time', M, headingTop + 60, 8, regular, C.muted);
    if (snapshot.mode === 'live') text(page, `Fulfillment current as of ${date(asOf, { hour: 'numeric', minute: '2-digit' })} Central`, M, headingTop + 75, 8, regular, C.muted);
    if (partner) image(page, partner, 503, 109 + headerOffset, 64, 64);
    const cardTop = headingTop + 91 + (snapshot.mode === 'live' ? 15 : 0);
    box(page, M, cardTop, WIDTH, 120);
    page.drawLine({ start: { x: 306, y: H - cardTop - 24 }, end: { x: 306, y: H - cardTop - 95 }, color: C.line, thickness: 0.7 });
    text(page, 'FULFILLED EARNINGS', M + 20, cardTop + 20, 8, bold, C.blue);
    text(page, 'PENDING EARNINGS', 326, cardTop + 20, 8, bold, C.muted);
    function headline(cents, x, maxWidth) { const value = money(cents); let size = 30; while (bold.widthOfTextAtSize(value, size) > maxWidth && size > 13) size--; text(page, value, x, cardTop + 49, size, bold); }
    headline(snapshot.totals.fulfilledEarningsCents, M + 20, 225); headline(snapshot.totals.pendingEarningsCents, 326, 222);
    text(page, `${snapshot.totals.fulfilledItems} items / ${snapshot.totals.fulfilledOrders} fulfilled orders`, M + 20, cardTop + 94, 8, regular, C.muted);
    text(page, `${snapshot.totals.pendingItems} items awaiting fulfillment`, 326, cardTop + 94, 8, regular, C.muted);
    text(page, 'Pending earnings are shown separately from fulfilled earnings.', M + 2, cardTop + 134, 8, regular, C.muted);
    const metricTop = cardTop + (snapshot.mode === 'live' ? 154 : 169);
    [['MERCHANDISE SALES', money(snapshot.totals.salesCents)], ['ITEMS ORDERED', String(snapshot.totals.itemCount)], ['ORDERS', String(snapshot.totals.orderCount)]].forEach(([name, value], i) => { text(page, name, M + i * 181, metricTop, 7, bold, C.muted); text(page, value, M + i * 181, metricTop + 17, 20, bold); });
    let y = metricTop + 66;
    function productHeading(continued = false) { text(page, continued ? 'Sales by product / continued' : 'Sales by product', M, y, 16, bold); text(page, 'Includes fulfilled and pending items / USD', M, y + 24, 8, regular, C.muted); y += 46; productHeader(); }
    function productHeader() { box(page, M, y, WIDTH, 27, C.total); text(page, 'PRODUCT', M + 12, y + 9, 7, bold, C.muted); [['ITEMS', 300], ['SALES', 380], ['BASE AMOUNT', 473], ['EARNINGS', 558]].forEach(([name, edge]) => right(page, name, edge, y + 9, 7, bold, C.muted)); y += 27; }
    productHeading();
    if (!snapshot.products.length) { box(page, M, y, WIDTH, 55); text(page, needsReview ? 'No report rows available. Review retrieval and calculation exceptions.' : 'No activity in this reporting period.', M + 12, y + 20, 9); y += 55; }
    for (const [index, row] of snapshot.products.entries()) {
      const lines = wrap(row.name, 202, regular, 9), height = Math.max(34, lines.length * 13 + 18);
      if (height > 430) throw new Error('A product name is too long to lay out. Shorten its display name.');
      if (y + height > 695) { page = newPage('Product breakdown'); y = continuationTop; productHeading(true); }
      box(page, M, y, WIDTH, height, index % 2 ? C.stripe : C.white);
      lines.forEach((line, n) => text(page, line, M + 12, y + 11 + n * 13, 9));
      [[String(row.quantity), 300], [money(row.salesCents), 380], [money(row.baseCents), 473], [money(row.earningsCents), 558]].forEach(([value, edge]) => right(page, value, edge, y + 11, 9)); y += height;
    }
    if (y + 38 > 704) { page = newPage('Product breakdown / totals'); y = continuationTop; productHeader(); }
    box(page, M, y, WIDTH, 38, C.total); text(page, 'ALL SELECTED SALES', M + 12, y + 13, 8, bold); [[String(snapshot.totals.itemCount), 300], [money(snapshot.totals.salesCents), 380], [money(snapshot.totals.baseCents), 473], [money(snapshot.totals.earningsCents), 558]].forEach(([value, edge]) => right(page, value, edge, y + 13, 9, bold, C.blue));
    if (snapshot.orders.length) {
      page = newPage('Order detail'); y = continuationTop;
      function detailHeader() { box(page, M, y, WIDTH, 28, C.total); text(page, 'ORDER / PRODUCT', M + 12, y + 9, 7, bold, C.muted); text(page, 'STATUS', 315, y + 9, 7, bold, C.muted); right(page, 'ITEMS', 411, y + 9, 7, bold, C.muted); right(page, 'SALES', 479, y + 9, 7, bold, C.muted); right(page, 'EARNINGS', 558, y + 9, 7, bold, C.muted); y += 28; }
      detailHeader();
      for (const [index, row] of snapshot.orders.entries()) {
        const lines = wrap(row.product, 243, regular, 9), height = Math.max(61, 43 + lines.length * 13);
        if (height > 450) throw new Error('An order product name is too long to lay out. Shorten its display name.');
        if (y + height > 700) { page = newPage('Order detail / continued'); y = continuationTop; detailHeader(); }
        box(page, M, y, WIDTH, height, index % 2 ? C.stripe : C.white);
        text(page, `${clean(row.label)} / ${date(row.date)}`, M + 12, y + 9, 8, bold);
        lines.forEach((line, n) => text(page, line, M + 12, y + 26 + n * 13, 9));
        text(page, row.status === 'fulfilled' ? 'FULFILLED' : 'PENDING', 315, y + 12, 7, bold, row.status === 'fulfilled' ? C.navy : C.muted);
        right(page, String(row.quantity), 411, y + 12, 9); right(page, money(row.salesCents), 479, y + 12, 9); right(page, money(row.earningsCents), 558, y + 12, 9, bold);
        text(page, `Base ${money(row.baseCents)}`, 430, y + 32, 7, regular, C.muted);
        y += height;
      }
      if (y + 111 > 709) { page = newPage('Report reconciliation'); y = continuationTop; }
      y += 15; box(page, M, y, WIDTH, 84, C.total);
      text(page, needsReview ? 'RECONCILIATION INCOMPLETE' : 'EARNINGS RECONCILIATION', M + 12, y + 12, 8, bold);
      if (needsReview) {
        text(page, 'Approved fulfillment prices or other required inputs are unresolved.', M + 12, y + 32, 9);
        text(page, 'Total earnings: Not calculated. Review the exceptions that follow.', M + 12, y + 50, 9, bold, C.review);
      } else {
        text(page, `${money(snapshot.totals.salesCents)} sales - ${money(snapshot.totals.baseCents)} approved base = ${money(snapshot.totals.earningsCents)}`, M + 12, y + 32, 9);
        text(page, `${money(snapshot.totals.fulfilledEarningsCents)} fulfilled + ${money(snapshot.totals.pendingEarningsCents)} pending`, M + 12, y + 53, 9);
        right(page, money(snapshot.totals.earningsCents), 558, y + 51, 14, bold, C.blue);
      }
    }
    if (needsReview) {
      page = newPage('Needs review / exceptions'); y = continuationTop;
      const intro = 'This report is incomplete. Only known amounts are shown. Not calculated marks unresolved financial inputs; it never means zero. Resolve the items below and generate a fresh report.';
      for (const line of wrap(intro, WIDTH, regular, 10)) { text(page, line, M, y, 10); y += 15; }
      y += 14;
      if (snapshot.totals.knownSalesCents != null) { text(page, `Verified linked sales (partial, not a grand total): ${money(snapshot.totals.knownSalesCents)}`, M, y, 10, bold); y += 29; }
      if (snapshot.totals.knownEarningsCents != null) { text(page, `Calculated items only / earnings (partial, not a total): ${money(snapshot.totals.knownEarningsCents)}`, M, y, 10, bold); y += 29; }
      const exceptions = snapshot.exceptions?.length ? snapshot.exceptions : [{ code: 'INCOMPLETE_REPORT', message: 'Confirm complete retrieval, owner attribution and approved fulfillment prices for this period; then generate again.' }];
      for (const [index, exception] of exceptions.entries()) {
        // Only the explicit report-safe DTO fields are included; never dump source objects.
        const code = /^[A-Za-z0-9_.:-]{1,80}$/.test(exception.code || '') ? exception.code : 'REVIEW_REQUIRED';
        const heading = `${index + 1}. ${code}`;
        const detail = [exception.message || 'Review this item and generate a fresh report.', exception.product ? `Product: ${clean(exception.product)}` : '', exception.orderLabel ? `Order: ${clean(exception.orderLabel)}` : ''].filter(Boolean).join(' / ');
        const lines = [...wrap(heading, WIDTH - 24, bold, 10), ...wrap(detail, WIDTH - 24, regular, 9)];
        for (let i = 0; i < lines.length; i++) {
          if (y + 24 > 704) { page = newPage('Review exceptions / continued'); y = continuationTop; }
          text(page, lines[i], M + 12, y, i === 0 ? 10 : 9, i === 0 ? bold : regular, i === 0 ? C.review : C.navy); y += i === 0 ? 20 : 14;
        }
        y += 16;
      }
    }
    pages.forEach((p, i) => {
      rule(p, 738);
      text(p, needsReview ? `PRINT-MO / ${snapshot.mode === 'sample' ? 'FICTIONAL SAMPLE / ' : ''}NEEDS REVIEW / FINANCIAL TOTALS INCOMPLETE` : snapshot.mode === 'sample' ? 'PRINT-MO / FICTIONAL DESIGN SAMPLE' : 'PRINT-MO / STOREFRONT EARNINGS PREVIEW', M, 751, 7, regular, C.muted);
      right(p, `${i + 1} / ${pages.length}`, W - M, 751, 7, regular, C.muted);
    });
    return doc.save();
  }
  self.onmessage = async ({ data }) => {
    try { const bytes = await render(data?.snapshot); self.postMessage({ bytes }, [bytes.buffer]); }
    catch (error) { self.postMessage({ error: error?.message || 'PDF preparation failed. Generate the report again.' }); }
  };
})();
