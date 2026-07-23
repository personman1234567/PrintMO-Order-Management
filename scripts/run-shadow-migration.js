/**
 * Runs the authenticated Worker migration endpoint in bounded batches.
 * Defaults to a real read-only dry run. Execution requires both --execute and
 * --confirm-shop matching --shop. Tokens are read from the environment only.
 */
function parseArgs(args) {
  const opts = {
    execute: false,
    dryRun: true,
    shop: null,
    env: null,
    resume: false,
    includeAssets: false,
    confirmShop: null,
    url: process.env.ORDER_MANAGER_API_BASE || '',
    limit: 1
  };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--execute') { opts.execute = true; opts.dryRun = false; }
    else if (value === '--dry-run') { opts.execute = false; opts.dryRun = true; }
    else if (value === '--resume') opts.resume = true;
    else if (value === '--include-assets') opts.includeAssets = true;
    else if (value === '--shop') opts.shop = args[++index] || null;
    else if (value === '--confirm-shop') opts.confirmShop = args[++index] || null;
    else if (value === '--env') opts.env = args[++index] || null;
    else if (value === '--url') opts.url = args[++index] || '';
    else if (value === '--limit') opts.limit = Math.min(Math.max(Number(args[++index] || 1), 1), 5);
  }
  return opts;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.shop || !opts.env || !opts.url) {
    throw new Error('Required: --shop <domain> --env <environment> --url <Worker base URL>');
  }
  if (opts.execute && opts.confirmShop !== opts.shop) {
    throw new Error('--execute requires --confirm-shop with the exact same Shopify domain');
  }
  const token = process.env.ORDER_MANAGER_BEARER_TOKEN;
  if (!token) throw new Error('Set ORDER_MANAGER_BEARER_TOKEN in the current shell; never pass it on the command line');
  const base = opts.url.replace(/\/+$/, '');
  let offset = opts.resume ? Number(process.env.PHASE2_MIGRATION_OFFSET || 0) : 0;
  const totals = { matched: 0, migrated: 0, quarantined: 0, errors: 0 };
  console.log(`Phase 2 migration ${opts.execute ? 'EXECUTE' : 'DRY RUN'}: ${opts.shop} (${opts.env}, ${opts.includeAssets ? 'metadata + assets' : 'metadata only'})`);
  do {
    const response = await fetch(`${base}/order-manager/v1/migration/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        execute: opts.execute,
        includeAssets: opts.includeAssets,
        confirmShop: opts.execute ? opts.confirmShop : undefined,
        offset,
        limit: opts.limit
      })
    });
    const report = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(report?.error?.message || `Migration endpoint failed with HTTP ${response.status}`);
    totals.matched += Number(report.matched || 0);
    totals.migrated += Number(report.migrated || 0);
    totals.quarantined += Number(report.quarantined || 0);
    totals.errors += Array.isArray(report.errors) ? report.errors.length : 0;
    console.log(JSON.stringify({ offset, matched: report.matched, migrated: report.migrated, quarantined: report.quarantined, errors: report.errors?.length || 0 }));
    offset = report.nextOffset;
  } while (offset !== null);
  console.log(JSON.stringify({ complete: true, ...totals }));
  return totals;
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exit(1); });
module.exports = { run, parseArgs };
