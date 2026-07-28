import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useCallback, useEffect, useMemo, useState} from 'preact/hooks';
import {
  DISPLAY_STAGE_OPTIONS,
  applyDisplayStageTransition,
  authenticatedRequest,
  blanksSubstage,
  buildProductionPatch,
  currentProductionSatisfiesDraft,
  displayStage,
  idempotencyKey,
  mergeProductionConflict,
  normalizeProduction,
  printedCountError,
  productionPath,
  setBlanksSubstage,
  stageLabel,
  stageRank,
  updateReadinessDependency,
} from './production-client.mjs';

export default async () => {
  render(<Extension />, document.body);
};

function selectedOrderGid() {
  return shopify.data?.selected?.[0]?.id || null;
}

function fieldValue(event) {
  return event.currentTarget?.value ?? event.target?.value ?? '';
}

function choiceValue(event) {
  return event.currentTarget?.values?.[0] ?? event.target?.values?.[0] ?? '';
}

function checkedValue(event) {
  return Boolean(event.currentTarget?.checked ?? event.target?.checked);
}

function collapsedSummary(production) {
  if (!production) return 'Loading status';
  const prefix = production.archivedAt ? 'Archived' : stageLabel(production.stage);
  return `${prefix} · ${production.printedCount}/${production.garmentCount}`.slice(0, 29);
}

function statusTone(production) {
  if (production.archivedAt) return 'info';
  return ['print', 'completed'].includes(production.stage) ? 'success' : 'info';
}

