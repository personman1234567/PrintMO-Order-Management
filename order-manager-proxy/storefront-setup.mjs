import {PRINT_TYPES} from './storefront-fulfillment-pricing.mjs';
import { DEFAULT_STOREFRONT_REPORT_PROFILE } from './storefront-report-profiles.mjs';

// Private planning documents and read-only Shopify discovery. No Shopify writes,
// uploads, report activation, owner economics or payment instructions belong here.
const MAX_BYTES = 100 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 400, details) => { throw Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) }); };
const invalid = message => fail('SETUP_INVALID', message);
function string(value, max, label = 'Text') {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) invalid(`${label} is invalid or too long.`);
  return value.trim();
}
function gid(value, kind, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !new RegExp(`^gid://shopify/${kind}/[1-9][0-9]{0,24}$`).test(value)) invalid(`Choose a valid Shopify ${kind.toLowerCase()}.`);
  return value;
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid('The saved setup identity is invalid.'); return value.toLowerCase(); }
function section(value, label) { if (value === undefined) return {}; if (!object(value)) invalid(`${label} is invalid.`); return value; }
function imageUrl(value) {
  const text = string(value, 2048, 'Image URL'); if (!text) return '';
  let url; try { url = new URL(text); } catch { invalid('Use a Shopify CDN image URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.shopify.com' || url.username || url.password || url.port || url.hash) invalid('Use a Shopify CDN image URL.');
  return url.href;
}
function color(value) { const text = string(value, 7, 'Color'); if (text && !/^#[a-f0-9]{6}$/i.test(text)) invalid('Use six-digit hex colors.'); return text; }
function list(value, max, label) { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) invalid(`${label} exceeds its supported limit.`); return value; }
export function normalizeStorefrontSetup(input) {
  if (!object(input) || (input.version !== undefined && input.version !== 1)) invalid('This setup document version is unsupported.');
  let serialized; try { serialized = JSON.stringify(input); } catch { invalid('The setup document is invalid.'); }
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) fail('SETUP_TOO_LARGE', 'Use a setup document smaller than 100 KiB.', 413);
  const owner = section(input.owner, 'Owner'), appearance = section(input.appearance, 'Appearance');
  const product = section(input.product, 'Product'), launch = section(input.launch, 'Launch');
  const selectedVariantIds = [...new Set(list(product.selectedVariantIds, 300, 'Selected variants').map(value => gid(value, 'ProductVariant')))];
  const retailPrices = {}, prices = section(product.retailPrices, 'Retail prices');
  if (Object.keys(prices).length > 300) invalid('Use up to 300 retail prices.');
  for (const key of Object.keys(prices).sort()) {
    gid(key, 'ProductVariant');
    if (!Number.isSafeInteger(prices[key]) || prices[key] < 0 || prices[key] > 100000000) invalid('Enter nonnegative retail prices in minor currency units.');
    retailPrices[key] = prices[key];
  }
  const email = string(owner.email, 254, 'Email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Enter a valid owner email.');
  const photoIds = new Set();
  const photos = list(product.photos, 20, 'Photos').map(value => {
    if (!object(value)) invalid('A photo is invalid.');
    const id = string(value.id, 80, 'Photo identity');
    if (!id || photoIds.has(id)) invalid('Photo identities must be unique.'); photoIds.add(id);
    const url = imageUrl(value.url); if (!url) invalid('Choose a Shopify CDN photo.');
    return { id, url, color: string(value.color, 100, 'Photo color'), view: string(value.view, 80, 'Photo view') };
  });
  return { version: 1, title: string(input.title, 160, 'Title') || 'Untitled storefront',
    collectionId: gid(input.collectionId, 'Collection', true), partnerId: gid(input.partnerId, 'Metaobject', true),
    owner: { name: string(owner.name, 160, 'Owner name'), approver: string(owner.approver, 160, 'Approver'), email },
    appearance: { logoUrl: imageUrl(appearance.logoUrl), desktopBannerUrl: imageUrl(appearance.desktopBannerUrl), mobileBannerUrl: imageUrl(appearance.mobileBannerUrl),
      background: color(appearance.background), text: color(appearance.text), primary: color(appearance.primary), secondary: color(appearance.secondary) },
    product: { title: string(product.title, 200, 'Product title'), designName: string(product.designName, 160, 'Design name'), sourceProductId: gid(product.sourceProductId, 'Product', true),
      selectedVariantIds, retailPrices, printType: product.printType&&PRINT_TYPES[product.printType]?product.printType:'', photos, notes: string(product.notes, 12000, 'Product notes') },
    launch: { approvalNote: string(launch.approvalNote, 4000, 'Approval note'), checkNotes: string(launch.checkNotes, 8000, 'Check notes') } };
}

const PAGE = 'pageInfo { hasNextPage endCursor }';
const REFERENCES = 'partnerReference:metafield(namespace:"custom",key:"partner_reference"){value} partnerCollection:metafield(namespace:"custom",key:"partner_collection"){value}';
const PRODUCT = `id title handle status featuredMedia{preview{image{url}}} ${REFERENCES}`;
const QUERIES = Object.freeze({
  StorefrontSetupCollections: `query StorefrontSetupCollections($after:String){collections(first:50,after:$after){nodes{id title handle partnerReference:metafield(namespace:"custom",key:"partner_reference"){value}} ${PAGE}}}`,
  StorefrontSetupCollectionProducts: `query StorefrontSetupCollectionProducts($id:ID!,$after:String){collection(id:$id){id title partnerReference:metafield(namespace:"custom",key:"partner_reference"){value} products(first:50,after:$after){nodes{${PRODUCT}} ${PAGE}}}}`,
  StorefrontSetupCatalogSearch: `query StorefrontSetupCatalogSearch($query:String!,$after:String){products(first:50,after:$after,query:$query,sortKey:TITLE){nodes{${PRODUCT}} ${PAGE}}}`,
  StorefrontSetupCatalogProduct: `query StorefrontSetupCatalogProduct($id:ID!,$after:String){shop{currencyCode} product(id:$id){${PRODUCT} options{name values} variants(first:100,after:$after){nodes{id title sku price selectedOptions{name value}} ${PAGE}}}}`
});
const reference = field => typeof field?.value === 'string' ? field.value : null;
function cursor(value) { if (value === undefined || value === null || value === '') return null; return string(value, 1024, 'Page cursor'); }
function connection(value, after, max) {
  if (!value || !Array.isArray(value.nodes) || value.nodes.length > max || typeof value.pageInfo?.hasNextPage !== 'boolean'
    || value.nodes.some(node => !node?.id) || new Set(value.nodes.map(node => node.id)).size !== value.nodes.length)
    fail('SETUP_SOURCE_INCOMPLETE', 'Shopify returned incomplete setup data. Retry.', 502);
  const hasNextPage = value.pageInfo.hasNextPage;
  const endCursor = hasNextPage ? value.pageInfo.endCursor : null;
  if (hasNextPage && (typeof endCursor !== 'string' || !endCursor || endCursor.length > 1024 || endCursor === after)) fail('SETUP_SOURCE_INCOMPLETE', 'Shopify returned an invalid next page. Retry.', 502);
  return { nodes: value.nodes, hasNextPage, endCursor };
}
function productDto(product) {
  return { id: product.id, title: product.title || '', handle: product.handle || '', status: product.status || '',
    image: product.featuredMedia?.preview?.image?.url || '', partnerId: reference(product.partnerReference), collectionId: reference(product.partnerCollection) };
}
const partnerProduct = product => Boolean(reference(product.partnerReference) || reference(product.partnerCollection));
function configuredOwner(collection) {
  const owner = DEFAULT_STOREFRONT_REPORT_PROFILE.owners.find(owner => owner.id === 'dr-dallas' && owner.collectionId === collection.id && owner.partnerId === reference(collection.partnerReference));
  return owner ? { id: owner.id, name: owner.name, logoUrl: owner.logoUrl, source: 'configured-fallback' } : null;
}
export function createStorefrontSetupService({ db, shopId, graphql, now = () => new Date() }) {
  if (!db?.prepare || !db?.batch || !Number.isSafeInteger(shopId) || shopId <= 0 || typeof graphql !== 'function') throw new TypeError('Shop-scoped storage and a read-only Shopify adapter are required.');
  const dto = row => ({ id: row.id, revision: row.revision, draft: JSON.parse(row.draft_json), createdAt: row.created_at, updatedAt: row.updated_at });
  const rowFor = id => db.prepare('SELECT * FROM storefront_setup_drafts WHERE shop_id = ? AND id = ?').bind(shopId, id).first();
  async function listDrafts() {
    const rows = await db.prepare(`SELECT id, revision, json_extract(draft_json, '$.title') AS title,
      json_extract(draft_json, '$.collectionId') AS collection_id, created_at, updated_at
      FROM storefront_setup_drafts WHERE shop_id = ? ORDER BY updated_at DESC, id LIMIT 101`).bind(shopId).all();
    return { drafts: (rows.results || []).slice(0, 100).map(row => ({ id: row.id, revision: row.revision, title: row.title, collectionId: row.collection_id, createdAt: row.created_at, updatedAt: row.updated_at })), hasMore: (rows.results || []).length > 100 };
  }
  async function getDraft(id) {
    const row = await rowFor(uuid(id)); if (!row) fail('SETUP_NOT_FOUND', 'This saved storefront setup is unavailable.', 404); return dto(row);
  }
  async function saveDraft(body, actor) {
    if (!object(body) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || !/^[A-Za-z0-9._:-]{8,200}$/.test(body.idempotencyKey || '')) invalid('Refresh the setup before saving.');
    actor = string(actor, 300, 'Operator'); if (!actor) invalid('An authenticated operator is required.');
    const id = uuid(body.id), draft = normalizeStorefrontSetup(body.draft), draftJson = JSON.stringify(draft);
    const request = JSON.stringify({ id, expectedRevision: body.expectedRevision, draft });
    const receipt = () => db.prepare('SELECT request_json, result_json FROM storefront_setup_mutations WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?').bind(shopId, actor, body.idempotencyKey).first();
    const replay = row => { if (row.request_json !== request) fail('IDEMPOTENCY_KEY_REUSE', 'This save key was already used for different setup changes.', 409); return JSON.parse(row.result_json); };
    const previous = await receipt(); if (previous) return replay(previous);
    const current = await rowFor(id);
    if ((current?.revision || 0) !== body.expectedRevision) fail('VERSION_CONFLICT', 'This setup changed on another device. Reload before saving.', 409, { current: current ? dto(current) : null });
    const stamp = now().toISOString(), mutation = crypto.randomUUID();
    const result = { id, revision: body.expectedRevision + 1, draft, createdAt: current?.created_at || stamp, updatedAt: stamp };
    await db.batch([
      db.prepare(`INSERT INTO storefront_setup_drafts (shop_id,id,revision,draft_json,last_mutation_id,updated_by,created_at,updated_at)
        SELECT ?,?,1,?,?,?,?,? WHERE ? = 0 AND NOT EXISTS (SELECT 1 FROM storefront_setup_mutations WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?)
        ON CONFLICT(shop_id,id) DO NOTHING`).bind(shopId, id, draftJson, mutation, actor, stamp, stamp, body.expectedRevision, shopId, actor, body.idempotencyKey),
      db.prepare(`UPDATE storefront_setup_drafts SET revision = revision + 1, draft_json = ?, last_mutation_id = ?, updated_by = ?, updated_at = ?
        WHERE shop_id = ? AND id = ? AND revision = ? AND ? > 0
        AND NOT EXISTS (SELECT 1 FROM storefront_setup_mutations WHERE shop_id = ? AND actor_id = ? AND idempotency_key = ?)`)
        .bind(draftJson, mutation, actor, stamp, shopId, id, body.expectedRevision, body.expectedRevision, shopId, actor, body.idempotencyKey),
      db.prepare(`INSERT INTO storefront_setup_mutations (shop_id,actor_id,idempotency_key,draft_id,request_json,result_json,created_at)
        SELECT ?,?,?,?,?,?,? FROM storefront_setup_drafts WHERE shop_id = ? AND id = ? AND last_mutation_id = ?
        ON CONFLICT(shop_id,actor_id,idempotency_key) DO NOTHING`).bind(shopId, actor, body.idempotencyKey, id, request, JSON.stringify(result), stamp, shopId, id, mutation)
    ]);
    const saved = await receipt(); if (saved) return replay(saved);
    const latest = await rowFor(id); fail('VERSION_CONFLICT', 'This setup changed on another device. Reload before saving.', 409, { current: latest ? dto(latest) : null });
  }
  async function read(operation, variables) {
    let result; try { result = await graphql(QUERIES[operation], variables, operation); } catch { fail('SETUP_SOURCE_UNAVAILABLE', 'Shopify setup data could not load. Retry.', 502); }
    if (result?.errors?.some(error => error.extensions?.code === 'ACCESS_DENIED')) fail('SETUP_SOURCE_ACCESS_DENIED', 'Shopify did not allow this setup read. Reopen Order Manager and retry.', 403);
    if (result?.ok === false || result?.errors?.length || !result?.data || result?.extensions?.search?.some(search => search.warnings?.length)) fail('SETUP_SOURCE_INCOMPLETE', 'Shopify returned incomplete setup data. Retry.', 502);
    return result.data;
  }
  async function collections({ after = null } = {}) {
    after = cursor(after); const data = await read('StorefrontSetupCollections', { after }); const page = connection(data.collections, after, 50);
    return { collections: page.nodes.map(collection => ({ id: collection.id, title: collection.title || '', handle: collection.handle || '', partnerId: reference(collection.partnerReference), configuredOwner: configuredOwner(collection) })), hasNextPage: page.hasNextPage, endCursor: page.endCursor };
  }
  async function collectionProducts({ collectionId, after = null } = {}) {
    collectionId = gid(collectionId, 'Collection'); after = cursor(after);
    const data = await read('StorefrontSetupCollectionProducts', { id: collectionId, after });
    if (!data.collection) fail('SETUP_SOURCE_NOT_FOUND', 'This Shopify collection is unavailable.', 404);
    if (data.collection.id !== collectionId) fail('SETUP_SOURCE_INCOMPLETE', 'Shopify returned an unexpected collection.', 502);
    const page = connection(data.collection.products, after, 50);
    return { collection: { id: collectionId, title: data.collection.title || '', partnerId: reference(data.collection.partnerReference), configuredOwner: configuredOwner(data.collection) }, products: page.nodes.map(productDto), hasNextPage: page.hasNextPage, endCursor: page.endCursor };
  }
  async function catalogSearch({ query = '', after = null } = {}) {
    query = string(query, 120, 'Catalog search'); after = cursor(after);
    // Shopify prefix wildcards must be outside phrase quotes (title:Softstyle*).
    // Give every whitespace-separated value its own field prefix and escape
    // syntax characters, so user text cannot add operators or alter the filter.
    // https://shopify.dev/docs/api/usage/search-syntax
    const terms = query ? query.split(/\s+/u).map(term => `title:${term.replace(/[\\:()"'*<>!=+\-]/g, '\\$&')}*`) : [];
    const filter = '(status:active OR status:unlisted)' + terms.map(term => ` AND ${term}`).join('');
    const data = await read('StorefrontSetupCatalogSearch', { query: filter, after }); const page = connection(data.products, after, 50);
    return { products: page.nodes.filter(product => ['ACTIVE', 'UNLISTED'].includes(product.status) && !partnerProduct(product)).map(productDto), hasNextPage: page.hasNextPage, endCursor: page.endCursor };
  }
  async function catalogProduct({ productId, after = null } = {}) {
    productId = gid(productId, 'Product'); after = cursor(after);
    const data = await read('StorefrontSetupCatalogProduct', { id: productId, after }), product = data.product;
    if (!product) fail('SETUP_SOURCE_NOT_FOUND', 'This catalog product is unavailable.', 404);
    if (product.id !== productId) fail('SETUP_SOURCE_INCOMPLETE', 'Shopify returned an unexpected product.', 502);
    if (partnerProduct(product) || !['ACTIVE', 'UNLISTED'].includes(product.status)) fail('SETUP_CATALOG_PRODUCT_REQUIRED', 'Choose a normal catalog product as the source.', 422);
    const page = connection(product.variants, after, 100);
    return { product: { ...productDto(product), options: product.options || [], currency: data.shop?.currencyCode || null, variants: page.nodes.map(variant => ({ id: variant.id, title: variant.title || '', sku: variant.sku || '', price: variant.price, selectedOptions: variant.selectedOptions || [] })) }, hasNextPage: page.hasNextPage, endCursor: page.endCursor };
  }
  return Object.freeze({ listDrafts, getDraft, saveDraft, collections, collectionProducts, catalogSearch, catalogProduct });
}
