/** Bounded workers settle before failure so no uploads outlive the publication lease. */
export async function mapConcurrent(values, limit, task) {
  const results = new Array(values.length);
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!failure && next < values.length) {
      const index = next++;
      try { results[index] = await task(values[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

/** Optional staff-only stream; ordinary JSON callers retain their existing contract. */
export function preparedPublishStream(operation, headers, context) {
  let connected = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = value => {
        if (!connected) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); }
        catch { connected = false; }
      };
      const work = Promise.resolve().then(() => operation(progress => send({ type: 'progress', ...progress })))
        .then(result => send({ type: 'result', ...result }))
        .catch(error => send({ type: 'error', error: {
          code: error.code && error.status ? error.code : 'PUBLISH_UNAVAILABLE',
          message: error.code && error.status ? error.message : 'The customer link could not be published. Your changes are saved; retry.',
          status: error.status || 503,
        } }))
        .finally(() => { if (connected) { connected = false; controller.close(); } });
      context?.waitUntil(work);
    },
    cancel() { connected = false; },
  });
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
