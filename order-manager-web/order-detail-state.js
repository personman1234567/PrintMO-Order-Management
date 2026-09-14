(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OrderDetailState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function orderDraftKey(order) {
    if (!order) return '';
    const provider = String(order._provider || order.source?.provider || 'legacy').trim().toLowerCase();
    const immutableId = order._gid || order._orderKey || order.id || order.orderNumber || order.name;
    return immutableId ? `${provider}:${String(immutableId)}` : '';
  }

  function createNoteDraftStore() {
    const drafts = new Map();
    return {
      keyFor: orderDraftKey,
      read(key) {
        return key ? drafts.get(key) : undefined;
      },
      remember(key, text, baseText) {
        if (!key) return;
        if (text === baseText) drafts.delete(key);
        else drafts.set(key, { text, baseText });
      },
      discard(key) {
        if (key) drafts.delete(key);
      }
    };
  }

  // Calendar dates stay literal; urgency is evaluated in the shop's timezone.
  function targetDatePresentation(order, now = new Date()) {
    const value = order?.targetDate;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return null;
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = type => parts.find(entry => entry.type === type).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const dayDifference = Math.round((date.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const full = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }).format(date);
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric',
      ...(value.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {})
    }).format(date);
    const neutral = order.productionStage === 'completed' || order._historyReadOnly
      || String(order.displayFulfillmentStatus || '').toUpperCase() === 'FULFILLED';
    let label = `Target ${short}`;
    let tone = 'neutral';
    if (!neutral) {
      if (dayDifference < 0) { label = `Late · ${short}`; tone = 'late'; }
      else if (dayDifference === 0) { label = 'Today'; tone = 'soon'; }
      else if (dayDifference === 1) { label = 'Tomorrow'; tone = 'soon'; }
    }
    return { label, tone, full, accessible: `Target date: ${full}${tone === 'late' ? ', overdue' : ''}` };
  }

  function mergeCanonicalProductionState(order, production) {
    if (!order || !production) return order;
    const hasVersion = Object.prototype.hasOwnProperty.call(production, 'version')
      || Object.prototype.hasOwnProperty.call(production, 'revision');
    const currentVersion = Number(order._version ?? 0);
    const incomingVersion = hasVersion
      ? Number(production.version ?? production.revision ?? currentVersion)
      : currentVersion;
    const incomingIsOlder = hasVersion && incomingVersion < currentVersion;
    const progressMutationPending = Boolean(order._progressMutationPending);
    const adoptNumber = (canonicalKey, localKey = canonicalKey) => {
      if (Object.prototype.hasOwnProperty.call(production, canonicalKey)) {
        order[localKey] = Number(production[canonicalKey] || 0);
      }
    };

    if (incomingIsOlder) return order;
    if (hasVersion) order._version = incomingVersion;
    if (Object.prototype.hasOwnProperty.call(production, 'targetDate')) {
      order.targetDate = production.targetDate || null;
    }
    if (Object.prototype.hasOwnProperty.call(production, 'printEligibility')) {
      order.printEligibility = { ...production.printEligibility };
    }
    if (!progressMutationPending) {
      adoptNumber('printedCount', 'progress');
      if (production.stage) order.productionStage = production.stage;
    }
    adoptNumber('blanksStatus');
    adoptNumber('printsStatus');
    adoptNumber('blanksOrdered');
    adoptNumber('printsOrdered');
    return order;
  }

  function createProgressSaveCoordinator({ commit, notify = () => {} } = {}) {
    if (typeof commit !== 'function') throw new TypeError('A progress commit function is required.');
    const states = new WeakMap();

    const normalizedCount = (value, total) => {
      const count = Number(value);
      const maximum = Math.max(0, Number(total) || 0);
      if (!Number.isInteger(count)) return null;
      return Math.min(maximum, Math.max(0, count));
    };

    const intendedStage = (order, state, progress) => {
      const currentStage = state.confirmedStage || order.productionStage || '';
      if (!order?._candidate || !['print', 'completed'].includes(currentStage)) return null;
      if (state.total > 0 && progress === state.total) return 'completed';
      if (currentStage === 'completed' && progress < state.total) return 'print';
      return currentStage;
    };

    const stateFor = (order, options = {}) => {
      let state = states.get(order);
      if (!state) {
        state = {
          confirmedProgress: Math.max(0, Number(order?.progress) || 0),
          confirmedStage: order?.productionStage || '',
          confirmedVersion: Number(order?._version ?? 0),
          desiredProgress: Math.max(0, Number(order?.progress) || 0),
          total: Math.max(0, Number(options.total ?? order?.totalApparel) || 0),
          update: options.update,
          saving: false,
          promise: null
        };
        states.set(order, state);
      } else {
        state.total = Math.max(0, Number(options.total ?? order?.totalApparel ?? state.total) || 0);
        if (typeof options.update === 'function') state.update = options.update;
        if (!state.saving && !order?._progressMutationPending) {
          state.confirmedProgress = Math.max(0, Number(order?.progress) || 0);
          state.confirmedStage = order?.productionStage || state.confirmedStage;
          state.confirmedVersion = Number(order?._version ?? state.confirmedVersion);
          state.desiredProgress = state.confirmedProgress;
        }
      }
      return state;
    };

    const paintDesired = (order, state) => {
      order.progress = state.desiredProgress;
      const stage = intendedStage(order, state, state.desiredProgress);
      if (stage) {
        order.productionStage = stage;
        order.status = 'print';
      }
      order._progressDesired = state.desiredProgress;
      state.update?.();
    };

    const adoptCommittedResult = (order, state, target, stage, result) => {
      const production = result?.production || {};
      const hasPrintedCount = Object.prototype.hasOwnProperty.call(production, 'printedCount');
      const hasVersion = Object.prototype.hasOwnProperty.call(production, 'version')
        || Object.prototype.hasOwnProperty.call(production, 'revision');
      state.confirmedProgress = hasPrintedCount
        ? Math.max(0, Number(production.printedCount) || 0)
        : target;
      state.confirmedStage = production.stage || stage || order.productionStage || state.confirmedStage;
      state.confirmedVersion = hasVersion
        ? Number(production.version ?? production.revision)
        : Number(order._version ?? state.confirmedVersion);
      order.progress = state.confirmedProgress;
      if (state.confirmedStage) order.productionStage = state.confirmedStage;
      if (hasVersion) order._version = state.confirmedVersion;
    };

    const flush = async (order, state) => {
      state.saving = true;
      const startingStage = state.confirmedStage;
      notify({ phase: 'saving', order, state });
      try {
        while (
          state.desiredProgress !== state.confirmedProgress
          || (intendedStage(order, state, state.desiredProgress)
            && intendedStage(order, state, state.desiredProgress) !== state.confirmedStage)
        ) {
          const target = state.desiredProgress;
          const stage = intendedStage(order, state, target);
          const result = await commit(order, target, stage);
          adoptCommittedResult(order, state, target, stage, result);
          if (state.desiredProgress !== state.confirmedProgress) paintDesired(order, state);
        }
        order.progress = state.confirmedProgress;
        order.productionStage = state.confirmedStage || order.productionStage;
        state.update?.();
        notify({
          phase: 'saved',
          order,
          state,
          stageChanged: Boolean(startingStage && state.confirmedStage && startingStage !== state.confirmedStage)
        });
        return true;
      } catch (error) {
        const orderVersion = Number(order?._version ?? state.confirmedVersion);
        if (orderVersion > state.confirmedVersion) {
          state.confirmedVersion = orderVersion;
          state.confirmedProgress = Math.max(0, Number(order.progress) || 0);
          state.confirmedStage = order.productionStage || state.confirmedStage;
        }
        state.desiredProgress = state.confirmedProgress;
        order.progress = state.confirmedProgress;
        order.productionStage = state.confirmedStage || order.productionStage;
        state.update?.();
        notify({ phase: 'error', order, state, error });
        return false;
      } finally {
        state.saving = false;
        state.promise = null;
        order._progressMutationPending = false;
        delete order._progressDesired;
      }
    };

    return {
      request(order, nextProgress, options = {}) {
        if (!order) return Promise.resolve(false);
        const state = stateFor(order, options);
        const target = normalizedCount(nextProgress, state.total);
        if (target === null) return Promise.resolve(false);
        state.desiredProgress = target;
        order._progressMutationPending = true;
        paintDesired(order, state);
        notify({ phase: 'optimistic', order, state });
        if (!state.saving) state.promise = flush(order, state);
        return state.promise;
      },
      isPending(order) {
        return Boolean(order && states.get(order)?.saving);
      },
      stateFor(order, options = {}) {
        return order ? stateFor(order, options) : null;
      }
    };
  }

  return {
    targetDatePresentation,
    createProgressSaveCoordinator,
    createNoteDraftStore,
    mergeCanonicalProductionState,
    orderDraftKey
  };
});
