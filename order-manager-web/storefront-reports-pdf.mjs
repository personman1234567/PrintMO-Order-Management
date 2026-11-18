/** The renderer is deliberately lazy: importing this module starts no work. */
export function renderReport(snapshot, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Report generation cancelled.', 'AbortError'));
  if (typeof Worker !== 'function') return Promise.reject(new Error('PDF generation requires browser worker support. Try a supported browser.'));
  return new Promise((resolve, reject) => {
    const workerUrl = new URL('./storefront-reports-pdf-worker.js', import.meta.url);
    workerUrl.search = new URL(import.meta.url).search;
    let worker, settled = false, timer;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error); else resolve(bytes);
    };
    const abort = () => finish(new DOMException('Report generation cancelled.', 'AbortError'));
    try {
      worker = new Worker(workerUrl, { name: 'storefront-report-pdf' });
      worker.onmessage = ({ data }) => {
        if (data?.error) return finish(new Error(data.error));
        if (!(data?.bytes instanceof Uint8Array) || data.bytes.length < 5) return finish(new Error('The PDF renderer returned an invalid document. Generate the report again.'));
        finish(null, data.bytes);
      };
      worker.onerror = event => { event.preventDefault(); finish(new Error('The PDF renderer could not start. Refresh the app and generate again.')); };
      worker.onmessageerror = () => finish(new Error('The PDF renderer response could not be read. Generate the report again.'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      timer = setTimeout(() => finish(new Error('PDF preparation took too long. Try a shorter reporting period.')), 60000);
      worker.postMessage({ snapshot });
    } catch (error) { finish(error); }
  });
}
