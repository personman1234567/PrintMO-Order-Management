/* One lazy, reusable renderer per open workspace. No credentials cross this boundary. */
export function createPreparedPreviewRenderer({ window, document, timeoutMs = 12000 }) {
  let child = null, ready = false, active = null;
  const origin = window.location.origin;
  function initialize() {
    if (ready && active) child.contentWindow.postMessage({ type: 'pm-placement:init', context: active.context }, origin);
  }
  function finish(value, error) {
    if (!active) return;
    const current = active; active = null; clearTimeout(current.timer);
    child?.contentWindow.postMessage({ type: 'pm-placement:reset', session: current.context.session }, origin);
    error ? current.reject(error) : current.resolve(value);
  }
  function receive(event) {
    if (!child || event.origin !== origin || event.source !== child.contentWindow) return;
    const data = event.data;
    if (data?.type === 'pm-placement:ready') { ready = true; initialize(); return; }
    if (!active || data?.session !== active.context.session) return;
    if (data.type === 'pm-placement:preview-error') { finish(null, new Error(data.message || 'The preview could not render.')); return; }
    if (data.type !== 'pm-placement:request' || data.action !== 'preview' || !/^[a-f0-9-]{36}$/i.test(data.requestId || '')) return;
    // Complete the editor's request before unmounting its canvas; do not leave a 120s request pending.
    child.contentWindow.postMessage({ type: 'pm-placement:response', session: data.session, requestId: data.requestId, value: {} }, origin);
    finish(data.payload);
  }
  return {
    render(context) {
      if (active) return Promise.reject(new Error('A garment preview is already rendering.'));
      if (!child) {
        child = document.createElement('iframe'); child.title = 'Updating garment preview'; child.className = 'prepared-preview-renderer'; child.tabIndex = -1; child.setAttribute('aria-hidden', 'true');
        window.addEventListener('message', receive); child.src = './placement-editor/index.html'; document.body.append(child);
      }
      return new Promise((resolve, reject) => {
        active = { context: { ...context, previewOnly: true }, resolve, reject,
          timer: setTimeout(() => finish(null, new Error('The preview could not finish. Your artwork is saved; retry the preview or open Edit artwork.')), timeoutMs) };
        initialize();
      });
    },
    cancel() { finish(null, new Error('Preview cancelled.')); },
    destroy() {
      finish(null, new Error('Preview cancelled.'));
      window.removeEventListener('message', receive); child?.remove(); child = null; ready = false;
    },
  };
}
