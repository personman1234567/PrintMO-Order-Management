/* Supplier order responses and local line matching are separate facts. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SupplierResultModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const list = value => Array.isArray(value) ? value : [];
  const quantity = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const identity = order => JSON.stringify([order.provider || order._provider || '', String(order.orderKey || order._orderKey || order._gid || order.orderId || '')]);
  const words = values => [...new Set(list(values).filter(Boolean))];
  function legacyLines(source) {
    const rows = new Map();
    for (const [kind, lines] of [['accepted', list(source.acceptedLines)], ['issue', list(source.rejectedLines)]]) for (const line of lines) {
      const key = line.sku || '__batch__';
      if (!rows.has(key)) rows.set(key, { sku: line.sku || null, itemNames: [], orderNames: [], requestedQty: quantity(line.requestedQty), reportedAcceptedQty: null, issues: [], observations: 0 });
      const row = rows.get(key);
      row.itemNames = words([...row.itemNames, ...list(line.itemNames)]);
      row.orderNames = words([...row.orderNames, ...list(line.orderNames)]);
      if (quantity(line.requestedQty) !== row.requestedQty) row.requestedQty = null;
      if (kind === 'accepted') { row.observations++; row.reportedAcceptedQty = row.observations === 1 && source.acceptanceEvidence !== 'summary_confirmed' ? quantity(line.acceptedQty) : null; }
      else row.issues.push({ reason: line.reason || 'S&S returned an item error.', native: true });
    }
    return [...rows.values()].map(row => ({ ...row, status: source.preflightFailed ? 'not_sent' : row.issues.length ? 'review' : row.reportedAcceptedQty !== null ? 'accepted' : 'unconfirmed' }));
  }
  function normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    const supplierOrderNumbers = words(list(source.supplierOrderNumbers).length ? source.supplierOrderNumbers : [source.supplierOrderNumber]);
    const placementOutcome = ['confirmed', 'partial', 'rejected', 'unknown'].includes(source.placementOutcome)
      ? source.placementOutcome : ['confirmed', 'partial', 'rejected', 'unknown'].includes(source.outcome) ? source.outcome : source.ok === true ? 'confirmed' : 'unknown';
    let lineResults = Array.isArray(source.lineResults) ? source.lineResults.map(line => ({ ...line,
      itemNames: words(line.itemNames), orderNames: words(line.orderNames), issues: list(line.issues),
      requestedQty: quantity(line.requestedQty), reportedAcceptedQty: quantity(line.reportedAcceptedQty),
      notAcceptedQty: quantity(line.notAcceptedQty), unconfirmedQty: quantity(line.unconfirmedQty)
    })) : legacyLines(source);
    // Preserve old returned identifiers without claiming they alias the requested SKU.
    const known = new Set(lineResults.map(line => line.sku));
    if (source.acceptanceEvidence !== 'summary_confirmed') for (const line of list(source.acceptedLines)) {
      if (!line.sku || known.has(line.sku)) continue;
      known.add(line.sku);
      lineResults.push({ sku: line.sku, itemNames: words(line.itemNames), orderNames: words(line.orderNames),
        requestedQty: null, reportedAcceptedQty: quantity(line.acceptedQty), notAcceptedQty: null, unconfirmedQty: null,
        status: 'identifier_review', mappingReview: true, issues: [{ reason: 'S&S returned this item identifier. Its match to the requested garment needs review.' }] });
    }
    const nativeErrors = list(source.rejectedLines).map(line => ({ ...line, reason: line.reason || 'S&S returned an item error.' }));
    const mappingReview = lineResults.some(line => line.mappingReview || line.status === 'identifier_review')
      || list(source.issues).some(issue => /MISMATCH|IDENTIFIER|MAPPING/.test(issue.code || ''));
    lineResults = lineResults.map(line => {
      const contradictory = line.requestedQty !== null && line.reportedAcceptedQty !== null && line.reportedAcceptedQty > line.requestedQty;
      return { ...line, status: source.preflightFailed ? 'not_sent' : contradictory ? 'review' : line.status || 'unconfirmed',
        notAcceptedQty: quantity(line.notAcceptedQty), unconfirmedQty: quantity(line.unconfirmedQty),
        issues: contradictory ? [...line.issues, { reason: 'The returned quantity differs from the requested quantity. Review the S&S order.' }] : line.issues };
    });
    const rawAccepted = list(source.acceptedLines);
    const reportedUnits = source.acceptanceEvidence === 'summary_confirmed' ? null
      : rawAccepted.length && rawAccepted.every(line => quantity(line.acceptedQty) !== null)
        ? rawAccepted.reduce((sum, line) => sum + Number(line.acceptedQty), 0) : quantity(source.totals?.reportedAcceptedUnits);
    return { ...source, outcome: placementOutcome, placementOutcome, supplierOrderNumbers, nativeErrors,
      detailOutcome: source.detailOutcome || (mappingReview ? 'unresolved' : nativeErrors.length ? 'partial' : 'complete'),
      mappingReview, reportedUnits: source.preflightFailed ? null : reportedUnits,
      lineResults, acceptedLines: rawAccepted, rejectedLines: list(source.rejectedLines), orderResults: list(source.orderResults),
      excludedLines: list(source.excludedLines), issues: list(source.issues) };
  }
  function presentation(value) {
    const report = normalize(value), numbers = report.supplierOrderNumbers;
    let title = report.preflightFailed ? 'Nothing was sent to S&S'
      : numbers.length ? `S&S returned ${numbers.length === 1 ? 'order' : 'orders'} ${numbers.join(', ')}`
        : report.placementOutcome === 'rejected' ? 'S&S rejected the request' : report.placementOutcome === 'unknown' ? 'S&S order result not confirmed' : 'S&S order response';
    let summary = report.preflightFailed ? report.nativeErrors[0]?.reason || sourceMessage(report) || 'Correct the issue below before trying again.'
      : report.reportedUnits !== null ? `S&S reported ${report.reportedUnits} ${report.reportedUnits === 1 ? 'unit' : 'units'}.`
        : numbers.length ? 'Review the S&S order response below.' : report.nativeErrors.length ? report.nativeErrors[0].reason : 'Check S&S Order History before sending these garments again.';
    if (report.mappingReview) summary += ' Item matching needs review.';
    let warning = report.preflightFailed ? '' : numbers.length && report.mappingReview ? 'Do not send these units again while reviewing this order.'
      : report.placementOutcome === 'unknown' && !numbers.length ? 'The request may have reached S&S. Do not resend it until you check Order History.' : '';
    let nextStep = numbers.length ? "For your usual cart workflow, review the S&S order, cancel it, and choose Yes to add its items back to cart, if you haven't already." : '';
    if (report.supplierMessage && report.placementOutcome !== 'confirmed') {
      summary = `${report.upstreamHttpStatus ? `S&S HTTP ${report.upstreamHttpStatus}: ` : ''}${report.supplierMessage}`;
    }
    const rateLimited = report.failureKind === 'rate_limited';
    const retryTime = report.retryAt && Number.isFinite(Date.parse(report.retryAt))
      ? new Date(report.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : null;
    const retryHint = retryTime ? Date.parse(report.retryAt) > Date.now() ? `Retry after ${retryTime}. ` : 'The wait time has passed. ' : '';
    if (rateLimited) {
      title = 'S&S asked you to wait';
      warning = '';
      nextStep = `${retryHint}Choose Place S&S order again when you are ready. Nothing will be retried automatically.`;
    }
    if (report.submissionAction === 'blocked') {
      title = 'Submission blocked — nothing new sent';
      const currentUnits = quantity(report.totals?.requestedUnits);
      summary = `${currentUnits !== null ? `Current selection: ${currentUnits} garments across ${report.orderCount || report.orderResults.length} orders. ` : ''}${report.actionMessage || 'An earlier attempt needs review. No new S&S request was sent by this action.'}`;
      warning = '';
      nextStep = 'Check the earlier request in S&S Order History before repeating an uncertain order. Previous evidence is separate below.';
      if (rateLimited) nextStep = `${retryHint}Use Place S&S order to try again. Nothing will be retried automatically.`;
      const previous = list(report.previousResults)[0];
      if (previous) {
        const started = previous.attemptStartedAt || previous.recordedAt;
        summary += ` Earlier request${started ? ` at ${started}` : ''}${previous.upstreamHttpStatus ? ` returned S&S HTTP ${previous.upstreamHttpStatus}` : ''}${previous.supplierMessage ? `: ${previous.supplierMessage}` : '.'}`;
      }
    } else if (report.submissionAction === 'saved' || report.submissionAction === 'replayed') {
      title = `${report.submissionAction === 'replayed' ? 'Previous result' : 'Saved result'}${numbers.length ? ` · S&S ${numbers.join(', ')}` : ''}`;
      summary = `No new supplier request was sent by this action. ${summary}`;
    } else if (report.submissionAction === 'not_sent') {
      title = 'Order request not sent'; summary = report.actionMessage || summary; warning = ''; nextStep = '';
    }
    return { report, title, summary, warning, nextStep,
      exceptions: rateLimited ? [] : report.lineResults.filter(line => line.status !== 'accepted' || line.issues.length),
      accepted: report.lineResults.filter(line => line.status === 'accepted' && !line.issues.length) };
  }
  function sourceMessage(report) { return typeof report.summary === 'string' ? report.summary : ''; }
  return Object.freeze({ normalize, presentation, identity });
});
