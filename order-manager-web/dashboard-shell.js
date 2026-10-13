/* Compose existing controls; navigation, supplier actions and order state keep
 * their original owners. All additions are scoped to the Shopify workspace. */
(() => {
  function setup() {
    const header = document.querySelector('.app-header');
    const nav = header?.querySelector('.app-nav');
    const tools = header?.querySelector('.order-workspace-tools');
    const label = header?.querySelector('.order-workspace-label');
    if (!nav || !tools || !label) return;
    const candidate = () => document.body.dataset.orderSource === 'shopify';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = matchMedia('(max-width: 900px)');
    let lastPointerAction = 0;
    const motionAllowed = () => candidate() && !reduced.matches && document.body.dataset.dashboardInput === 'pointer' && Date.now() - lastPointerAction < 600;
    const navHome = document.createComment('App navigation home');
    nav.before(navHome); header.insertBefore(label, tools);
    const toolsHome = document.createComment('Workspace controls home');
    tools.before(toolsHome);
    const launcher = document.createElement('button');
    launcher.id = 'dashboard-menu-toggle'; launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Workspace menu');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', 'dashboard-menu');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menu</span>';
    tools.append(launcher);
    const drawer = document.createElement('dialog');
    drawer.id = 'dashboard-menu'; drawer.setAttribute('aria-labelledby', 'dashboard-menu-title');
    drawer.innerHTML = '<div class="dashboard-menu-header"><h2 id="dashboard-menu-title">Print-MO workspace</h2><button type="button" aria-label="Close workspace menu">×</button></div><p class="dashboard-menu-caption">Go to</p>';
    const viewCaption = document.createElement('p');
    viewCaption.className = 'dashboard-menu-caption'; viewCaption.textContent = 'Workspace controls';
    document.body.append(drawer);
    let drawerAnimation, closing = false;
    function finishClose() {
      drawerAnimation?.cancel(); drawerAnimation = null; closing = false;
      drawer.close(); launcher.setAttribute('aria-expanded', 'false');
      if (launcher.getClientRects().length) launcher.focus({ preventScroll: true });
    }
    function close(animate = motionAllowed()) {
      if (!drawer.open) return;
      if (!animate) return finishClose();
      if (closing) return;
      closing = true;
      const transform = getComputedStyle(drawer).transform;
      drawerAnimation?.cancel();
      drawerAnimation = drawer.animate([{ transform }, { transform: 'translateX(100%)' }],
        { duration: 140, easing: 'cubic-bezier(.4, 0, 1, 1)' });
      drawerAnimation.onfinish = finishClose;
    }
    launcher.addEventListener('click', () => {
      if (!candidate()) return;
      if (drawer.open) { close(); return; }
      drawer.showModal(); launcher.setAttribute('aria-expanded', 'true');
      if (motionAllowed()) drawerAnimation = drawer.animate([
        { transform: 'translateX(100%)' }, { transform: 'translateX(0)' }
      ], { duration: 200, easing: 'cubic-bezier(.23, 1, .32, 1)' });
      drawer.querySelector('.app-nav-tab[aria-pressed="true"]')?.focus({ preventScroll: true });
    });
    drawer.querySelector('.dashboard-menu-header button').addEventListener('click', () => close());
    drawer.addEventListener('cancel', event => { event.preventDefault(); close(false); });
    drawer.addEventListener('click', event => {
      if (event.target.closest('.app-nav-tab, [data-order-layout]')) close(false);
      if (event.target === drawer) {
        const bounds = drawer.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }
    });
    drawer.addEventListener('close', () => launcher.setAttribute('aria-expanded', 'false'));

    // Keep headings independent of control widths; workspace navigation owns destinations.
    const headings = [...document.querySelectorAll('.container > .panel > .panel-header')].map(panelHeader => {
      const identity = document.createElement('div'); identity.className = 'dashboard-section-identity';
      const nodes = [...panelHeader.querySelectorAll(':scope > .panel-title, :scope > #pipeline-count')];
      const homes = nodes.map(node => { const home = document.createComment('Section identity home'); node.before(home); return home; });
      panelHeader.prepend(identity); panelHeader.classList.add('dashboard-section-header');
      return { identity, nodes, homes };
    });
    const titles = [...document.querySelectorAll('.panel-title-desktop, .supplies-title')].map(node => [node, node.textContent]);
    const names = ['Order Pipeline', 'Supplies', 'Production & Fulfillment'];
    const actions = document.querySelector('#blanks-section .section-actions');
    const actionsHome = document.createComment('Supplies actions home');
    actions?.before(actionsHome);
    const suppliesHeader = document.querySelector('.supplies-panel-header');
    function sync() {
      const active = candidate();
      if (!active) close(false);
      const navParent = active ? drawer : navHome.parentNode;
      if (nav.parentNode !== navParent) active ? drawer.append(nav) : navHome.after(nav);
      if (active) {
        if (viewCaption.parentNode !== drawer) drawer.append(viewCaption);
        if (tools.parentNode !== drawer) drawer.append(tools);
        // Reuse an existing header rather than adding another toolbar. On phones
        // Menu takes the former Sync slot; the original refresh lives in the drawer.
        const view = document.body.dataset.activeView || 'orders';
        const target = mobile.matches ? document.getElementById('mobile-tab-bar')
          : view === 'orders' ? document.querySelector(document.body.dataset.orderLayout === 'list'
            ? '.order-list-heading' : '.production-panel-header')
          : document.querySelector({ inventory: '.shelf-inventory-header', previous: '.previous-orders-header',
            storage: '.storage-header', drafts: '.draft-workspace-heading' }[view] || '.production-panel-header');
        if (target && launcher.parentNode !== target) {
          const restoreFocus = document.activeElement === launcher;
          launcher.parentElement?.classList.remove('dashboard-menu-host');
          target.append(launcher); target.classList.add('dashboard-menu-host');
          if (restoreFocus) launcher.focus({ preventScroll: true });
        }
        // Preserve the deliberate debug escape hatch without restoring a row.
        const debug = document.querySelector('.legacy-debug-source-switch');
        if (debug && debug.parentNode !== drawer) drawer.append(debug);
      } else {
        viewCaption.remove();
        if (toolsHome.nextSibling !== tools) toolsHome.after(tools);
        launcher.parentElement?.classList.remove('dashboard-menu-host');
        tools.append(launcher);
        const debug = drawer.querySelector('.legacy-debug-source-switch');
        if (debug) header.append(debug);
      }
      const selected = nav.querySelector(`.app-nav-tab[data-view="${document.body.dataset.activeView || 'orders'}"]`);
      label.textContent = selected?.textContent || 'Orders';
      for (const button of nav.querySelectorAll('.app-nav-tab')) {
        if (button === selected) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
      headings.forEach(({ identity, nodes, homes }) => nodes.forEach((node, index) => {
        if (active && node.parentNode !== identity) identity.append(node);
        if (!active && homes[index].nextSibling !== node) homes[index].after(node);
      }));
      titles.forEach(([node, original], index) => {
        const copy = active ? names[index] : original;
        if (node.textContent !== copy) node.textContent = copy;
      });
      if (actions) {
        const inHeader = active && !mobile.matches && suppliesHeader;
        if (inHeader && actions.parentNode !== suppliesHeader) suppliesHeader.append(actions);
        if (!inHeader && actionsHome.nextSibling !== actions) actionsHome.after(actions);
        actions.hidden = Boolean(inHeader && document.querySelector('.panel.create')?.dataset.suppliesView === 'build');
      }
    }
    new MutationObserver(sync).observe(document.body, { attributes: true,
      attributeFilter: ['data-order-source', 'data-active-view', 'data-order-layout', 'data-pipeline-view'] });
    const supplies = document.querySelector('.panel.create');
    if (supplies) new MutationObserver(sync).observe(supplies, { attributes: true, attributeFilter: ['data-supplies-view'] });
    mobile.addEventListener('change', sync);
    reduced.addEventListener('change', () => { if (closing) finishClose(); else drawerAnimation?.cancel(); });
    sync();

    const groups = [...document.querySelectorAll('#supplies-tabs, .print-view-tabs, .blanks-segmented, #order-layout-controls, #order-list-stages, #mobile-tab-bar')];
    const refreshIndicators = [];
    for (const group of groups) {
      group.classList.add('dashboard-connected-tabs');
      const indicator = document.createElement('span');
      indicator.className = 'dashboard-tab-indicator'; indicator.setAttribute('aria-hidden', 'true'); group.append(indicator);
      let previous, target = '', frame, pendingMotion = false;
      function update(animate = false) {
        const button = group.querySelector('button[aria-selected="true"], button[aria-pressed="true"]');
        if (!candidate() || !button?.getClientRects().length) { indicator.hidden = true; previous = null; return; }
        indicator.hidden = false;
        const bounds = button.getBoundingClientRect(), parent = group.getBoundingClientRect();
        const next = `translateX(${bounds.left - parent.left + group.scrollLeft - group.clientLeft}px) scaleX(${bounds.width})`;
        if (next !== target) {
          indicator.style.transition = animate && previous && previous !== button && motionAllowed()
            ? 'transform 180ms cubic-bezier(.4, 0, .2, 1)' : 'none';
          indicator.style.transform = next; target = next;
        }
        previous = button;
      }
      function schedule(animate) {
        pendingMotion ||= animate;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { update(pendingMotion); pendingMotion = false; });
      }
      new MutationObserver(() => schedule(true)).observe(group, { subtree: true, childList: true,
        attributes: true, attributeFilter: ['aria-selected', 'aria-pressed'] });
      const resize = new ResizeObserver(() => schedule(false)); resize.observe(group);
      for (const button of group.querySelectorAll('button')) resize.observe(button);
      refreshIndicators.push(() => schedule(false)); update();
    }
    new MutationObserver(() => refreshIndicators.forEach(update => update())).observe(document.body,
      { attributes: true, attributeFilter: ['data-order-source', 'data-order-layout', 'data-active-view', 'data-active-tab', 'data-pipeline-view'] });
    reduced.addEventListener('change', () => refreshIndicators.forEach(update => update()));

    // Motion follows explicit navigation, never polling, financial hydration or
    // canonical save completion. New content remains interactive throughout.
    const contentAnimations = new Map();
    const disclosureActions = new WeakMap();
    function reveal(node) {
      if (!node?.getClientRects().length || !motionAllowed()) return;
      contentAnimations.get(node)?.cancel();
      const animation = node.animate([{ opacity: .72, transform: 'translateY(2px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 120, easing: 'cubic-bezier(.23, 1, .32, 1)' });
      contentAnimations.set(node, animation);
      animation.onfinish = () => contentAnimations.delete(node);
    }
    function connectLayout(nodes) {
      if (!motionAllowed()) return;
      const positions = nodes.filter(node => node.getClientRects().length).map(node => [node, node.getBoundingClientRect().top]);
      requestAnimationFrame(() => {
        if (!motionAllowed()) return;
        for (const [node, top] of positions) {
          if (!node.getClientRects().length) continue;
          const delta = top - node.getBoundingClientRect().top;
          if (Math.abs(delta) < 1) continue;
          contentAnimations.get(node)?.cancel();
          const animation = node.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
            { duration: 150, easing: 'cubic-bezier(.23, 1, .32, 1)' });
          contentAnimations.set(node, animation);
          animation.onfinish = () => contentAnimations.delete(node);
        }
      });
    }
    document.addEventListener('click', event => {
      if (!candidate() || !event.detail) return;
      lastPointerAction = Date.now();
      const disclosure = event.target.closest('summary')?.parentElement;
      if (disclosure?.matches('details')) disclosureActions.set(disclosure, lastPointerAction);
      if (event.target.closest('#garment-cart-cost summary')) connectLayout([document.getElementById('col-blanks')].filter(Boolean));
      const button = event.target.closest('button');
      if (!button) return;
      if (button.matches('#order-list-filters-toggle')) connectLayout([document.getElementById('order-list-scroll')]);
      if (button.matches('.order-list-expand')) connectLayout([...document.querySelectorAll('.order-list-table tbody tr')].filter(node => {
        const bounds = node.getBoundingClientRect(); return bounds.bottom > 0 && bounds.top < innerHeight;
      }));
      const wasSelected = button.matches('[aria-selected="true"], [aria-pressed="true"]');
      const wasExpanded = button.getAttribute('aria-expanded');
      requestAnimationFrame(() => {
        if (!wasSelected && button.matches('[data-order-layout]')) reveal(document.querySelector(document.body.dataset.orderLayout === 'list' ? '#order-list-foundation' : '#orders-view > .container'));
        else if (!wasSelected && button.matches('[data-pipeline-view]')) reveal(document.querySelector(document.body.dataset.pipelineView === 'drafts' ? '#draft-orders-workspace' : document.body.dataset.orderLayout === 'list' ? '#order-list-foundation' : '#col-received'));
        else if (!wasSelected && button.matches('.supplies-tab')) reveal(document.querySelector(supplies?.dataset.suppliesView === 'build' ? '.create-body' : '#blanks-section'));
        else if (!wasSelected && button.matches('.print-view-tab')) reveal(document.getElementById('col-print'));
        else if (!wasSelected && button.matches('[data-list-stage]')) reveal(document.querySelector('.order-list-scroll'));
        else if (button.matches('.order-list-expand, #order-list-filters-toggle') && wasExpanded === 'false' && button.getAttribute('aria-expanded') === 'true') reveal(document.getElementById(button.getAttribute('aria-controls')));
      });
    }, true);
    document.addEventListener('toggle', event => {
      if (event.target.matches('details') && event.target.open && Date.now() - (disclosureActions.get(event.target) || 0) < 600 && event.target.closest('#garment-cart-cost, #order-list-foundation')) reveal(event.target.querySelector(':scope > :not(summary)'));
    }, true);
    const cancelContent = () => { contentAnimations.forEach(animation => animation.cancel()); contentAnimations.clear(); };
    reduced.addEventListener('change', cancelContent);
    document.addEventListener('keydown', () => {
      cancelContent();
      document.querySelectorAll('.dashboard-tab-indicator').forEach(indicator => { indicator.style.transition = 'none'; });
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
