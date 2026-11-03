// Order placement and line attribution are separate facts. Nothing here reads a cart.
export const isSupplierService = item => [item?.sku, item?.supplierSku].some(value => String(value || '').trim() === 'PM-ART-BG-REMOVE');

export function consolidateSupplierEvidence({ requestedLines = [], lineSources = [], acceptedLines = [], rejectedLines = [], outcome, operation = 'order_placement', summaryConfirmed = false, preflightFailed = false, invalidLineEvidence = false }) {
  const issues = rejectedLines.filter(line => !line.sku).map(line => ({ code: line.code || null, reason: line.reason }));
  const requested = new Map(requestedLines.map(line => [line.sku, Number(line.qty)]));
  const unmatchedAcceptedLines = acceptedLines.filter(line => !requested.has(line.sku));
  if (unmatchedAcceptedLines.length) issues.push({ code: 'SUPPLIER_IDENTIFIER_UNMATCHED',
    reason: 'S&S returned item identifiers that do not match the submitted SKUs. The returned order reference is preserved; item attribution needs review.' });
  if (invalidLineEvidence) issues.push({ code: 'SUPPLIER_LINE_DETAIL_INCOMPLETE', reason: 'Some supplier line quantities were not returned in a usable form.' });
  const lineResults = requestedLines.map(line => {
    const accepted = acceptedLines.find(value => value.sku === line.sku);
    const errors = rejectedLines.filter(value => value.sku === line.sku);
    const rawQty = accepted && accepted.acceptedQty !== null && accepted.acceptedQty !== undefined && accepted.acceptedQty !== ''
      ? Number(accepted.acceptedQty) : null;
    const validQty = accepted && Number.isSafeInteger(rawQty) && rawQty >= 0 && rawQty <= line.qty;
    if (accepted && !validQty) issues.push({ code: 'SUPPLIER_QUANTITY_MISMATCH', sku: line.sku,
      reason: 'The returned quantity differs from the requested item quantity. Check this line against the S&S order.' });
    const reportedAcceptedQty = validQty && !summaryConfirmed ? rawQty : null;
    const explicitNotAccepted = !preflightFailed && !accepted && errors.length > 0;
    const unconfirmedQty = preflightFailed ? 0 : reportedAcceptedQty !== null ? Math.max(0, line.qty - reportedAcceptedQty) : explicitNotAccepted ? 0 : summaryConfirmed && validQty ? null : line.qty;
    const notAcceptedQty = explicitNotAccepted ? line.qty : null;
    const fullyCovered = !preflightFailed && ['confirmed', 'partial'].includes(outcome)
      && validQty && rawQty >= line.qty && !errors.length;
    return {
      sku: line.sku, requestedQty: line.qty, reportedAcceptedQty, unconfirmedQty, notAcceptedQty,
      itemNames: [...new Set(lineSources.filter(source => source.sku === line.sku).map(source => [source.title, source.variantTitle].filter(Boolean).join(' - ')))],
      orderNames: [...new Set(lineSources.filter(source => source.sku === line.sku).map(source => source.orderName))],
      evidence: summaryConfirmed && validQty ? 'summary_confirmed' : reportedAcceptedQty !== null ? 'supplier_reported' : 'unconfirmed',
      status: preflightFailed ? 'not_sent' : fullyCovered ? 'accepted' : explicitNotAccepted ? 'not_accepted' : reportedAcceptedQty > 0 ? 'partial' : 'unconfirmed',
      fullyCovered, issues: errors.map(error => ({ code: error.code || null, reason: error.reason }))
    };
  });
  const hasReported = lineResults.some(line => line.reportedAcceptedQty !== null);
  const quantitative = !summaryConfirmed && !preflightFailed;
  const detailOutcome = invalidLineEvidence || unmatchedAcceptedLines.length || issues.some(issue => issue.code === 'SUPPLIER_QUANTITY_MISMATCH')
    || summaryConfirmed ? 'unresolved' : lineResults.every(line => line.fullyCovered || line.notAcceptedQty !== null) ? 'complete' : 'partial';
  return {
    outcome, placementOutcome: outcome, detailOutcome, operation, operationEvidence: 'request',
    acceptanceEvidence: summaryConfirmed ? 'summary_confirmed' : hasReported ? 'supplier_reported' : 'unconfirmed',
    lineResults, unmatchedAcceptedLines, issues,
    totals: {
      requestedUnits: requestedLines.reduce((sum, line) => sum + line.qty, 0),
      reportedAcceptedUnits: quantitative ? lineResults.reduce((sum, line) => sum + (line.reportedAcceptedQty || 0), 0) : null,
      unconfirmedUnits: quantitative ? lineResults.reduce((sum, line) => sum + (line.unconfirmedQty || 0), 0) : null,
      notAcceptedUnits: quantitative ? lineResults.reduce((sum, line) => sum + (line.notAcceptedQty || 0), 0) : null
    }
  };
}

