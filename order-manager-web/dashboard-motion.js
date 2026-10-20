/* Small, interruptible interactions. Production feedback follows settled saves. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new WeakMap();
  let pending = 0, failed = false, suppressed = false, feedback, dismissTimer, showTimer, feedbackShown = false;
  const enabled = () => document.body?.dataset.orderSource === 'shopify';

  function cancelPopover(panel) {
    animations.get(panel)?.cancel();
    animations.delete(panel);
  }
  function enterPopover(panel, trigger, event) {
    cancelPopover(panel);
    if (!enabled() || reduced.matches || !event?.detail || typeof panel.animate !== 'function') return;
    const bounds = panel.getBoundingClientRect(), origin = trigger.getBoundingClientRect();
    panel.style.transformOrigin = `${Math.max(0, Math.min(bounds.width, origin.left + origin.width / 2 - bounds.left))}px ${origin.bottom <= bounds.top ? 0 : bounds.height}px`;
    const animation = panel.animate([
      { opacity: 0, transform: 'translateY(-3px) scale(.98)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' }
    ], { duration: 150, easing: 'cubic-bezier(.23, 1, .32, 1)' });
    animations.set(panel, animation);
    animation.onfinish = () => animations.delete(panel);
  }

  function showFeedback(state, copy) {
    if (!feedback) return;
    feedback.hidden = !enabled() || suppressed;
    feedback.dataset.saveState = state;
    feedback.querySelector('span').textContent = copy;
  }
  async function trackSave(task) {
    clearTimeout(dismissTimer);
    if (!pending) {
      failed = false; suppressed = false; feedbackShown = false;
      if (feedback) feedback.hidden = true;
      clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        if (pending) { feedbackShown = true; showFeedback('saving', 'Saving changes…'); }
      }, 250);
    }
    // List workflows retain their detailed partial/unknown result region and
    // its existing live announcement instead of a second generic success toast.
    suppressed ||= document.body?.dataset.orderWorkflowSaving === 'true';
    pending++;
    try { return await task(); }
    catch (error) { failed = true; throw error; }
    finally {
      pending--;
      if (!pending) {
        clearTimeout(showTimer);
        if (failed || feedbackShown) showFeedback(failed ? 'review' : 'saved', failed ? 'Changes need review' : 'Production changes saved');
        dismissTimer = window.setTimeout(() => { if (feedback) feedback.hidden = true; }, failed ? 6000 : 1200);
      }
    }
  }
  window.dashboardMotion = { enterPopover, cancelPopover, trackSave, get saving() { return pending > 0; } };

  function setup() {
    feedback = document.createElement('div');
    feedback.id = 'dashboard-save-feedback'; feedback.hidden = true;
    feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('aria-atomic', 'true');
    const icon = document.createElement('i'); icon.setAttribute('aria-hidden', 'true');
    feedback.append(icon, document.createElement('span')); document.body.append(feedback);
    document.addEventListener('pointerdown', () => { document.body.dataset.dashboardInput = 'pointer'; }, true);
    document.addEventListener('keydown', () => { document.body.dataset.dashboardInput = 'keyboard'; }, true);
    new MutationObserver(() => {
      if (!enabled()) { feedback.hidden = true; clearTimeout(dismissTimer); }
    }).observe(document.body, { attributes: true, attributeFilter: ['data-order-source'] });
    reduced.addEventListener('change', () => {
      for (const panel of document.querySelectorAll('#supplies-actions-popover, #pipeline-view-popover')) cancelPopover(panel);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
