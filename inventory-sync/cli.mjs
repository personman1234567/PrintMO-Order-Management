import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SyncError } from './core.mjs';
import { shopifyToken, shopifyRead, VARIANT_FIELDS } from './clients.mjs';
import { runDryRun } from './worker.mjs';
import { gatewayInventoryHandler } from './gateway-handler.mjs';
export function loadEnvFile(path, base = {}) {
  const result = { ...base };
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && result[m[1]] === undefined) result[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
}
function code(error) { return error instanceof SyncError ? error.code : 'CHECK_FAILED'; }
export async function audit(env, { directSS = false, deps } = {}) {
  const report = { mode: 'read-only', writes: 0, checkedAt: new Date().toISOString(),
    coverage: 'First 25 active variants only; not a full catalog or gateway-deployment audit.', checks: {} };
  let token;
  try {
    token = await shopifyToken(env, deps);
    const result = await shopifyRead(env, token, 'query InventoryHealth { shop { name } currentAppInstallation { accessScopes { handle } } }', {}, deps);
    const scopes = result.currentAppInstallation.accessScopes.map(s => s.handle);
    report.checks.shopify = { ok: true, scopes, inventoryWriteGranted: scopes.includes('write_inventory') };
  } catch (error) { report.checks.shopify = { ok: false, code: code(error) }; }
  if (token && report.checks.shopify.ok) {
    try {
      const result = await shopifyRead(env, token, `query InventoryCatalogSample { productVariants(first: 25, query: "product_status:active") { nodes { ${VARIANT_FIELDS} } pageInfo { hasNextPage } } }`, {}, deps);
      report.checks.catalog = { ok: true, variants: result.productVariants.nodes, hasMore: result.productVariants.pageInfo.hasNextPage };
    } catch (error) { report.checks.catalog = { ok: false, code: code(error) }; }
    try {
      const result = await shopifyRead(env, token, 'query InventoryLocations { locations(first: 25) { nodes { id name isActive fulfillsOnlineOrders } pageInfo { hasNextPage } } }', {}, deps);
      report.checks.locations = { ok: true, ...result.locations };
    } catch (error) { report.checks.locations = { ok: false, code: code(error) }; }
  }
  if (directSS) {
    const candidates = report.checks.catalog?.variants || [];
    const skus = [...new Set(candidates.map(v => v.sku).filter(s => /^[A-Za-z0-9_-]{1,64}$/.test(s)))].slice(0, 25);
    if (!skus.length) report.checks.supplierDirect = { ok: false, code: 'NO_SAMPLE_SKUS' };
    else {
      // Explicit diagnostic only. Use existing credentials in memory; the Worker uses the gateway.
      const key = crypto.randomUUID();
      const response = await gatewayInventoryHandler(new Request(`https://local.invalid/order-manager/v1/supplier/ss/inventory?skus=${skus.join(',')}`, {
        headers: { 'X-Order-Manager-Key': key }
      }), { ...env, ORDER_MANAGER_ADMIN_KEY: key }, deps);
      const result = await response.json();
      report.checks.supplierDirect = { ok: response.ok, ...result,
        establishes: 'Direct supplier read only; deployed gateway and reservation semantics remain unverified.' };
    }
  }
  return report;
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: node inventory-sync/cli.mjs audit|dry-run [--env-file PATH] [--shop SHOP.myshopify.com] [--direct-ss]\nRead-only. audit checks 25 active variants, scopes and locations. --direct-ss explicitly probes S&S from local credentials. dry-run uses the configured gateway. Neither command writes inventory or files. Output may contain internal SKUs/location names; retain only in approved internal storage.');
    return 0;
  }
  const [command, ...rest] = args;
  if (!['audit', 'dry-run'].includes(command)) throw new SyncError('INVALID_COMMAND');
  let env = { ...process.env };
  let directSS = false;
  let shop;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--env-file' && rest[i + 1] && !rest[i + 1].startsWith('--')) env = loadEnvFile(rest[++i], env);
    else if (rest[i] === '--shop' && rest[i + 1] && !rest[i + 1].startsWith('--')) shop = rest[++i];
    else if (rest[i] === '--direct-ss' && command === 'audit') directSS = true;
    else throw new SyncError('INVALID_ARGUMENT');
  }
  if (shop) env.SHOPIFY_SHOP_DOMAIN = shop;
  const result = command === 'audit' ? await audit(env, { directSS }) : await runDryRun(env);
  console.log(JSON.stringify(result, null, 2));
  return result.checks && Object.values(result.checks).some(c => !c.ok) ? 2 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(exitCode => { process.exitCode = exitCode; }).catch(error => {
    console.error(JSON.stringify({ error: code(error) })); process.exitCode = 1;
  });
}