// Cross-key protection is limited to in-flight or genuinely ambiguous POSTs.
// Known supplier order references with item-attribution warnings are completed
// placement evidence, not a lifetime ban on deliberately creating a new order.
const retryRisk = `b.id <> ? AND b.shop_id = ?
  AND COALESCE(json_extract(b.request_json, '$.provider'), 'shopify') = ?
  AND (b.state = 'submitting' OR (b.state IN ('unknown','failed')
    AND COALESCE(json_extract(b.response_json, '$.preflightFailed'), 0) <> 1 AND (
    (b.state = 'unknown' AND COALESCE(json_array_length(json_extract(b.response_json, '$.supplierOrderNumbers')), 0) = 0
      AND COALESCE(json_extract(b.response_json, '$.supplierOrderNumber'), '') = '')
    OR json_extract(b.response_json, '$.postResultUncertain') = 1
    OR CAST(json_extract(b.response_json, '$.httpStatus') AS INTEGER) IN (408,425,429)
    OR CAST(json_extract(b.response_json, '$.httpStatus') AS INTEGER) >= 500)
    AND NOT EXISTS (SELECT 1 FROM supplier_attempts resolution
      WHERE resolution.batch_id = b.id AND resolution.attempt_type = 'owner_retry_resolution'
        AND resolution.outcome = 'owner_authorized_retry'
        AND json_extract(resolution.response_json, '$.originalLineHash') = b.line_hash
        AND json_extract(resolution.response_json, '$.originalUpdatedAt') = b.updated_at
        AND json_extract(resolution.response_json, '$.originalResponseJson') = b.response_json)))
  AND EXISTS (SELECT 1 FROM json_each(b.request_json, '$.lineSources') old_line, json_each(?) current_line
    WHERE json_extract(old_line.value, '$.orderId') = json_extract(current_line.value, '$.orderId')
      AND json_extract(old_line.value, '$.sku') = json_extract(current_line.value, '$.sku'))
  AND NOT COALESCE((b.state = 'failed' AND COALESCE(json_extract(b.response_json, '$.failureKind'), '') = 'rate_limited'
    AND json_extract(b.response_json, '$.orderSubmissionAttempted') = 1
    AND json_extract(b.response_json, '$.upstreamHttpStatus') = 503
    AND json_extract(b.response_json, '$.supplierErrorCode') = '503'
    AND json_extract(b.response_json, '$.retryAt') IS NOT NULL
    AND json_extract(b.response_json, '$.retryAt') <= ?), 0)`;

export async function claimSupplierAttempt(db, { shopId, provider, lineSources, batchId, now }) {
  const parameters = [batchId, shopId, provider, JSON.stringify(lineSources), now];
  const claimed = await db.prepare(`UPDATE batches SET state = 'submitting', updated_at = ?
    WHERE id = ? AND shop_id = ? AND state = 'prepared'
      AND NOT EXISTS (SELECT 1 FROM batches b WHERE ${retryRisk})`)
    .bind(now, batchId, shopId, ...parameters).run();
  if (claimed.meta?.changes === 1) return;
  const previous = await db.prepare(`SELECT b.id, b.state, b.created_at, b.response_json FROM batches b WHERE ${retryRisk}
    ORDER BY b.created_at DESC LIMIT 1`).bind(...parameters).first();
  if (previous) {
    await db.prepare(`DELETE FROM batch_orders WHERE batch_id = ? AND EXISTS (
      SELECT 1 FROM batches WHERE id = ? AND shop_id = ? AND state = 'prepared')`)
      .bind(batchId, batchId, shopId).run();
    let saved = {}; try { saved = JSON.parse(previous.response_json || '{}'); } catch { /* Keep unresolved evidence. */ }
    const rateLimited = saved.failureKind === 'rate_limited' && saved.retryAt;
    const summary = rateLimited
      ? `S&S asked you to wait before trying again. This selection was not sent. Retry after ${saved.retryAt}.`
      : previous.state === 'submitting'
      ? 'An earlier request for these garments is still running. No new S&S request was sent.'
      : 'An earlier request has no confirmed S&S order result. This selection was not sent.';
    const orderIds = [...new Set(lineSources.map(line => line.orderId))];
    throw Object.assign(new Error(summary), { code: 'BATCH_REVIEW_REQUIRED', status: 409, batchId,
      body: { report: { batchId, blockedBatchId: batchId, outcome: 'unknown', operation: 'order_placement',
        submissionAction: 'blocked', supplierRequestSent: false, actionMessage: summary,
        failureKind: rateLimited ? 'rate_limited' : null, retryAt: rateLimited ? saved.retryAt : null,
        orderCount: orderIds.length, totals: { requestedUnits: lineSources.reduce((sum, line) => sum + line.qty, 0) },
        orderResults: orderIds.map(orderId => ({ orderId })), lineResults: [],
        previousResults: [{ ...saved, batchId: previous.id, attemptStartedAt: saved.attemptStartedAt || previous.created_at,
          submissionAction: 'saved', supplierRequestSent: false }] } } });
  }
  throw Object.assign(new Error('This attempt is already running. Review its saved result.'), { code: 'BATCH_RECONCILIATION_REQUIRED', status: 409, batchId,
    body: { report: { batchId, submissionAction: 'blocked', supplierRequestSent: false,
      actionMessage: 'This attempt is already running. No new S&S request was sent by this action.' } } });
}
