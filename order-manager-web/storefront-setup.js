/* Storefront setup stays lazy and separate from order state. */
(() => {
  const root = document.getElementById('storefront-setup-root');
  if (!root) return;
  const base = new URL('./', document.currentScript.src);
  base.search = new URL(document.currentScript.src).search;
  let workspace, loading, style;
  const nav = document.querySelector('.app-nav-tab[data-view="storefronts"]');
  const updateSource = () => nav?.toggleAttribute('hidden', document.body.dataset.orderSource !== 'shopify');
  updateSource();
  new MutationObserver(updateSource).observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
  const asset = path => { const url = new URL(path, base); url.search = base.search; return url.href; };
  function styles() {
    if (style) return style;
    style = new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = asset('storefront-setup.css');
      link.onload = resolve; link.onerror = () => { link.remove(); style = null; reject(new Error('Styles unavailable')); };
      document.head.append(link);
    });
    return style;
  }
  async function enter() {
    if (document.body.dataset.orderSource !== 'shopify') return;
    if (workspace) return workspace.onEnter();
    if (!loading) {
      root.textContent = 'Opening Storefronts…';
      loading = Promise.all([styles(), import(asset('storefront-management-workspace.mjs'))]).then(async ([, module]) => {
        workspace = await module.mountStorefrontSetup({ root });
        if (document.body.dataset.activeView === 'storefronts') return workspace.onEnter();
        workspace.onLeave();
      }).catch(() => {
        root.replaceChildren();
        const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.textContent = 'Storefronts could not open.';
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again'; retry.onclick = enter;
        root.append(error, retry);
      }).finally(() => { loading = null; });
    }
    return loading;
  }
  window.OrderManagerNavigation.register('storefronts', { onEnter: enter, onLeave() { workspace?.onLeave(); }, canLeave(context) { return workspace?.canLeave(context) ?? true; } });
})();

