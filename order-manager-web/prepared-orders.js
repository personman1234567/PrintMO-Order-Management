// Keep preparation UI and the canvas out of the normal board's startup work.
(() => {
  const root = document.getElementById('prepared-orders-root');
  if (!root) return;
  const source = new URL(document.currentScript.src);
  const moduleUrl = new URL('./prepared-orders-workspace.js', source);
  moduleUrl.search = source.search;
  let loading = null;
  const load = () => {
    if (loading) return loading;
    root.textContent = 'Opening prepared orders…';
    loading = import(moduleUrl.href).catch(error => {
      loading = null;
      root.textContent = 'Prepared Orders could not load. Refresh the app and try again.';
      root.setAttribute('role', 'alert');
      console.warn('Prepared Orders module unavailable', error);
    });
    return loading;
  };
  window.OrderManagerNavigation.register('prepared', { onEnter: load });
  const sourceState = () => document.querySelector('.app-nav-tab[data-view="prepared"]')?.toggleAttribute('hidden', document.body.dataset.orderSource !== 'shopify');
  sourceState();
  new MutationObserver(sourceState).observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
})();
