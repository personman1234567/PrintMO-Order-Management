const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function usage() {
  console.log(`PrintMO S&S feedback simulator

Usage:
  npm run repo -- simulate ss-feedback -- --scenario random
  npm run repo -- simulate ss-feedback -- --scenario partial
  npm run repo -- simulate ss-feedback -- --scenario invalid-sku
  npm run repo -- simulate ss-feedback -- --scenario accepted
  npm run repo -- simulate ss-feedback -- --scenario timeout

Options:
  --scenario <name>  Fixture outcome. Default: partial
  --seed <integer>   Repeatable random fixture seed. Default: current timestamp
  --json             Print the normalized report as JSON
  --help             Show this help

Safety:
  This command performs no network requests and writes no files or databases.
  It loads the real Worker normalizer and passes it synthetic shirt data.`);
}

function parseArgs(argv) {
  const options = { scenario: 'partial', seed: Date.now(), json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--json') options.json = true;
    else if (value === '--scenario') options.scenario = String(argv[++index] || '').trim().toLowerCase();
    else if (value === '--seed') options.seed = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  const allowed = new Set(['random', 'partial', 'out-of-stock', 'invalid-sku', 'accepted', 'timeout']);
  if (!allowed.has(options.scenario)) throw new Error(`Unknown scenario: ${options.scenario}`);
  if (!Number.isSafeInteger(options.seed)) throw new Error('--seed must be an integer.');
  return options;
}

function seededIndex(seed, length) {
  const normalized = Math.abs(Number(seed) || 1) % 2147483647;
  return ((normalized * 48271) % 2147483647) % length;
}

function fixture(options) {
  const shirts = [
    { orderId: 'gid://simulated/Order/1041', orderName: '#SIM-1041', sku: '5000-BLACK-M', title: 'Gildan 5000', variantTitle: 'Black / Medium', qty: 2 },
    { orderId: 'gid://simulated/Order/1042', orderName: '#SIM-1042', sku: '1717-BLUEJEAN-L', title: 'Comfort Colors 1717', variantTitle: 'Blue Jean / Large', qty: 1 },
    { orderId: 'gid://simulated/Order/1043', orderName: '#SIM-1043', sku: '3001CVC-HEATHER-S', title: 'Bella + Canvas 3001CVC', variantTitle: 'Heather Navy / Small', qty: 3 },
  ];
  const requestedLines = shirts.map(({ sku, qty }) => ({ sku, qty }));
  const orderIds = shirts.map(shirt => shirt.orderId);
  const rejectedIndex = options.scenario === 'partial' || options.scenario === 'out-of-stock'
    ? 1
    : seededIndex(options.seed, shirts.length);
  const accepted = shirts.filter((_, index) => index !== rejectedIndex);
  const base = {
    requestedLines,
    lineSources: shirts,
    orderIds,
    batchId: `SIM-${options.seed}`,
    poNumber: `SIM-PO-${options.seed}`,
  };

  if (options.scenario === 'accepted') {
    return {
      ...base,
      payload: { ok: true, orderNumber: 'SIM-SS-ACCEPTED', testOrder: true },
    };
  }
  if (options.scenario === 'timeout') {
    return {
      ...base,
      payload: { error: 'Simulated gateway timeout' },
      error: Object.assign(new Error('Simulated gateway timeout'), { status: 502 }),
    };
  }
  if (options.scenario === 'invalid-sku') {
    return {
      ...base,
      payload: {
        code: '400',
        errors: [{ field: `lines[${rejectedIndex}].identifier`, code: 'SKU_NOT_FOUND', message: 'The SKU was not found in the S&S catalog.' }],
      },
      error: Object.assign(new Error('Simulated invalid SKU'), { status: 400 }),
    };
  }

  const rejected = shirts[rejectedIndex];
  return {
    ...base,
    payload: {
      Orders: [{
        OrderNumber: 'SIM-SS-PARTIAL',
        Lines: accepted.map(shirt => ({ Sku: shirt.sku, QtyOrdered: shirt.qty })),
      }],
      LineErrors: [{
        Identifier: rejected.sku,
        Code: 'NO_STOCK',
        Message: `No inventory is available for ${rejected.sku}.`,
        RequestedQty: rejected.qty,
        AvailableQty: 0,
      }],
      testOrder: true,
    },
  };
}

async function loadNormalizer() {
  const source = fs.readFileSync(path.join(root, 'order-manager-proxy', 'worker.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return (await import(moduleUrl)).normalizeSupplierCommitReport;
}

function displayRows(report) {
  const accepted = report.acceptedLines.map(line => ({
    Status: 'ACCEPTED',
    Order: (line.orderNames || []).join(', '),
    Item: (line.itemNames || []).join(', '),
    SKU: line.sku,
    Requested: line.requestedQty,
    Accepted: line.acceptedQty,
    Why: 'Accepted by S&S.',
  }));
  const rejected = report.rejectedLines.map(line => ({
    Status: 'REJECTED',
    Order: (line.orderNames || []).join(', '),
    Item: (line.itemNames || []).join(', '),
    SKU: line.sku || 'No line identifier',
    Requested: line.requestedQty ?? 'Unknown',
    Accepted: 0,
    Why: line.reason,
  }));
  return [...accepted, ...rejected];
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) return usage();
  const normalizeSupplierCommitReport = await loadNormalizer();
  const report = normalizeSupplierCommitReport(fixture(options));
  if (options.json) {
    console.log(JSON.stringify({ simulation: true, scenario: options.scenario, seed: options.seed, report }, null, 2));
    return;
  }
  console.log('SIMULATION ONLY — no S&S, Shopify, Worker, or database request was made.');
  console.log(`Scenario: ${options.scenario} | Seed: ${options.seed} | Outcome: ${report.outcome.toUpperCase()}`);
  console.log(report.summary);
  const rows = displayRows(report);
  if (rows.length) console.table(rows);
  else console.log('No line result was returned; the batch requires reconciliation before retrying.');
  console.log(`Reference: ${report.batchId}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`S&S feedback simulation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { displayRows, fixture, parseArgs };
