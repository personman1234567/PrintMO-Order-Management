import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useCallback, useEffect, useMemo, useState} from 'preact/hooks';
import {
  STAGE_OPTIONS,
  authenticatedRequest,
  buildProductionPatch,
  idempotencyKey,
  normalizeProduction,
  productionPath,
  stageLabel,
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

function checkedValue(event) {
  return Boolean(event.currentTarget?.checked ?? event.target?.checked);
}

function Extension() {
  const gid = selectedOrderGid();
  const [production, setProduction] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!gid) {
      setLoading(false);
      setNotice({tone: 'critical', message: 'Shopify did not provide an order ID.'});
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const result = await authenticatedRequest(productionPath(gid));
      const next = normalizeProduction(result?.production);
      setProduction(next);
      setDraft(next);
    } catch (error) {
      setNotice({tone: 'critical', message: error?.message || 'PrintMO production data could not load.'});
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

  const update = (field, value) => {
    setDraft((current) => ({...current, [field]: value}));
    setNotice(null);
  };

  const save = async () => {
    if (!gid || !production || !dirty || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await authenticatedRequest(productionPath(gid), {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: production.version,
          patch,
          idempotencyKey: idempotencyKey(gid),
        }),
      });
      const next = normalizeProduction(result?.production);
      setProduction(next);
      setDraft(next);
      setNotice({
        tone: 'success',
        message: 'Saved to Shopify and the PrintMO board projection.',
      });
    } catch (error) {
      if (error?.status === 409 || error?.code === 'VERSION_CONFLICT') {
        setNotice({
          tone: 'warning',
          message: 'This order changed elsewhere. Refreshing the latest version so nothing is overwritten.',
        });
        await load();
      } else {
        setNotice({tone: 'critical', message: error?.message || 'Production changes could not be saved.'});
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <s-admin-block
      heading="PrintMO production"
      collapsedSummary={draft ? `${stageLabel(draft.stage)} · ${draft.printedCount} printed` : 'Loading status'}
    >
      <s-stack direction="block" gap="base">
        {notice && <s-banner tone={notice.tone}>{notice.message}</s-banner>}

        {loading && <s-text>Loading production status…</s-text>}

        {!loading && draft && (
          <>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={draft.stage === 'print' ? 'success' : 'info'}>
                {stageLabel(draft.stage)}
              </s-badge>
              <s-text color="subdued">Version {draft.version}</s-text>
            </s-stack>

            <s-select
              label="Production stage"
              value={draft.stage}
              disabled={saving}
              onChange={(event) => update('stage', fieldValue(event))}
            >
              {STAGE_OPTIONS.map((option) => (
                <s-option key={option.value} value={option.value}>{option.label}</s-option>
              ))}
            </s-select>

            <s-stack direction="inline" gap="base">
              <s-checkbox
                label="Blanks ready"
                checked={Boolean(draft.blanksStatus)}
                disabled={saving}
                onChange={(event) => update('blanksStatus', checkedValue(event) ? 1 : 0)}
              />
              <s-checkbox
                label="Prints ordered"
                checked={Boolean(draft.printsOrdered)}
                disabled={saving}
                onChange={(event) => update('printsOrdered', checkedValue(event) ? 1 : 0)}
              />
              <s-checkbox
                label="Prints ready"
                checked={Boolean(draft.printsStatus)}
                disabled={saving}
                onChange={(event) => update('printsStatus', checkedValue(event) ? 1 : 0)}
              />
            </s-stack>

            <s-stack direction="inline" gap="base">
              <s-number-field
                label="Pieces printed"
                min="0"
                value={String(draft.printedCount)}
                disabled={saving}
                onChange={(event) => update('printedCount', Math.max(0, Number(fieldValue(event)) || 0))}
              />
              <s-text-field
                label="Bundle"
                value={draft.bundleId}
                disabled={saving}
                onChange={(event) => update('bundleId', fieldValue(event))}
              />
            </s-stack>

            <s-text-area
              label="Internal production notes"
              value={draft.internalNotes}
              rows="3"
              disabled={saving}
              onChange={(event) => update('internalNotes', fieldValue(event))}
            />

            <s-text color="subdued">
              Blanks PO: {draft.blanksPo.length ? draft.blanksPo.join(', ') : 'None recorded'}
            </s-text>

            <s-stack direction="inline" gap="small">
              <s-button variant="primary" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save production status'}
              </s-button>
              <s-button disabled={loading || saving} onClick={load}>Refresh</s-button>
            </s-stack>
          </>
        )}
      </s-stack>
    </s-admin-block>
  );
}
