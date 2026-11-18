/* Read-only telemetry reports inside the existing Studio activity workspace. */
(() => {
  const model = window.StudioUsageModel;
  const state = { active: false, screen: 'overview', range: null, data: null, busy: false, error: '', request: 0, compare: null, title: '', focus: false };
  let host, creations, search, refresh, tabs, currentLoad;
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (text, action, cls = '') => { const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b; };
  const amount = value => value === null || value === undefined ? '—' : model.number(value);
  function heading(text) { const h = node('h2', 'usage-title', text); h.tabIndex = -1; return h; }
  function link(text, url) { const a = node('a', 'usage-link', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function currentRange() { return window.StudioActivity?.range() || model.bounds(model.dateKey(new Date(Date.now() - 6 * 86400000)), model.dateKey(new Date())); }
  function setMode(mode) {
    state.active = mode === 'usage'; creations.hidden = state.active; host.hidden = !state.active; search.hidden = state.active;
    tabs.forEach(b => b.setAttribute('aria-pressed', String((b.dataset.studioMode === 'usage') === state.active)));
    document.getElementById('storage-view').dataset.studioMode = mode;
    if (state.active) { window.StudioActivity?.pause(); state.range = currentRange(); state.screen = 'overview'; state.focus = true; load(); }
    else { state.request++; currentLoad?.abort(); state.busy = false; window.StudioActivity?.enter(); }
  }
  function navigate(screen) { state.screen = screen; state.focus = true; if (screen === 'compare' && !state.compare) state.compare = model.preceding(state.range); render(); }
  function dateField(label, value, name) {
    const wrapper = node('label', 'usage-date-field', label), input = node('input'); input.type = 'date'; input.name = name; input.value = value; input.required = true; wrapper.append(input); return wrapper;
  }
  function periodForm() {
    const form = node('form', 'usage-period-form');
    form.append(dateField('From', state.range.start, 'start'), dateField('To', state.range.end, 'end'));
    const apply = node('button', '', 'Apply dates'); apply.type = 'submit'; form.append(apply);
    form.addEventListener('submit', event => {
      event.preventDefault(); const fields = new FormData(form), range = model.bounds(fields.get('start'), fields.get('end'));
      if (!range || model.days(range).length > 31) { showValidation('Choose an ordered date range of at most 31 days.'); return; }
      state.compare = null; window.StudioActivity.setRange(range.start, range.end);
    });
    return form;
  }
  function showValidation(text) { const e = host.querySelector('.usage-validation'); if (e) { e.textContent = text; e.focus(); } }
  function toolbar() {
    const row = node('div', 'usage-toolbar');
    if (state.screen !== 'overview') row.append(button('Back to Usage', () => navigate('overview'), 'usage-link'));
    if (state.screen !== 'compare') {
      const date = node('details', 'usage-date-options'), summary = node('summary', '', model.compactPeriod(state.range)); date.append(summary);
      const options = node('div', 'usage-date-menu');
      for (const [label, days] of [['Today', 1], ['Last 7 days', 7], ['Last 14 days', 14], ['Last 30 days', 30]]) options.append(button(label, () => {
        const end = new Date(), start = new Date(end); start.setDate(start.getDate() - days + 1); state.compare = null; window.StudioActivity.setRange(model.dateKey(start), model.dateKey(end));
      }));
      options.append(periodForm()); date.append(options); row.append(date); if (state.screen === 'overview') row.append(button('Compare periods', () => navigate('compare'))); row.append(node('span', 'usage-zone', model.zoneLabel()));
    }
    return row;
  }
  function metrics(items) {
    const dl = node('dl', 'usage-metrics');
    for (const [label, count] of items) { const group = node('div'); group.append(node('dt', '', label), node('dd', '', amount(count))); dl.append(group); }
    return dl;
  }
  function table(headers, rows) {
    const wrap = node('div', 'usage-table-wrap'), t = node('table', 'usage-table'), head = node('thead'), tr = node('tr');
    for (const label of headers) { const th = node('th', '', label); th.scope = 'col'; tr.append(th); } head.append(tr); t.append(head);
    const body = node('tbody'); for (const row of rows) { const r = node('tr'); row.forEach((value, i) => { const cell = node(i ? 'td' : 'th', '', String(value)); if (!i) cell.scope = 'row'; r.append(cell); }); body.append(r); } t.append(body); wrap.append(t); return wrap;
  }
  function chart(title, buckets, range) {
    const section = node('section', 'usage-chart'), asOf = Date.parse(state.data?.generatedAt) || Date.now(), {unit, values} = model.timeline(buckets, range, asOf);
    const header = node('div', 'usage-section-heading'); header.append(node('h3', '', title + ' by ' + unit));
    if (values.some(v => v.partial)) header.append(node('span', 'usage-muted', 'Through ' + new Date(asOf).toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'})));
    section.append(header);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), compact = host.clientWidth < 600, width = compact ? 360 : 680;
    svg.setAttribute('viewBox', '0 0 ' + width + ' 192'); svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs, text) => { const el = document.createElementNS(svg.namespaceURI, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); if (text !== undefined) el.textContent = text; svg.append(el); };
    const maximum = Math.max(4, Math.ceil(Math.max(0,...values.map(v=>v.count)) / 4) * 4), step = (width - 55) / values.length;
    for (const value of [0,maximum/2,maximum]) { const y = 153 - value / maximum * 132; add('line',{x1:32,y1:y,x2:width-12,y2:y,class:'usage-grid'}); add('text',{x:25,y:y+4,'text-anchor':'end'},amount(value)); }
    values.forEach((v,i) => { const x = 32 + i * step;
      if (!v.future && v.count) add('rect',{x:x+step*.16,y:153-v.count/maximum*132,width:step*.68,height:v.count/maximum*132,class:v.partial?'usage-column usage-column-partial':'usage-column'});
      if (i % Math.ceil(values.length / (compact?4:7)) === 0) add('text',{x:x+step/2,y:179,'text-anchor':'middle'},v.label);
    });
    section.append(svg);
    if (!values.some(v=>v.count)) section.append(node('p','usage-muted','No events recorded in the elapsed part of this period.'));
    if (values.some(v=>v.partial)) section.append(node('p','usage-chart-note','The current '+unit+' is in progress. Future '+unit+'s are blank.'));
    const disclosure = node('details','usage-counts'); disclosure.append(node('summary','','View '+(unit==='hour'?'hourly':'daily')+' counts'), table([unit==='hour'?'Hour':'Date','Recorded events'],values.map(v=>[v.label,v.future?'Not yet':amount(v.count)+(v.partial?' · in progress':'')]))); section.append(disclosure); return section;
  }
  function reasonsTable(data) { return table(['Failure reason','Recorded count'],data.cart.reasons.map(row=>[model.reasonLabel(row.reason),amount(row.count)])); }
  function coverageNotice(from, label) {
    if (!from || Date.parse(from) >= Date.parse(state.range.before)) return node('p','usage-muted',label+' history is not available for these dates.');
    if (Date.parse(from) > Date.parse(state.range.after)) return node('p','usage-muted',label+' history starts '+new Date(from).toLocaleString()+'. Earlier activity is not included.');
    return null;
  }
  function savedWork(data) {
    const section = node('section','usage-saved-work'); section.append(node('h3','','Saved work'));
    const report=data.outcomeReport;
    if (report?.status === 'ready') {
      section.append(metrics([['Projects saved',report.projects.saved],['Projects reopened',report.projects.reopened]]));
      const notes = [coverageNotice(report.coverage.savesFrom,'Save'),coverageNotice(report.coverage.reopensFrom,'Reopen')].filter(Boolean); section.append(...notes);
      section.append(node('p','usage-muted','Distinct projects in these dates; repeated saves count once.'));
    } else section.append(node('p','usage-muted','Project and account activity could not load. Refresh to try again.'));
    section.append(button('Projects & accounts',()=>navigate('projects'))); return section;
  }
  const problemLabels={ai:'AI requests failed',uploads:'Uploads rejected',preview:'Preview failures',saving:'Save and restore failures',cart:'Cart failures'};
  function problemRows(data) { return data.problems || [{kind:'cart',count:data.cart.failures}]; }
  function problemsSummary(data, detail = false) {
    const section=node('section','usage-problems'); if (!detail) section.append(node('h3','','Problems'));
    const rows=problemRows(data).filter(r=>r.count>0);
    if (rows.length) section.append(table(['Recorded problem','Events'],rows.map(r=>[problemLabels[r.kind],amount(r.count)])));
    else section.append(node('p','usage-muted','No failures recorded in the tracked actions.'));
    if (!detail) section.append(button('View problems',()=>navigate('failures'),'usage-link')); return section;
  }
  function placements(data) {
    const section=node('section','usage-artwork'); section.append(node('h3','','Artwork placements'));
    const rows=[['Uploaded files',data.placement?.local],['AI artwork',data.placement?.ai],['Saved artwork',data.placement?.library]], max=Math.max(1,...rows.map(r=>r[1]||0));
    for(const [label,count] of rows){const r=node('div','usage-bar-row'),track=node('span','usage-bar-track'),bar=node('span','usage-bar');bar.style.width=Math.max(0,Math.min(100,(count||0)/max*100))+'%';track.setAttribute('aria-hidden','true');track.append(bar);r.append(node('span','',label),track,node('strong','',amount(count)));section.append(r);}
    const note=coverageNotice(data.coverage?.frontendFrom,'Placement'); if(note)section.append(note);
    return section;
  }
  function overview(data) {
    const grid=node('div','usage-overview-grid'),left=node('div'),right=node('aside','usage-side');
    left.append(metrics([['Studio opens',data.totals.opens],['Uploads accepted',data.totals.localUploads],['AI images generated',data.totals.aiGenerations]]),node('p','usage-event-note','Estimated events · reloads and repeat uploads included'),chart('Studio opens',data.opensBuckets,state.range));
    const actions=node('section','usage-actions');actions.append(node('h3','','Design actions'),metrics([['Text additions',data.actions?.textAdditions],['Artwork placements',data.actions?.artworkPlacements],['Garment changes',data.actions?.garmentChanges]]));
    const sources=node('details','usage-placement-details');sources.append(node('summary','','Placement sources'),placements(data));left.append(actions,sources);
    right.append(savedWork(data));
    if(data.outcomeReport?.status==='ready'){const accounts=node('section','usage-account-summary');accounts.append(node('h3','','Accounts after a save prompt'),table(['Account activity','Accounts'],[['New accounts',amount(data.outcomeReport.accounts.newAccounts)],['Existing accounts',amount(data.outcomeReport.accounts.existingAccounts)]]));right.append(accounts);}
    const problems=problemsSummary(data);problems.classList.add('usage-overview-problems');grid.append(left,right,problems);host.append(grid,button('Open creations for these dates',()=>setMode('creations'),'usage-link usage-open-creations'));
  }
  function accountSection(report) {
    const section=node('section','usage-accounts'); section.append(node('h3','','Accounts after a save prompt'));
    section.append(table(['Account activity','Accounts'],[['New accounts',amount(report.accounts.newAccounts)],['Existing accounts signed in',amount(report.accounts.existingAccounts)],['Accounts with a saved project',amount(report.accounts.savedAccounts)],['Account type unresolved',amount(report.accounts.pendingAccounts)]]));
    section.append(node('p','usage-muted','New and existing accounts use the sign-in return date. Saved accounts use the successful save date. These are separate counts, not a conversion funnel.'));return section;
  }
  function projects(data) {
    host.append(heading('Projects & accounts'));
    const report=data.outcomeReport;
    if(report?.status!=='ready'){host.append(node('p','usage-muted','Project and account activity could not load. Refresh to try again.'));return;}
    host.append(metrics([['Projects saved',report.projects.saved],['Projects reopened',report.projects.reopened],['Projects created',report.projects.created]]));
    host.append(node('p','usage-muted','Distinct projects in these dates. Saves and reopens can include the same project. Creation counts use existing project records.'));
    const grid=node('div','usage-report-grid'),main=node('section'),side=node('aside','usage-side');main.append(node('h3','','Recent project activity'));
    const list=node('div','usage-project-list');
    for(const item of report.projects.items){const entry=node('article','usage-project'),caption=node('div');
      if(item.hasThumbnail&&window.StudioActivity?.projectMedia){const open=button('',()=>window.StudioActivity.openProject(item),'usage-project-preview');open.setAttribute('aria-label','View '+(item.title||'Untitled project'));open.append(window.StudioActivity.projectMedia(item));entry.append(open);}else entry.append(node('div','usage-project-no-preview','No preview'));
      caption.append(node('strong','',item.title||'Untitled project')); const time=node('time','',(item.action==='saved'?'Saved ':'Reopened ')+new Date(item.occurredAt).toLocaleString());time.dateTime=item.occurredAt;caption.append(time);entry.append(caption);list.append(entry);
    }
    if(!report.projects.items.length)main.append(node('p','usage-muted','No project activity available in the recorded history for these dates.'));else main.append(list,node('p','usage-muted','Latest activity for up to 20 projects. Deleted projects are excluded from these previews.'));
    side.append(accountSection(report));grid.append(main,side);host.append(grid);
    const notes=node('details','usage-coverage');notes.append(node('summary','','Measurement coverage'));
    for(const [from,label]of[[report.coverage.savesFrom,'Save'],[report.coverage.reopensFrom,'Reopen'],[report.coverage.frontendFrom,'Placement and sign-in']]){const note=coverageNotice(from,label);if(note)notes.append(note);else notes.append(node('p','usage-muted',label+' history covers these dates.'));}
    if(data.authInitial)notes.append(table(['Initial sign-in state','Resolved events'],[['Guest',amount(data.authInitial.guest)],['Signed in',amount(data.authInitial.authenticated)],['Unresolved',amount(data.authInitial.unknown)]]),node('p','usage-muted','Initial state events can include reloads. State changes do not identify new account creation.'));
    notes.append(node('p','usage-muted','Active editing time is not measured. Return visits and paid orders are not linked in this report.'));host.append(notes);
  }
  function failures(data) {
    host.append(heading('Problems'), problemsSummary(data, true), node('p', 'usage-muted', model.period(state.range)), metrics([['Cart starts', data.cart.starts], ['Successful handoffs', data.cart.successes], ['Failures', data.cart.failures]]));
    host.append(node('p', 'usage-muted', 'Recorded events; retries may appear more than once.'));
    const grid = node('div', 'usage-report-grid'), main = node('div'), side = node('aside', 'usage-side');
    main.append(chart('Cart failures', data.cart.failureBuckets, state.range));
    if (data.cart.reasons.length) main.append(reasonsTable(data)); else main.append(node('p', '', 'No cart failures recorded in this period.'));
    const scope = node('section'); scope.append(node('h3', '', 'Report scope'), node('p', '', 'Cart preparation and submission. Direct checkout is not included.'));
    if (data.cart.reasons.some(r => r.reason === 'export' || r.reason === 'preview')) {
      const check = node('section'); check.append(node('h3', '', 'Check artwork export'), node('p', '', 'Try the cart flow with a large artwork upload on mobile. Check whether artwork preparation completes.'), link('Open Studio', 'https://print-mo.com/pages/designer-studio')); side.append(check);
    }
    side.append(scope); grid.append(main, side); host.append(grid);
  }
  function comparisonForm() {
    const form = node('form', 'usage-comparison-form'), a = node('fieldset'), b = node('fieldset');
    a.append(node('legend', '', 'Before'), dateField('From', state.compare.start, 'compareStart'), dateField('To', state.compare.end, 'compareEnd'));
    b.append(node('legend', '', 'After'), dateField('From', state.range.start, 'start'), dateField('To', state.range.end, 'end'));
    const name = node('label', 'usage-change-name', 'Change name (optional)'), input = node('input'); input.type = 'text'; input.name = 'change'; input.maxLength = 120; input.value = state.title; name.append(input);
    const submit = node('button', '', 'Compare dates'); submit.type = 'submit'; form.append(a, b, name, submit);
    form.addEventListener('submit', event => {
      event.preventDefault(); const fields = new FormData(form), next = model.bounds(fields.get('start'), fields.get('end')), prior = model.bounds(fields.get('compareStart'), fields.get('compareEnd'));
      if (!next || !prior || model.days(next).length > 31 || model.days(next).length !== model.days(prior).length || prior.before > next.after) { showValidation('Choose two non-overlapping periods of the same length, at most 31 days each.'); return; }
      state.syncing = true; window.StudioActivity.setRange(next.start, next.end); state.syncing = false;
      state.range = next; state.compare = prior; state.title = String(fields.get('change') || '').trim(); load(true);
    }); return form;
  }
  function comparison(data) {
    host.append(heading(state.title || 'Compare periods'), comparisonForm());
    if (!data.comparison || data.after !== state.range.after || data.comparison.after !== state.compare.after) { host.append(node('p', 'usage-muted', 'Choose the dates around the change you want to check, then compare.')); return; }
    const before = data.comparison, grid = node('div', 'usage-report-grid'), main = node('section'), side = node('aside', 'usage-side');
    main.append(node('h3', '', 'Recorded cart outcomes'), table(['Metric', 'Before', 'After'], [['Period', model.period(state.compare), model.period(state.range)], ['Cart starts', amount(before.cart.starts), amount(data.cart.starts)], ['Successful handoffs', amount(before.cart.successes), amount(data.cart.successes)], ['Failures', amount(before.cart.failures), amount(data.cart.failures)], ['Uploads accepted', amount(before.totals.localUploads), amount(data.totals.localUploads)], ['AI generations', amount(before.totals.aiGenerations), amount(data.totals.aiGenerations)]]));
    main.append(node('p', 'usage-comparison-note', 'These event counts do not establish a conversion rate or prove that the change caused a difference.'));
    const scope = node('section'); scope.append(node('h3', '', 'Comparison scope'), node('p', '', 'Cart flow only. Traffic mix is not matched. Counts may include repeated attempts.'));
    const outcomes = node('section'); outcomes.append(node('h3', '', 'Other outcomes'), table(['Outcome', 'Coverage'], [['Paid orders', 'Not linked in this report'], ['Production corrections', 'Not recorded in this telemetry']])); side.append(outcomes, scope); grid.append(main, side); host.append(grid);
  }
  function render() {
    if (!state.active) return;
    const scroll = document.getElementById('storage-view').scrollTop; host.replaceChildren(toolbar()); host.setAttribute('aria-busy', String(state.busy)); refresh.disabled = state.busy;
    const validation = node('p', 'usage-validation'); validation.setAttribute('role', 'alert'); validation.tabIndex = -1; host.append(validation);
    if (state.error) { const row = node('div', 'usage-error'); row.setAttribute('role', 'alert'); row.append(node('p', '', state.error), button('Retry report', () => load(state.screen === 'compare'))); host.append(row); }
    if (state.busy) { const pending = node('p', 'usage-loading', 'Loading Studio usage…'); pending.setAttribute('role', 'status'); host.append(pending); }
    if (state.data) {
      if (state.error) host.append(node('p', 'usage-muted', 'The report below is from the previous successful load.'));
      if (state.screen === 'projects') projects(state.data); else if (state.screen === 'failures') failures(state.data); else if (state.screen === 'compare') comparison(state.data); else overview(state.data);
      const info = node('details', 'usage-notes'); info.append(node('summary', '', 'How these counts are measured'), node('p', '', 'Telemetry event counts are estimates of recorded production events marked external. Opens can include reloads. Internal and test events are excluded; unmarked staff activity can remain. Uploads accepted counts local file intake, before any placement confirmation; adding text does not count as an upload. Artwork placements count successful additions to the design. Project and account counts use stored records. Saved pictures and paid orders are separate records.'));
      const updated = new Date(state.data.generatedAt); info.append(node('p', '', 'Report queried ' + updated.toLocaleString() + '. Times use ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '.'));
      if (state.data.latestReceivedAt) info.append(node('p', '', 'Latest event in the period: ' + new Date(state.data.latestReceivedAt).toLocaleString() + '.'));
      host.append(info);
    }
    if (state.focus) { state.focus = false; (host.querySelector('.usage-title') || host).focus({ preventScroll: true }); document.getElementById('storage-view').scrollTop = 0; }
    else document.getElementById('storage-view').scrollTop = scroll;
  }
  async function load(compare = false) {
    const request = ++state.request; state.busy = true; state.error = ''; render();
    const query = { after: state.range.after, before: state.range.before, ...(compare ? { compareAfter: state.compare.after, compareBefore: state.compare.before } : {}) };
    currentLoad?.abort(); currentLoad = new AbortController();
    try {
      if (typeof window.api.getStudioUsage !== 'function') throw new Error('Studio usage is unavailable in this app version.');
      const result = await window.api.getStudioUsage(query, { signal: currentLoad.signal });
      if (request === state.request) state.data = result;
    } catch (error) { if (request === state.request && error.name !== 'AbortError') state.error = error.message || 'Studio usage could not load. Try again.'; }
    finally { if (request === state.request) { state.busy = false; render(); } }
  }
  function init() {
    host = document.getElementById('studio-usage'); if (!host || !model) return; host.tabIndex = -1;
    creations = document.getElementById('studio-creations'); search = document.getElementById('storage-search-toggle'); refresh = document.getElementById('storage-refresh'); tabs = [...document.querySelectorAll('[data-studio-mode]')];
    tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.studioMode)));
    document.addEventListener('studio:range', () => { if (state.active && !state.syncing) { state.range = currentRange(); state.compare = null; if (state.screen === 'compare') state.screen = 'overview'; state.data = null; load(); } });
    window.StudioUsage = { get active() { return state.active; }, refresh: () => load(state.screen === 'compare' && Boolean(state.compare)), enter: () => { state.range = currentRange(); load(state.screen === 'compare' && Boolean(state.compare)); }, leave: () => { state.request++; currentLoad?.abort(); state.busy = false; }, showCreations: () => setMode('creations') };
  }
  document.addEventListener('DOMContentLoaded', init);
})();
