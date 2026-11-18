// Sample Reports are available from the menu; dependencies stay out of normal startup.
(() => {
  const root = document.getElementById('storefront-reports-root');
  if (!root) return;
  const source = new URL(document.currentScript.src);
  const assetBase = new URL('./', source); assetBase.search = source.search;
  let loading = null, workspace = null, style = null, pendingOwner = null;
  window.StorefrontReports = Object.freeze({ selectOwner(id) {
    if (typeof id !== 'string' || !id || id.length > 120) return false;
    pendingOwner = id; if (workspace) { workspace.selectOwner(id); pendingOwner = null; } return true;
  } });
  const nav = document.querySelector('.app-nav-tab[data-view="reports"]');
  const updateSource = () => nav?.toggleAttribute('hidden', document.body.dataset.orderSource !== 'shopify');
  updateSource();
  new MutationObserver(updateSource).observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
  function loadStyle() {
    if (style) return style;
    style = new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet';
      const url = new URL('./storefront-reports.css', assetBase); url.search = source.search; link.href = url.href;
      link.onload = resolve; link.onerror = () => { link.remove(); style = null; reject(new Error('Report styles could not load.')); };
      document.head.append(link);
    });
    return style;
  }
  async function enter() {
    if (workspace) return workspace.onEnter();
    if (!loading) {
      root.textContent = 'Opening Storefront Reports…';
      const url = new URL('./storefront-reports-workspace.mjs', assetBase); url.search = source.search;
      loading = Promise.all([loadStyle(), import(url.href)]).then(async ([, module]) => {
        workspace = await module.mountReports({ root, assetBase });
        if (pendingOwner) { workspace.selectOwner(pendingOwner); pendingOwner = null; }
        if (document.body.dataset.activeView === 'reports') workspace.onEnter();
        else workspace.onLeave();
      }).catch(() => {
        root.replaceChildren(); root.setAttribute('role', 'alert');
        const text = document.createElement('p'); text.textContent = 'Storefront Reports could not open.';
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again';
        retry.addEventListener('click', () => { root.removeAttribute('role'); void enter(); }, { once: true });
        root.append(text, retry);
      }).finally(() => { loading = null; });
    }
    return loading;
  }
  window.OrderManagerNavigation.register('reports', { onEnter: enter, onLeave() { workspace?.onLeave(); } });
})();