function Extension() {
  const gid = selectedOrderGid();
  const [production, setProduction] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [handoffConfirm, setHandoffConfirm] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!gid) {
      setLoading(false);
      setNotice({tone: 'critical', message: 'Shopify did not provide an order ID.', retry: null});
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const result = await authenticatedRequest(productionPath(gid));
      const next = normalizeProduction(result?.production);
      setProduction(next);
      setDraft(next);
      setHandoffConfirm(false);
    } catch (error) {
      setNotice({
        tone: 'critical',
        message: error?.message || 'PrintMO production data could not load.',
        retry: 'load',
        actionLabel: 'Retry loading',
      });
    } finally {
      setLoading(false);
    }
  }, [gid]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useMemo(
    () => production && draft ? buildProductionPatch(production, draft) : {},
    [production, draft],
  );
  const dirty = Object.keys(patch).length > 0;
  const countError = draft ? printedCountError(draft.printedCount, draft.garmentCount) : '';
  const backwardMove = Boolean(
    production
    && draft
    && stageRank(draft.stage) < stageRank(production.stage),
  );
  const busy = saving || lifecycleSaving;
  const archived = Boolean(production?.archivedAt);

  const updateDraft = (updater) => {
    setDraft((current) => typeof updater === 'function' ? updater(current) : {...current, ...updater});
    setNotice(null);
    setHandoffConfirm(false);
  };

  const handleStageChange = (event) => {
    const nextDisplayStage = fieldValue(event);
    updateDraft((current) => applyDisplayStageTransition(current, nextDisplayStage));
  };

  const handleBlanksSubstageChange = (event) => {
    const nextSubstage = choiceValue(event);
    if (!nextSubstage) return;
    updateDraft((current) => setBlanksSubstage(current, nextSubstage));
  };

  const handleOrderedChange = (orderedField, readyField, readyLabel, checked) => {
    const {next, clearedReady} = updateReadinessDependency(
      draft,
      orderedField,
      readyField,
      checked,
    );
    if (displayStage(draft.stage) === 'blanks' && orderedField === 'blanksOrdered') {
      next.stage = checked ? 'blanks_ordered' : 'blanks_cart';
    }
    setDraft(next);
    setNotice(clearedReady ? {
      tone: 'warning',
      message: `${readyLabel} was cleared because ordering is required first.`,
      retry: null,
    } : null);
    setHandoffConfirm(false);
  };

  const save = async () => {
    if (!gid || !production || !draft || !dirty || saving) return;
    if (countError) {
      setNotice({tone: 'critical', message: countError, retry: null});
      return;
    }
    const originalSnapshot = production;
    const draftSnapshot = draft;
    const patchSnapshot = buildProductionPatch(originalSnapshot, draftSnapshot);
    setSaving(true);
    setNotice(null);
    try {
      const result = await authenticatedRequest(productionPath(gid), {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: originalSnapshot.version,
          patch: patchSnapshot,
          idempotencyKey: idempotencyKey(gid),
        }),
      });
      const next = normalizeProduction(result?.production);
      setProduction(next);
      setDraft(next);
      setNotice(result?.syncPending ? {
        tone: 'warning',
        message: 'Saved in Shopify. Order Manager is still updating.',
        retry: null,
      } : {
        tone: 'success',
        message: 'Production changes saved.',
        retry: null,
      });
    } catch (error) {
      if (error?.status === 409 || error?.code === 'VERSION_CONFLICT') {
        let latestValue = error.currentProduction;
        if (!latestValue) {
          try {
            latestValue = (await authenticatedRequest(productionPath(gid)))?.production;
          } catch (_) {
            // Preserve the complete local draft when recovery cannot load.
          }
        }
        if (latestValue) {
          const latest = normalizeProduction(latestValue);
          if (currentProductionSatisfiesDraft(originalSnapshot, draftSnapshot, latest)) {
            setProduction(latest);
            setDraft(latest);
            setNotice({
              tone: 'success',
              message: 'Production changes were already saved from another session.',
              retry: null,
            });
          } else {
            setProduction(latest);
            setDraft(mergeProductionConflict(originalSnapshot, draftSnapshot, latest));
            setNotice({
              tone: 'warning',
              message: 'This order changed elsewhere. Your edits were kept—review them, then Save again.',
              retry: 'save',
              actionLabel: 'Save merged changes',
            });
          }
        } else {
          setNotice({
            tone: 'critical',
            message: 'This order changed elsewhere, but the latest version could not load. Your edits are still here.',
            retry: 'save',
            actionLabel: 'Retry save',
          });
        }
      } else {
        setNotice({
          tone: 'critical',
          message: error?.message || 'Production changes could not be saved. Your edits are still here.',
          retry: 'save',
          actionLabel: 'Retry save',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const work = save();
    event.waitUntil?.(work);
  };

  const discard = (event) => {
    event?.preventDefault?.();
    if (!production || busy) return;
    setDraft(production);
    setNotice({tone: 'info', message: 'Unsaved changes discarded.', retry: null});
    setHandoffConfirm(false);
  };

  const refresh = () => {
    if (dirty) {
      setNotice({
        tone: 'warning',
        message: 'Discard your unsaved changes before refreshing.',
        retry: null,
      });
      return;
    }
    load();
  };

  const mutateArchive = async (archive) => {
    if (!gid || !production || dirty || busy) return;
    setLifecycleSaving(true);
    setNotice(null);
    try {
      const result = await authenticatedRequest(productionPath(gid), {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: production.version,
          patch: {archived_at: archive ? new Date().toISOString() : null},
          idempotencyKey: idempotencyKey(gid),
        }),
      });
      const next = normalizeProduction(result?.production);
      setProduction(next);
      setDraft(next);
      setHandoffConfirm(false);
      setNotice(result?.syncPending ? {
        tone: 'warning',
        message: 'Saved in Shopify. Order Manager is still updating.',
        retry: null,
      } : {
        tone: 'success',
        message: archive
          ? 'Customer handoff complete. This order is off the active production board.'
          : 'Production order reopened and returned to the active board.',
        retry: null,
      });
    } catch (error) {
      if ((error?.status === 409 || error?.code === 'VERSION_CONFLICT') && error.currentProduction) {
        const latest = normalizeProduction(error.currentProduction);
        setProduction(latest);
        setDraft(latest);
        setNotice({
          tone: 'warning',
          message: 'This order changed elsewhere. The latest production status is shown; review and try again.',
          retry: null,
        });
      } else {
        setNotice({
          tone: 'critical',
          message: error?.message || 'The production order could not be updated.',
          retry: archive ? 'archive' : 'reopen',
          actionLabel: archive ? 'Retry handoff' : 'Retry reopening',
        });
      }
    } finally {
      setLifecycleSaving(false);
    }
  };

  const retryNotice = () => {
    if (notice?.retry === 'load') load();
    if (notice?.retry === 'save') save();
    if (notice?.retry === 'archive') mutateArchive(true);
    if (notice?.retry === 'reopen') mutateArchive(false);
  };

  return (
    <s-admin-block
      heading="PrintMO production"
      collapsedSummary={collapsedSummary(draft)}
    >
      <s-stack direction="block" gap="base">
        {notice && (
          <s-stack direction="block" gap="small">
            <s-banner tone={notice.tone}>{notice.message}</s-banner>
            {notice.retry && (
              <s-button disabled={busy} onClick={retryNotice}>
                {notice.actionLabel || 'Try again'}
              </s-button>
            )}
          </s-stack>
        )}

        {loading && !draft && <s-text>Loading production status…</s-text>}

        {draft && (
          <>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={statusTone(draft)}>
                {archived ? 'Handoff complete' : stageLabel(draft.stage)}
              </s-badge>
              <s-text color="subdued">
                {draft.printedCount} of {draft.garmentCount} garments printed
              </s-text>
            </s-stack>

            {backwardMove && (
              <s-banner tone="warning">
                Moving backward keeps milestones and the printed count. Review them before saving.
              </s-banner>
            )}

            <s-form onSubmit={handleSubmit} onReset={discard}>
              <s-stack direction="block" gap="large">
                <s-select
                  label="Production stage"
                  name="productionStage"
                  value={displayStage(draft.stage)}
                  disabled={busy || archived}
                  onChange={handleStageChange}
                >
                  {DISPLAY_STAGE_OPTIONS.map((option) => (
                    <s-option key={option.value} value={option.value}>{option.label}</s-option>
                  ))}
                </s-select>

                {displayStage(draft.stage) === 'blanks' && (
                  <s-choice-list
                    label="Blanks status"
                    name="blanksSubstage"
                    values={[blanksSubstage(draft)]}
                    disabled={busy || archived}
                    details="Choose where this order currently sits in the S&S ordering flow."
                    onChange={handleBlanksSubstageChange}
                  >
                    <s-choice value="cart">In S&amp;S cart</s-choice>
                    <s-choice value="ordered">Ordered</s-choice>
                  </s-choice-list>
                )}

                <s-section heading="Readiness milestones">
                  <s-stack direction="block" gap="base">
                    <s-stack direction="block" gap="small">
                      <s-text>Blanks</s-text>
                      <s-stack direction="inline" gap="base">
                        <s-checkbox
                          label="Ordered"
                          name="blanksOrdered"
                          checked={Boolean(draft.blanksOrdered)}
                          disabled={busy || archived}
                          onChange={(event) => handleOrderedChange(
                            'blanksOrdered',
                            'blanksStatus',
                            'Blanks ready',
                            checkedValue(event),
                          )}
                        />
                        <s-checkbox
                          label="Ready"
                          name="blanksReady"
                          checked={Boolean(draft.blanksStatus)}
                          disabled={busy || archived || !draft.blanksOrdered}
                          details={!draft.blanksOrdered ? 'Mark Ordered first.' : ''}
                          onChange={(event) => updateDraft({
                            blanksStatus: checkedValue(event) ? 1 : 0,
                          })}
                        />
                      </s-stack>
                    </s-stack>

                    <s-stack direction="block" gap="small">
                      <s-text>Prints</s-text>
                      <s-stack direction="inline" gap="base">
                        <s-checkbox
                          label="Ordered"
                          name="printsOrdered"
                          checked={Boolean(draft.printsOrdered)}
                          disabled={busy || archived}
                          onChange={(event) => handleOrderedChange(
                            'printsOrdered',
                            'printsStatus',
                            'Prints ready',
                            checkedValue(event),
                          )}
                        />
                        <s-checkbox
                          label="Ready"
                          name="printsReady"
                          checked={Boolean(draft.printsStatus)}
                          disabled={busy || archived || !draft.printsOrdered}
                          details={!draft.printsOrdered ? 'Mark Ordered first.' : ''}
                          onChange={(event) => updateDraft({
                            printsStatus: checkedValue(event) ? 1 : 0,
                          })}
                        />
                      </s-stack>
                    </s-stack>
                  </s-stack>
                </s-section>

                <s-section heading="Print progress">
                  <s-stack direction="block" gap="small">
                    <s-number-field
                      label="Pieces printed"
                      name="printedCount"
                      inputMode="numeric"
                      min={0}
                      max={draft.garmentCount}
                      step={1}
                      suffix={`/ ${draft.garmentCount}`}
                      value={String(draft.printedCount)}
                      error={countError}
                      disabled={busy || archived}
                      onChange={(event) => updateDraft({printedCount: fieldValue(event)})}
                    />
                    <s-stack direction="inline" gap="small">
                      <s-button
                        disabled={busy || archived || countError || Number(draft.printedCount) >= draft.garmentCount}
                        onClick={() => updateDraft({
                          printedCount: Math.min(
                            draft.garmentCount,
                            Math.max(0, Number(draft.printedCount) || 0) + 1,
                          ),
                        })}
                      >
                        +1
                      </s-button>
                      <s-button
                        disabled={busy || archived || Number(draft.printedCount) === draft.garmentCount}
                        onClick={() => updateDraft({printedCount: draft.garmentCount})}
                      >
                        Mark all printed
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-section>

                <s-text-area
                  label="PrintMO internal notes"
                  name="internalNotes"
                  value={draft.internalNotes}
                  rows={3}
                  maxLength={5000}
                  details={`Visible only to PrintMO operators · ${draft.internalNotes.length.toLocaleString()} / 5,000`}
                  disabled={busy || archived}
                  onChange={(event) => updateDraft({internalNotes: fieldValue(event).slice(0, 5000)})}
                />
              </s-stack>
            </s-form>

            <s-section heading="Purchase orders">
              <s-stack direction="block" gap="small">
                {draft.blanksPo.length ? draft.blanksPo.map((reference) => (
                  <s-text key={reference}>{reference}</s-text>
                )) : <s-text color="subdued">No purchase orders recorded.</s-text>}
              </s-stack>
            </s-section>

            <s-stack direction="inline" gap="small">
              <s-button disabled={loading || busy} onClick={refresh}>Refresh</s-button>
            </s-stack>

            {!archived && production.stage === 'completed' && !dirty && (
              <s-section heading="Customer handoff">
                {handoffConfirm ? (
                  <s-stack direction="block" gap="small">
                    <s-banner tone="warning">
                      Marking handoff complete removes this order from the active production board.
                    </s-banner>
                    <s-stack direction="inline" gap="small">
                      <s-button
                        variant="primary"
                        disabled={busy}
                        onClick={() => mutateArchive(true)}
                      >
                        Confirm handoff
                      </s-button>
                      <s-button disabled={busy} onClick={() => setHandoffConfirm(false)}>
                        Cancel
                      </s-button>
                    </s-stack>
                  </s-stack>
                ) : (
                  <s-button disabled={busy} onClick={() => setHandoffConfirm(true)}>
                    Mark handoff complete
                  </s-button>
                )}
              </s-section>
            )}

            {archived && (
              <s-section heading="Production order closed">
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">
                    This order remains available in Shopify but is not on the active production board.
                  </s-text>
                  <s-button disabled={busy} onClick={() => mutateArchive(false)}>
                    Reopen production order
                  </s-button>
                </s-stack>
              </s-section>
            )}
          </>
        )}
      </s-stack>
    </s-admin-block>
  );
}
