/* Touch-first presenter. Commands and permissions remain owned by OrderActions. */
(() => {
  let dialog, header, body, feedback, controller = null, page = '', suspended = false;
  const media = matchMedia('(max-width: 900px)');
  const el = (tag, text, name) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (name) node.className = name; return node; };
  const paths = {
    stage: 'M3 10h10M8 6v4M2 10v4h4v-4M10 10v4h4v-4M6 2h4v4H6z',
    blanks: 'm1 4 7-3 7 3v8l-7 3-7-3zM1 4l7 3 7-3M8 7v8',
    prints: 'M4 1h6l3 3v11H3V1zM10 1v4h3M6 8h4M6 11h4',
    date: 'M2 3h12v12H2zM5 1v4M11 1v4M2 7h12',
    notes: 'M2 2h12v10H7l-4 3v-3H2zM5 5h6M5 8h4',
    copy: 'M5 1h9v10M2 4h9v11H2z', count: 'M6 1 4 15M12 1l-2 14M2 6h12M1 10h12',
    remove: 'M2 3h12v3H2zM3 6v8h10V6M6 9h4',
    close: 'm3 3 10 10M13 3 3 13', back: 'm9 3-5 5 5 5'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.stage); svg.append(path); return svg;
  }
  function control(label, name, run) {
    const button = el('button', null, 'moa-control'); button.type = 'button'; button.dataset.moaId = 'control-' + name; button.setAttribute('aria-label', label); button.append(icon(name)); button.addEventListener('click', run); return button;
  }
  function requestClose() { if (controller) controller.onClose(); }
  function viewport() {
    if (!controller) return;
    if (!media.matches) { requestClose(); return; }
    const view = window.visualViewport, height = view?.height || innerHeight;
    dialog.style.setProperty('--moa-height', Math.max(1, Math.min(600, height * .84)) + 'px');
    dialog.style.setProperty('--moa-bottom', Math.max(0, innerHeight - (view?.offsetTop || 0) - height) + 'px');
    dialog.style.setProperty('--moa-left', (view?.offsetLeft || 0) + 'px');
    dialog.style.setProperty('--moa-width', (view?.width || document.documentElement.clientWidth) + 'px');
  }
  function setup() {
    if (dialog) return;
    dialog = el('dialog', null, 'mobile-order-actions'); dialog.id = 'mobile-order-actions';
    dialog.setAttribute('aria-labelledby', 'moa-title'); dialog.setAttribute('aria-describedby', 'moa-identity');
    header = el('header', null, 'moa-header');
    feedback = el('p', '', 'moa-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.hidden = true;
    body = el('div', null, 'moa-body'); dialog.append(header, feedback, body); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (page) showPage(''); else requestClose(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
    });
    dialog.addEventListener('close', () => { if (!suspended && !dialog.open) requestClose(); });
    window.addEventListener('resize', viewport, { passive: true });
    window.visualViewport?.addEventListener('resize', viewport, { passive: true });
    window.visualViewport?.addEventListener('scroll', viewport, { passive: true });
  }
  function render({ focus = false, resetScroll = false } = {}) {
    if (!controller) return;
    const state = controller.getPage(page);
    if (!state) { requestClose(); return; }
    const savedScroll = resetScroll ? 0 : body.scrollTop, active = document.activeElement?.dataset.moaId;
    header.replaceChildren();
    if (page) header.append(control('Back to order actions', 'back', () => showPage('')));
    const identity = el('div', null, 'moa-header-copy');
    if (!page) identity.append(el('p', 'Order actions', 'moa-caption'));
    const title = el('h2', page ? state.title : state.customer); title.id = 'moa-title';
    const subtitle = el('p', page ? state.customer + ' · ' + state.number : state.number + ' · ' + state.source, 'moa-identity'); subtitle.id = 'moa-identity';
    identity.append(title, subtitle); header.append(identity, control('Close order actions', 'close', requestClose));
    body.replaceChildren();
    for (const group of state.groups) {
      const section = el('section', null, 'moa-group');
      if (group.title) section.append(el('h3', group.title));
      for (const item of group.items) {
        const button = el('button', null, 'moa-row' + (item.danger ? ' is-danger' : '')); button.type = 'button'; button.dataset.moaId = item.id;
        button.disabled = Boolean(state.busy || !item.enabled); button.append(icon(item.icon));
        const copy = el('span', null, 'moa-row-copy'); copy.append(el('span', item.label, 'moa-label'));
        if (item.value) copy.append(el('span', item.value, 'moa-value'));
        if (item.reason) copy.append(el('small', item.reason, 'moa-reason'));
        button.append(copy);
        if (item.checked != null) {
          button.setAttribute('aria-pressed', String(item.checked));
          if (item.checked) { button.classList.add('is-current'); const check = icon('stage'); check.replaceChildren(); const path = document.createElementNS(check.namespaceURI, 'path'); path.setAttribute('d', 'm3 8 3 3 7-7'); check.append(path); button.append(check); }
        } else if (item.branch) { const arrow = icon('back'); arrow.classList.add('moa-chevron'); button.append(arrow); }
        button.addEventListener('click', () => { if (!button.disabled) item.run(); }); section.append(button);
      }
      body.append(section);
    }
    body.setAttribute('aria-busy', String(Boolean(state.busy))); body.scrollTop = savedScroll;
    if (focus) (body.querySelector('[aria-pressed="true"]:not(:disabled)') || body.querySelector('button:not(:disabled)') || header.querySelector('button'))?.focus({ preventScroll: true });
    else if (active) [...dialog.querySelectorAll('button')].find(node => node.dataset.moaId === active && !node.disabled)?.focus({ preventScroll: true });
  }
  function showPage(next = '') { page = next; render({ focus: true, resetScroll: true }); }
  function close(restore = true) {
    if (!controller) return;
    const opener = controller.opener; controller = null; suspended = false;
    if (dialog.open) dialog.close();
    opener?.setAttribute('aria-expanded', 'false');
    if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
  }
  window.MobileOrderActions = Object.freeze({
    open(next, initialPage = '') {
      setup(); close(false); controller = next; page = initialPage; suspended = false;
      feedback.hidden = true; feedback.textContent = ''; viewport(); render({ resetScroll: true });
      if (!controller) return;
      dialog.showModal(); next.opener?.setAttribute('aria-expanded', 'true'); render({ focus: true });
    },
    close, showPage, refresh: () => render(), isOpen: () => Boolean(controller),
    feedback(message, error = false) { if (!controller) return; feedback.textContent = message; feedback.hidden = !message; feedback.classList.toggle('is-error', error); },
    suspend() { if (controller && dialog.open) { suspended = true; dialog.close(); } },
    resume() { if (controller && suspended) { suspended = false; viewport(); if (controller) { dialog.showModal(); showPage(''); } } }
  });
})();
