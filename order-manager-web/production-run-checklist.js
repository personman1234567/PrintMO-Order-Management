/* A script-free, printable snapshot of the saved run. No production state changes. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductionRunChecklist = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paragraph = value => `<p class="instructions">${escape(value)}</p>`;
  function render(jobs, { generatedAt = new Date().toISOString(), revision = 0, excluded = 0 } = {}) {
    const total = jobs.reduce((sum, job) => sum + job.quantity, 0);
    const timestamp = new Date(generatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' });
    const orderCount = `${jobs.length} ${jobs.length === 1 ? 'order' : 'orders'}`;
    const orders = jobs.map(job => {
      const rows = job.lines.map(line => {
        const item = (job.order.items || []).find(item => item.id === line.itemId);
        const instructions = (item?.customAttributes || []).filter(a => a.key === '_designer_item_instructions' && a.value).map(a => a.value);
        if (item?.instructions) instructions.push(item.instructions);
        return `<tr><td><span class="check" aria-label="Check when done"></span></td><td><strong>${escape(line.title)}</strong>${[...new Set(instructions)].map(paragraph).join('')}</td><td>${escape(line.color || 'Not recorded')}</td><td>${escape(line.size || 'Not recorded')}</td><td>${escape(line.quantity)}</td><td>${escape(line.setupLabel)}</td></tr>`;
      }).join('');
      const readiness = `${job.lines.reduce((sum, line) => sum + line.ready, 0)}/${job.quantity} blanks ready / received · Prints ${job.printsReady ? 'marked in hand' : 'not marked in hand'}`;
      return `<section><h2>${escape(job.name)} <small>${escape(job.identity.provider)}</small></h2><p>${escape(readiness)}${job.targetDate ? ` · Target: ${escape(job.targetDate)}` : ''}</p><table><thead><tr><th>Done</th><th>Garment / instructions</th><th>Color</th><th>Size</th><th>Qty</th><th>Recorded placements</th></tr></thead><tbody>${rows}</tbody></table>${job.order.notes ? `<h3>Production notes</h3>${paragraph(job.order.notes)}` : ''}${!job.lines.length ? paragraph('No printable garment lines are available in this snapshot. Review the order.') : ''}</section>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Today’s run checklist</title><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;color:#17212f;background:white;font:14px/1.5 system-ui,sans-serif}h1{font-size:24px;margin:0}h2{font-size:18px;margin:0 0 4px;overflow-wrap:anywhere}h3{font-size:14px;margin:12px 0 4px}p{margin:4px 0 12px}small{font-size:12px;font-weight:400}header{border-bottom:2px solid #17212f;padding-bottom:12px}header p{margin-bottom:4px}.notice{font-size:12px;color:#465363}section{padding:20px 0;border-bottom:1px solid #aeb8c5}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #cbd2da;padding:8px 6px;overflow-wrap:anywhere}th{font-size:11px}th:first-child{width:42px}th:nth-child(2){width:32%}th:nth-child(4),th:nth-child(5){width:9%}.check{display:block;width:15px;height:15px;border:1px solid #17212f;margin-top:3px}.instructions{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;font-size:12px}
      @media screen and (max-width:600px){body{padding:16px}table,tbody,tr,td{display:block}thead{display:none}tr{position:relative;padding:8px 0 12px 28px;border-bottom:1px solid #aeb8c5}td{padding:2px 0;border:0}td:first-child{position:absolute;left:0;top:8px}td:nth-child(3)::before{content:'Color: '}td:nth-child(4)::before{content:'Size: '}td:nth-child(5)::before{content:'Qty: '}td:nth-child(6)::before{content:'Placements: '}}
      @page{size:auto;margin:12mm}@media print{body{padding:0;font-size:10pt}h1{font-size:18pt}h2{font-size:13pt}h2,h3{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}section{padding-top:14px}.instructions{font-size:9pt}}
      </style></head><body><header><h1>Today’s run</h1><p>${orderCount} · ${escape(total)} garments</p><p class="notice">Generated ${escape(timestamp)} · Run revision ${escape(revision)}</p><p class="notice">Snapshot of recorded information. Review current artwork, instructions and press settings before production. Check marks on paper do not update Order Manager.${excluded ? ` ${escape(excluded)} saved run ${excluded === 1 ? 'member is' : 'members are'} outside the current To Print queue and excluded.` : ''}</p></header>${orders}</body></html>`;
  }
  return { render };
});
