// Catalog-derived estimates only. Never use customer sale prices as costs.
export const COST_TTL_MS = 300000;
const catalogCache = new Map();
const pendingCatalog = new Map();

export function moneyToMinor(amount) {
    const match = /^(\d+)(?:\.(\d{1,2})0*)?$/.exec(String(amount ?? ''));
    if (!match) return null;
    const result = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
    return Number.isSafeInteger(result) ? result : null;
}

export function estimateGarments(order, costs, isPrint, now = new Date().toISOString()) {
    const totals = { garmentMinor: 0, shelfMinor: 0, supplierMinor: 0 };
    const lines = [];
    for (const item of order.items || []) {
        if (isPrint(item)) continue;
        const quantity = Number(item.currentQuantity ?? item.quantity ?? item.qty ?? 0);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
        const sku = String(order.provider === 'etsy' ? item.supplierSku || '' : item.sku || '').trim();
        const shelfQuantity = Math.min(quantity, Math.max(0, Number(item.shelfQuantity) || 0));
        const lookupKey = order.provider === 'etsy' ? `sku:${sku}` : `variant:${item.variantId || ''}`;
        const cost = costs.get(lookupKey);
        let exclusionReason = !sku ? 'Manual item' : cost?.reason || null;
        const unitCostMinor = moneyToMinor(cost?.amount);
        if (!exclusionReason && cost?.currencyCode !== 'USD') exclusionReason = cost?.currencyCode ? 'Different currency' : 'Missing cost';
        if (!exclusionReason && unitCostMinor === null) exclusionReason = 'Missing cost';
        if (!exclusionReason && cost?.sku && cost.sku !== sku) exclusionReason = 'Catalog SKU changed';
        if (!exclusionReason && !Number.isSafeInteger(unitCostMinor * quantity)) exclusionReason = 'Cost unavailable';
        const known = !exclusionReason;
        const line = {
            lineId: item.id, title: item.title || 'Garment', variantTitle: item.variantTitle || '', sku,
            quantity, shelfQuantity, supplierQuantity: quantity - shelfQuantity,
            unitCostMinor: known ? unitCostMinor : null,
            garmentMinor: known ? unitCostMinor * quantity : null,
            shelfMinor: known ? unitCostMinor * shelfQuantity : null,
            supplierMinor: known ? unitCostMinor * (quantity - shelfQuantity) : null,
            exclusionReason
        };
        if (known) for (const key of Object.keys(totals)) totals[key] += line[key];
        lines.push(line);
    }
    const exclusions = lines.filter(line => line.exclusionReason);
    return { version: 1, source: 'shopify-catalog', orderId: order.id, orderName: order.name,
        currencyCode: 'USD', lookupAt: now, status: exclusions.length ? 'incomplete' : 'complete',
        ...totals, lines, exclusions };
}

export function unavailableEstimate(id, name = '') {
    return { version: 1, source: 'shopify-catalog', orderId: id, orderName: name,
        currencyCode: 'USD', lookupAt: new Date().toISOString(), status: 'unavailable',
        garmentMinor: null, shelfMinor: null, supplierMinor: null, lines: [], exclusions: [] };
}

export function createGarmentCostService({ readOrder, graphql, isPrint, shopKey }) {
    async function resolve(key) {
        const cacheKey = `${shopKey}|${key}`;
        const cached = catalogCache.get(cacheKey);
        if (cached?.expiresAt > Date.now()) return cached.cost;
        if (pendingCatalog.has(cacheKey)) return pendingCatalog.get(cacheKey);
        const promise = (async () => {
            let result;
            if (key.startsWith('variant:')) {
                const id = key.slice(8);
                if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id)) return { reason: 'Catalog variant unavailable' };
                const query = `query PrintMOGarmentVariantCost($id: ID!) {
                    productVariant(id: $id) { id sku inventoryItem { unitCost { amount currencyCode } } }
                }`;
                const response = await graphql(query, { id }, 'PrintMOGarmentVariantCost');
                if (response.errors?.length) throw new Error('Catalog cost unavailable');
                const variant = response.data?.productVariant;
                result = variant ? { ...variant.inventoryItem?.unitCost, sku: variant.sku } : { reason: 'Catalog variant unavailable' };
            } else {
                const sku = key.slice(4);
                const query = `query PrintMOGarmentSkuCost($query: String!) {
                    productVariants(first: 20, query: $query) {
                        nodes { id sku inventoryItem { unitCost { amount currencyCode } } }
                        pageInfo { hasNextPage }
                    }
                }`;
                const response = await graphql(query, { query: `sku:${JSON.stringify(sku)}` }, 'PrintMOGarmentSkuCost');
                if (response.errors?.length) throw new Error('Catalog cost unavailable');
                const connection = response.data?.productVariants;
                const matches = (connection?.nodes || []).filter(variant => variant.sku === sku);
                result = connection?.pageInfo?.hasNextPage || matches.length > 1
                    ? { reason: 'Ambiguous catalog SKU' }
                    : matches.length === 1 ? { ...matches[0].inventoryItem?.unitCost, sku }
                    : { reason: 'No catalog match' };
            }
            if (catalogCache.size > 2000) catalogCache.clear();
            catalogCache.set(cacheKey, { cost: result, expiresAt: Date.now() + COST_TTL_MS });
            return result;
        })();
        pendingCatalog.set(cacheKey, promise);
        try { return await promise; } finally { pendingCatalog.delete(cacheKey); }
    }

    async function bounded(promise, deadline) {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Cost lookup timed out')), Math.max(1, deadline - Date.now()));
        })]); } finally { clearTimeout(timer); }
    }
    async function estimate(id, deadline) {
        try {
            const order = await bounded(readOrder(id), deadline);
            const keys = [...new Set((order.items || []).filter(item => !isPrint(item)).map(item => {
                const sku = String(order.provider === 'etsy' ? item.supplierSku || '' : item.sku || '').trim();
                return !sku ? null : order.provider === 'etsy' ? `sku:${sku}` : `variant:${item.variantId || ''}`;
            }).filter(Boolean))];
            const costs = new Map();
            let lookupFailed = false;
            // Bound upstream concurrency, including orders with many distinct variants.
            for (let start = 0; start < keys.length; start += 4) {
                await Promise.all(keys.slice(start, start + 4).map(async key => {
                    try { costs.set(key, await bounded(resolve(key), deadline)); }
                    catch (_) { lookupFailed = true; costs.set(key, { reason: 'Cost unavailable' }); }
                }));
            }
            const result = estimateGarments(order, costs, isPrint);
            if (lookupFailed) result.lookupFailed = true;
            if (lookupFailed && result.lines.every(line => line.unitCostMinor === null)) {
                result.status = 'unavailable';
                result.garmentMinor = result.shelfMinor = result.supplierMinor = null;
            }
            return result;
        } catch (_) { return unavailableEstimate(id); }
    }

    async function estimates(ids) {
        const results = [];
        // Sequential orders keep the request's Shopify concurrency at four.
        const deadline = Date.now() + 20000;
        for (const id of [...new Set(ids)]) results.push(Date.now() >= deadline ? unavailableEstimate(id) : await estimate(id, deadline));
        return results;
    }
    return { estimates };
}
