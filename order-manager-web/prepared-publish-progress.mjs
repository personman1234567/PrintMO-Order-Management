export function preparedPublishMessage(progress) {
  if (progress.stage === 'checking') return 'Checking the existing customer link…';
  if (progress.stage === 'products') return 'Checking products and prices…';
  if (progress.stage === 'publishing') return 'Publishing the customer link…';
  if (progress.stage === 'assets') {
    if (!progress.total) return 'Preparing order details…';
    if (progress.completed === progress.total) return progress.reused ? `Artwork ready · ${progress.reused} unchanged file${progress.reused === 1 ? '' : 's'} reused` : 'Artwork and mockups ready…';
    return `Preparing artwork and mockups · ${progress.completed} of ${progress.total} ready`;
  }
  return null;
}

/** NDJSON can split anywhere, including inside a UTF-8 character or final result. */
export async function consumePreparedPublishResponse(response, onProgress) {
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) return response.json();
  if (!response.body) throw new Error('The publishing response was interrupted. Retry to check your saved link.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result;
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'progress') onProgress(event);
    if (event.type === 'result') result = event;
    if (event.type === 'error') throw Object.assign(new Error(event.error.message), { code: event.error.code, status: event.error.status });
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) consume(line);
      if (buffer.length > 65536) throw new Error('The publishing response could not be read. Retry to check your saved link.');
      if (done) break;
    }
    consume(buffer);
    if (!result?.link) throw new Error('Publishing was interrupted. Retry to check your saved link before sending it.');
    return result;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
