/** Runs the authenticated, PII-redacted server-side parity comparison. */
async function run() {
  const base = String(process.env.ORDER_MANAGER_API_BASE || '').replace(/\/+$/, '');
  const token = process.env.ORDER_MANAGER_BEARER_TOKEN;
  if (!base || !token) throw new Error('Set ORDER_MANAGER_API_BASE and ORDER_MANAGER_BEARER_TOKEN in the current shell');
  const response = await fetch(`${base}/order-manager/v1/parity/check`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }
  });
  const report = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(report?.error?.message || `Parity endpoint failed with HTTP ${response.status}`);
  const output = {
    checkedAt: report.checkedAt,
    legacyTotalCount: report.legacyTotalCount,
    v1MatchedCount: report.v1MatchedCount,
    unexplainedMismatchCount: report.unexplainedMismatchCount,
    parityStatus: report.parityStatus,
    mismatches: report.mismatches
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exit(1); });
module.exports = { run };
