const { createHash } = require('crypto');

const PRINT_TITLES = new Set([
  'T-shirt Breast Print',
  'T-shirt Chest Print',
  'T-shirt Full Print',
  'T-shirt Full Back Print',
  'T-shirt Half Back Print',
  'T-shirt Back Tag Print',
  'T-shirt Neck Tag Print',
  'T-shirt Sleeve Print',
  'Full Sleeve Print',
  'Half Sleeve Print',
  'Hood Print',
  'Sweatpants Small Logo Print',
  'Sweatpants Half Leg Print',
  'Sweatpants Full Leg Print',
  'Hat Front Print',
  'Hat Side Print',
  'Hat Back Print',
  'Drawstring Bag Full Print',
  'Drawstring Bag Small Print',
  'Tote Bag Small Print',
  'Tote Bag Half Print',
  'Tote Bag Full Print',
  'DTF Print'
]);

function printHelp() {
  console.log(`PrintMO production-completion repair

Usage:
  npm run repo -- completion dry-run --shop <domain> --env <environment> --url <worker-url>
  npm run repo -- completion execute --shop <domain> --confirm-shop <same-domain> --env <environment> --url <worker-url>

Safety:
  Dry-run is the default and performs authenticated reads only.
  Execute requires --confirm-shop to exactly match --shop.
  ORDER_MANAGER_BEARER_TOKEN is read from the environment and never from arguments.
  Only active stage=print orders whose nonzero garment count equals printedCount are eligible.
  Execution patches only stage=completed and the already-equal printed_count.`);
}

function parseArgs(args) {
  const options = {
    execute: false,
    shop: '',
    confirmShop: '',
    environment: '',
    url: process.env.ORDER_MANAGER_API_BASE || '',
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--execute') options.execute = true;
    else if (value === '--dry-run') options.execute = false;
    else if (value === '--shop') options.shop = args[++index] || '';
    else if (value === '--confirm-shop') options.confirmShop = args[++index] || '';
    else if (value === '--env') options.environment = args[++index] || '';
    else if (value === '--url') options.url = args[++index] || '';
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown argument "${value}". Use --help for usage.`);
  }
  return options;
}

function garmentCount(order) {
  return (order?.commerce?.lineItems || []).reduce((total, item) => {
    if (PRINT_TITLES.has(item?.title)) return total;
    return total + Math.max(0, Number(item?.currentQuantity ?? item?.quantity ?? 0) || 0);
  }, 0);
}

function completionCandidate(order) {
  const production = order?.production || {};
  const garments = garmentCount(order);
  const printed = Math.max(0, Number(production.printedCount || 0));
  if (production.stage !== 'print' || production.archivedAt || garments <= 0 || printed !== garments) {
    return null;
  }
  return {
    id: order.id,
    order: order.displayName || order.id,
    version: Number(production.version ?? production.revision ?? 0),
    garmentCount: garments,
    printedCount: printed
  };
}

function requestHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `${label} failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = body?.error?.code || '';
    throw error;
  }
  return body;
}

async function loadPrintOrders(base, token) {
  const records = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ stage: 'print', limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${base}/order-manager/v1/orders?${query}`, {
      headers: requestHeaders(token)
    });
    const page = await responseJson(response, 'Production completion scan');
    records.push(...(Array.isArray(page?.data) ? page.data : []));
    cursor = page?.pageInfo?.nextCursor || '';
  } while (cursor && records.length < 500);
  return records;
}

function repairKey(candidate) {
  const idHash = createHash('sha256').update(candidate.id).digest('hex').slice(0, 24);
  return `completion-repair:${idHash}:${candidate.version}`;
}

async function repairCandidate(base, token, candidate) {
  const response = await fetch(
    `${base}/order-manager/v1/orders/${encodeURIComponent(candidate.id)}/production`,
    {
      method: 'PATCH',
      headers: requestHeaders(token),
      body: JSON.stringify({
        expectedVersion: candidate.version,
        idempotencyKey: repairKey(candidate),
        patch: {
          stage: 'completed',
          printed_count: candidate.printedCount
        }
      })
    }
  );
  return responseJson(response, `Completion repair for ${candidate.order}`);
}

async function run(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    printHelp();
    return { ok: true, help: true };
  }
  if (!options.shop || !options.environment || !options.url) {
    throw new Error('Required: --shop <domain> --env <environment> --url <Worker base URL>');
  }
  if (options.execute && options.confirmShop !== options.shop) {
    throw new Error('--execute requires --confirm-shop with the exact same Shopify domain');
  }
  const token = process.env.ORDER_MANAGER_BEARER_TOKEN;
  if (!token) {
    throw new Error('Set ORDER_MANAGER_BEARER_TOKEN in the current shell; never pass it on the command line');
  }

  const base = options.url.replace(/\/+$/, '');
  const orders = await loadPrintOrders(base, token);
  const candidates = orders.map(completionCandidate).filter(Boolean);
  const report = {
    mode: options.execute ? 'execute' : 'dry-run',
    shop: options.shop,
    environment: options.environment,
    scanned: orders.length,
    candidateCount: candidates.length,
    candidates
  };
  console.log(JSON.stringify(report, null, 2));

  if (!options.execute) return { ok: true, report };

  const results = [];
  for (const candidate of candidates) {
    try {
      const saved = await repairCandidate(base, token, candidate);
      results.push({
        order: candidate.order,
        status: 'completed',
        version: saved?.production?.version ?? candidate.version + 1
      });
    } catch (error) {
      results.push({
        order: candidate.order,
        status: 'failed',
        code: error.code || '',
        message: error.message
      });
    }
  }
  const failed = results.filter(result => result.status === 'failed');
  console.log(JSON.stringify({
    complete: failed.length === 0,
    repaired: results.length - failed.length,
    failed: failed.length,
    results
  }, null, 2));
  if (failed.length) process.exitCode = 2;
  return { ok: failed.length === 0, report, results };
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  completionCandidate,
  garmentCount,
  parseArgs,
  repairKey,
  run
};
