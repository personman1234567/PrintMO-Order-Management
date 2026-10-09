/* Explicit selections reuse existing production and supplier authority.
   No browsing transport, bundle expansion, or automatic supplier retries. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./order-board-model'));
  else root.OrderListWorkflows = factory(root.OrderBoardModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  const reference = order => ({ provider: order._provider, orderKey: String(order._orderKey || order._gid) });
  const fingerprint = order => JSON.stringify((order.items || []).map(item => [item.id, item.sku, item.qty]));
  const baseline = order => ({ stage: model.stageForOrder(order), bundle: order.bundle || '' });
  function create(deps) {
    let running = false;
    const recoveries = new Map(), uncertain = new Set();
    const latest = key => {
      const matches = deps.getOrders().filter(order => model.orderKey(order) === key);
      if (matches.length !== 1) throw new Error('This order is unavailable or its identity is ambiguous. Refresh and review.');
      return matches[0];
    };
    function eligibility(action, keys, destination) {
      if (running) return { enabled: false, reason: 'Wait for the current action to finish.' };
      if (keys.some(key => recoveries.has(key))) return { enabled: false, reason: 'Finish the saved operation using Retry remaining steps below before starting another action.' };
      if (action === 'supplier' && keys.some(key => uncertain.has(key))) return { enabled: false, reason: 'S&S may have received this submission. Review its saved result and reconcile before submitting again.' };
      return model.actionEligibility(action, keys, deps.getOrders(), destination);
    }
    function review(action, keys, args = {}) {
      const allowed = eligibility(action, keys, args.destination);
      if (!allowed.enabled) throw new Error(allowed.reason);
      return { action, args: { ...args }, jobs: keys.map(key => {
        const order = latest(key);
        return { key, reference: reference(order), baseline: baseline(order), fingerprint: fingerprint(order),
          number: order.orderNumber || order.name, name: order.name, bundle: order.bundle || '' };
      }) };
    }
    function validate(reviewed) {
      const allowed = model.actionEligibility(reviewed.action, reviewed.jobs.map(job => job.key), deps.getOrders(), reviewed.args.destination);
      if (!allowed.enabled) throw new Error(allowed.reason);
      for (const job of reviewed.jobs) {
        const order = latest(job.key);
        if (JSON.stringify(baseline(order)) !== JSON.stringify(job.baseline) || fingerprint(order) !== job.fingerprint)
          throw new Error('Selected orders changed during review. Review the current orders before continuing.');
      }
      if (reviewed.action === 'bundle') {
        const label = String(reviewed.args.label || '').trim();
        if (!label) throw new Error('Enter a bundle label.');
        if (deps.getOrders().some(order => order.bundle === label)) throw new Error('That active bundle label is already in use. Choose a new label.');
        reviewed.args.label = label;
      }
    }
    const entry = (job, outcome, message) => ({ key: job.key, number: job.number, outcome, message });
    async function refresh() { await deps.onChange?.(); }
    async function execute(reviewed) {
      if (running) throw new Error('An action is already running.');
      validate(reviewed);
      running = true;
      const results = [];
      try {
        const { action, args, jobs } = reviewed;
        if (action === 'supplier') {
          try {
            const { result, report } = await deps.submit(jobs.map(job => job.reference));
            const accepted = new Set(result.acceptedOrderKeys || []);
            const repairs = new Set(report.metadataRepairRequired || []);
            for (const job of jobs) {
              if (report.outcome === 'unknown' || repairs.has(job.reference.orderKey)) uncertain.add(job.key);
              results.push(entry(job, repairs.has(job.reference.orderKey) ? 'unknown' : accepted.has(job.key) ? 'saved' : report.outcome === 'unknown' ? 'unknown' : 'failed',
                repairs.has(job.reference.orderKey) ? 'S&S accepted this order; the production update needs reconciliation. Review the saved S&S result and do not resubmit.' : accepted.has(job.key) ? 'Added to S&S cart.' : report.summary || 'Review the S&S result.'));
            }
          } catch (error) {
            deps.showSupplierError?.(error);
            // Transport failure is uncertain unless the server records a deterministic rejection/preflight failure.
            const report = error.details?.report || error.payload?.error?.details?.report || error.payload?.report || error.report;
            const rejected = report?.outcome === 'rejected' || ['SUPPLIER_REJECTED', 'SUPPLIER_PREFLIGHT_FAILED', 'BATCH_HAS_NO_SUPPLIER_SKUS', 'INVALID_BATCH_ORDERS', 'BATCH_ORDER_MISSING', 'INVALID_BATCH_STAGE', 'SHELF_ORDER_STALE'].includes(error.code);
            for (const job of jobs) {
              if (!rejected) uncertain.add(job.key);
              results.push(entry(job, rejected ? 'failed' : 'unknown', error.message || 'Review and reconcile the S&S result.'));
            }
          }
        } else {
          let move;
          if (action === 'move') {
            const status = { received: 'received', to_order: 'toOrder', blanks_cart: 'blanks', print: 'print' }[args.destination];
            move = await deps.blanks.prepareExplicitMove(jobs.map(job => latest(job.key)), status, { blanksOrdered: 0 });
            if (move.batchChoice === 'cancel') return { cancelled: true, results: [] };
            validate(reviewed);
          }
          if (action === 'ordered') {
            const number = String(args.supplierOrderNumber || '').trim();
            if (!number) throw new Error('Enter the S&S order number.');
            await deps.blanks.recordExplicitOrdered(jobs.map(job => latest(job.key)), number, () => validate(reviewed));
            // Save recovery before any stage write: never recreate this manifest on retry.
            for (const job of jobs) recoveries.set(job.key, { job, kind: 'ordered', patch: { status: 'blanks', blanksOrdered: 1 } });
          }
          for (const job of jobs) {
            try {
              const order = latest(job.key);
              const allowed = model.actionEligibility(action, action === 'bundle' ? jobs.map(value => value.key) : [job.key], deps.getOrders(), args.destination);
              // Bundle members change one by one; subsequent members still use the captured same-stage selection.
              if (action !== 'bundle' && !allowed.enabled) throw new Error(allowed.reason);
              if (order._historyReadOnly || order.displayFulfillmentStatus === 'FULFILLED' || order._capabilities?.productionWrite === false)
                throw new Error('This order is no longer available for production changes.');
              if (action === 'bundle' && deps.getOrders().some(value => !jobs.some(member => model.orderKey(value) === member.key) && value.bundle === args.label))
                throw new Error('That bundle label became unavailable. Review the saved members before continuing.');
              if (JSON.stringify(baseline(order)) !== JSON.stringify(job.baseline) || fingerprint(order) !== job.fingerprint)
                throw new Error('This order changed. Review its current state.');
              if (action === 'bundle' || action === 'unbundle') {
                await deps.api.setBundle([job.reference], action === 'bundle' ? args.label : '', { workflowBaseline: job.baseline });
              } else {
                const patch = action === 'ordered' ? { status: 'blanks', blanksOrdered: 1 } : move.patch;
                await deps.blanks.moveExplicitOrder(job.reference, patch, job.baseline);
                if (action === 'move' && move.batchChoice === 'remove') {
                  const recovery = { job, kind: 'correction', stage: args.destination, refs: move.batchRefs };
                  recoveries.set(job.key, recovery);
                  await deps.blanks.correctExplicitBatch(latest(job.key), move.batchRefs);
                }
              }
              recoveries.delete(job.key);
              results.push(entry(job, 'saved', action === 'ordered' ? 'Receiving record saved; marked Ordered.' : action === 'move' ? 'Stage updated.' : 'Bundle updated.'));
            } catch (error) {
              results.push(entry(job, recoveries.has(job.key) ? 'remaining' : 'failed',
                (recoveries.get(job.key)?.kind === 'ordered' ? 'Receiving record saved; stage still needs updating. ' : recoveries.get(job.key)?.kind === 'correction' ? 'Stage saved; batch membership still needs correction. ' : '') + error.message));
            }
            await refresh();
          }
        }
        await refresh();
        return { results };
      } finally { running = false; }
    }
    async function retryRemaining(keys) {
      if (running) throw new Error('An action is already running.');
      running = true;
      const results = [];
      try {
        for (const key of keys) {
          const saved = recoveries.get(key); if (!saved) continue;
          const { job } = saved;
          try {
            const order = latest(key);
            if (order._historyReadOnly || order.displayFulfillmentStatus === 'FULFILLED' || order._capabilities?.productionWrite === false) throw new Error('This order is no longer available for production changes.');
            if (saved.kind === 'ordered') {
              if (model.stageForOrder(order) !== 'blanks_ordered') {
                if (JSON.stringify(baseline(order)) !== JSON.stringify(job.baseline) || fingerprint(order) !== job.fingerprint) throw new Error('This order changed. Review its receiving record in Receive Batches.');
                await deps.blanks.moveExplicitOrder(job.reference, saved.patch, job.baseline);
              }
            } else {
              if (model.stageForOrder(order) !== saved.stage) throw new Error('The stage changed again. Review the batch correction in Receive Batches.');
              await deps.blanks.correctExplicitBatch(order, saved.refs);
            }
            recoveries.delete(key); results.push(entry(job, 'saved', 'Remaining step saved.'));
          } catch (error) { results.push(entry(job, 'remaining', error.message)); }
          await refresh();
        }
        return { results };
      } finally { running = false; }
    }
    return Object.freeze({ eligibility, review, execute, retryRemaining, remaining: () => Array.from(recoveries.keys()), remainingJobs: () => Array.from(recoveries.values()).map(saved => saved.job), busy: () => running });
  }
  return Object.freeze({ create, reference });
});
