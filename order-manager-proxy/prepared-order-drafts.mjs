import { handlePreparedLinkRequest, handlePublicPreparedLinkRequest } from './prepared-order-links.mjs';
// Private admin preparation only. These records are not Shopify Draft Orders,
// public prepared links, paid orders, or a second production-order authority.
const ROOT = 'admin-prepared-orders/v1/';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MAX_JSON = 1024 * 1024;
const MAX_ASSET = 20 * 1024 * 1024;
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const id = value => UUID.test(String(value)) ? String(value).toLowerCase() : fail('INVALID_ID', 'Choose a saved prepared order.');
const gid = (value, kind) => new RegExp(`^gid://shopify/${kind}/\\d+$`).test(String(value));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 200;
const digest = bytes => crypto.subtle.digest('SHA-256', bytes).then(buffer => [...new Uint8Array(buffer)].map(v => v.toString(16).padStart(2, '0')).join(''));
function assetId(value) { return HASH.test(String(value)) ? value : fail('INVALID_ASSET', 'An artwork reference is invalid.'); }
function cleanTrim(value) {
  if (!value) return undefined;
  if (!object(value) || !['none', 'transparency', 'background'].includes(value.mode) || !['none', 'alpha', 'color'].includes(value.basis)) fail('INVALID_TRIM', 'Artwork trim metadata is invalid.');
  const rect = input => {
    if (!object(input) || ![input.x, input.y, input.width, input.height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000)
      || !input.width || !input.height) fail('INVALID_TRIM', 'Artwork trim dimensions are invalid.');
    return { x: input.x, y: input.y, width: input.width, height: input.height };
  };
  return { mode: value.mode, basis: value.basis, naturalWidth: Number(value.naturalWidth), naturalHeight: Number(value.naturalHeight),
    crop: rect(value.crop), paddedCrop: rect(value.paddedCrop), padding: Number(value.padding) || 0, tolerance: Number(value.tolerance) || 0, blank: false };
}
function cleanPrint(print) {
  if (!object(print) || print.type !== 'image' || !['front', 'back', 'breast', 'left', 'right'].includes(print.side)
    || !object(print.design) || !object(print.asset)) fail('INVALID_PROJECT', 'This editor supports uploaded artwork. Open other project types in Designer Studio.');
  const d = print.design;
  if (![d.xIn, d.yIn, d.rotation].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000)
    || !positive(d.wIn) || !positive(d.hIn)) fail('INVALID_PLACEMENT', 'Enter valid artwork dimensions and placement.');
  const trim = cleanTrim(print.trim || print.asset.trim);
  return { id: id(print.id), type: 'image', side: print.side, trim,
    design: { xIn: d.xIn, yIn: d.yIn, wIn: d.wIn, hIn: d.hIn, rotation: d.rotation },
    asset: { assetId: assetId(print.asset.assetId), mime: text(print.asset.mime, 60),
      naturalW: Number(print.asset.naturalW) || 0, naturalH: Number(print.asset.naturalH) || 0, trim },
    flipH: print.flipH === true, flipV: print.flipV === true };
}
export function normalizePreparedDraft(input) {
  if (!object(input) || !Array.isArray(input.items) || input.items.length > 30) fail('INVALID_DRAFT', 'Use up to 30 garment configurations in one prepared order.');
  const used = new Set();
  const items = input.items.map(item => {
    if (!object(item) || !gid(item.productId, 'Product') || !gid(item.variantId, 'ProductVariant')) fail('INVALID_PRODUCT', 'Choose a catalog product and variant.');
    const itemId = id(item.id);
    if (used.has(itemId)) fail('DUPLICATE_ITEM', 'A garment configuration is duplicated.');
    used.add(itemId);
    const project = item.project;
    if (project && (!object(project) || !Array.isArray(project.prints) || project.prints.length > 40)) fail('INVALID_PROJECT', 'Use up to 40 artwork layers per garment.');
    const cleanProject = project ? { version: 1, prints: project.prints.map(cleanPrint),
      activeSide: ['front', 'back', 'breast', 'left', 'right'].includes(project.activeSide) ? project.activeSide : 'front',
      canvasCalibration: object(project.canvasCalibration) ? project.canvasCalibration : null,
      printClassOverrides: Object.fromEntries(Object.entries(object(project.printClassOverrides) ? project.printClassOverrides : {}).filter(([side, value]) =>
        ['front', 'back', 'left', 'right'].includes(side) && object(value) && Number.isSafeInteger(value.variantId) && value.variantId > 0)
        .map(([side, value]) => [side, { variantId: value.variantId, label: text(value.label, 100) }])),
      printSummary: (Array.isArray(project.printSummary) ? project.printSummary : []).slice(0, 4)
        .filter(value => object(value) && ['front', 'back', 'left', 'right'].includes(value.side) && Number.isSafeInteger(value.variantId) && value.variantId > 0)
        .map(value => ({ side: value.side, variantId: value.variantId, label: text(value.label, 100), mode: value.mode === 'manual' ? 'manual' : 'automatic' })) } : null;
    return { id: itemId, productId: item.productId, variantId: item.variantId, handle: text(item.handle, 255),
      title: text(item.title, 180), variantTitle: text(item.variantTitle, 180), color: text(item.color, 100), optionLabel: text(item.optionLabel, 180),
      image: /^https:\/\/cdn\.shopify\.com\//.test(item.image || '') ? item.image : '',
      instructions: text(item.instructions, 1000), project: cleanProject,
      printMode: ['auto', 'manual', 'none'].includes(item.printMode) ? item.printMode : null,
      manualPrints: (Array.isArray(item.manualPrints) ? item.manualPrints : []).slice(0, 4)
        .filter(value => object(value) && ['front', 'back', 'left', 'right'].includes(value.side) && Number.isSafeInteger(value.variantId) && value.variantId > 0)
        .map(value => ({ side: value.side, variantId: value.variantId })),
      proofAssetId: item.proofAssetId ? assetId(item.proofAssetId) : null,
      proofSide: text(item.proofSide, 16), proofKind: item.proofKind === 'garment' ? 'garment' : 'placement-reference' };
  });
  if (!Array.isArray(input.mockups || []) || (input.mockups || []).length > 20) fail('TOO_MANY_MOCKUPS', 'Use up to 20 mockups.');
  return { version: 1, title: text(input.title, 160) || 'Untitled prepared order',
    preparedFor: text(input.preparedFor, 120), customerMessage: text(input.customerMessage, 240), note: text(input.note, 1000), items,
    mockups: (input.mockups || []).map(asset => ({ assetId: assetId(asset.assetId), name: text(asset.name, 160), mime: text(asset.mime, 60),
      itemIds: [...new Set((Array.isArray(asset.itemIds) ? asset.itemIds : []).map(id))].filter(value => used.has(value)) })) };
}
async function limitedBytes(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) fail('TOO_LARGE', 'This upload is too large.', 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = []; let total = 0;
  for (;;) { const part = await reader.read(); if (part.done) break;
    total += part.value.byteLength; if (total > limit) { await reader.cancel(); fail('TOO_LARGE', 'This upload is too large.', 413); } chunks.push(part.value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
function summary(record) { return { id: record.id, title: record.title, preparedFor: record.preparedFor, updatedAt: record.updatedAt, itemCount: record.items.length, mockupCount: record.mockups.length }; }
function collectAssets(draft) { return new Set([...draft.mockups.map(a => a.assetId), ...draft.items.flatMap(item => [item.proofAssetId, ...(item.project?.prints || []).map(p => p.asset.assetId)]).filter(Boolean)]); }
const productFields = `id title handle status featuredMedia { preview { image { url } } }
  designerConfig: metafield(namespace: "custom", key: "designer_config") { value }
  variants(first: 100, after: $variantCursor) { nodes { id title price selectedOptions { name value } media(first: 1) { nodes { preview { image { url } } } } } pageInfo { hasNextPage endCursor } }`;
export const PREPARED_PRODUCT_QUERY = `query PreparedAdminProduct($id: ID!, $variantCursor: String) { product(id: $id) { ${productFields} } }`;
export const PREPARED_CATALOG_QUERY = `query PreparedAdminCatalog($query: String!, $after: String) {
  products(first: 15, query: $query, after: $after, sortKey: TITLE) { nodes { id title handle status featuredMedia { preview { image { url } } } } pageInfo { hasNextPage endCursor } }
}`;
function config(value) { try { const parsed = JSON.parse(value || '{}'); return object(parsed.placements) ? parsed : { placements: {} }; } catch { return { placements: {} }; } }
function productDto(product) { return { id: product.id, title: product.title, handle: product.handle, status: product.status, image: product.featuredMedia?.preview?.image?.url || '' }; }
function catalogData(result) {
  if (result?.ok !== false && result?.data && !result.errors?.length) return result.data;
  const denied = result?.errors?.some(error => error?.extensions?.code === 'ACCESS_DENIED');
  fail(denied ? 'CATALOG_ACCESS_DENIED' : 'CATALOG_UNAVAILABLE', denied
    ? 'Shopify did not allow access to products. Check this app’s product access in Shopify Admin, then retry.'
    : 'Products could not load from Shopify. Try again; your order has not changed.', 502);
}
export function createPreparedDraftService(env, { graphql }) {
  const bucket = env.R2_BUCKET;
  const prefix = `${ROOT}${encodeURIComponent(String(env.SHOPIFY_SHOP_DOMAIN || '').toLowerCase())}/`;
  const key = value => `${prefix}drafts/${id(value)}.json`;
  const assetKey = (draftId, hash) => `${prefix}assets/${id(draftId)}/${assetId(hash)}`;
  async function read(draftId) {
    const stored = await bucket.get(key(draftId));
    if (!stored) fail('DRAFT_NOT_FOUND', 'This prepared order was not found. Return to the list and refresh.', 404);
    return { ...(await stored.json()), revision: stored.etag };
  }
  return {
    async list(cursor) {
      const result = await bucket.list({ prefix: `${prefix}drafts/`, limit: 25, cursor: cursor || undefined, include: ['customMetadata'] });
      const drafts = result.objects.map(entry => { try { return JSON.parse(entry.customMetadata?.summary || 'null'); } catch { return null; } }).filter(Boolean);
      return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), cursor: result.truncated ? result.cursor : null };
    },
    read,
    async save(draftId, body, actor) {
      id(draftId); const mutationId = id(body.mutationId), draft = normalizePreparedDraft(body.draft);
      const previous = await bucket.get(key(draftId)); const existing = previous ? await previous.json() : null;
      if (existing?.mutationId === mutationId) return { ...existing, revision: previous.etag };
      if (previous ? body.expectedRevision !== previous.etag : Boolean(body.expectedRevision)) fail('VERSION_CONFLICT', 'This prepared order changed in another session. Your edits are still here; reopen the saved version before replacing them.', 409);
      for (const hash of collectAssets(draft)) if (!(await bucket.head(assetKey(draftId, hash)))) fail('ASSET_MISSING', 'An artwork upload has not finished. Retry the upload before saving.', 409);
      const record = { ...draft, id: draftId, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: actor, mutationId };
      const stored = await bucket.put(key(draftId), JSON.stringify(record), { onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' }, customMetadata: { summary: JSON.stringify(summary(record)) } });
      if (!stored) fail('VERSION_CONFLICT', 'Another session saved this prepared order first. Your edits are still here.', 409);
      return { ...record, revision: stored.etag };
    },
    async upload(draftId, request) {
      await read(draftId);
      const mime = (request.headers.get('Content-Type') || '').split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(mime)) fail('UNSUPPORTED_IMAGE', 'Use PNG, JPG, WebP or SVG artwork.', 415);
      const bytes = await limitedBytes(request, MAX_ASSET);
      const head = new TextDecoder().decode(bytes.subarray(0, 2048));
      const valid = mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
        : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === 'image/webp' ? String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
        : /<svg[\s>]/i.test(head) && !/<!DOCTYPE|<!ENTITY/i.test(head);
      if (!valid || bytes.length < 8) fail('INVALID_IMAGE', 'This file does not match its image format.', 415);
      const hash = await digest(bytes);
      if (!(await bucket.head(assetKey(draftId, hash)))) {
        const assets = await bucket.list({ prefix: `${prefix}assets/${id(draftId)}/`, limit: 129 });
        if (assets.truncated || assets.objects.length >= 128) fail('ASSET_LIMIT', 'This order has reached its artwork upload limit. Start a separate prepared order.', 413);
      }
      await bucket.put(assetKey(draftId, hash), bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: mime }, customMetadata: { mime } });
      return { assetId: hash, mime, bytes: bytes.length };
    },
    async asset(draftId, hash) {
      await read(draftId); const stored = await bucket.get(assetKey(draftId, hash));
      if (!stored) fail('ASSET_NOT_FOUND', 'This artwork could not be found. Upload it again.', 404);
      return stored;
    },
    async catalog(query, after) {
      const safe = text(query, 120).replace(/["\\\x00-\x1f]/g, ' ');
      const result = catalogData(await graphql(env, PREPARED_CATALOG_QUERY, { query: `(status:active OR status:unlisted)${safe ? ` AND (title:*${safe.replace(/[^\p{L}\p{N} _.-]/gu, ' ').trim().split(/\s+/).join('* AND title:*')}*)` : ''}`, after: after || null }, 'PreparedAdminCatalog'));
      return { products: result.products.nodes.filter(p => ['ACTIVE', 'UNLISTED'].includes(p.status)).map(productDto), ...result.products.pageInfo };
    },
    async product(productId) {
      if (!gid(productId, 'Product')) fail('INVALID_PRODUCT', 'Choose a catalog product.');
      let cursor = null, product, variants = [];
      for (let page = 0; page < 30; page++) {
        const result = catalogData(await graphql(env, PREPARED_PRODUCT_QUERY, { id: productId, variantCursor: cursor }, 'PreparedAdminProduct'));
        product = result.product;
        if (!product || !['ACTIVE', 'UNLISTED'].includes(product.status)) fail('PRODUCT_UNAVAILABLE', 'This product is no longer active or unlisted.', 404);
        variants.push(...product.variants.nodes.map(({ media, ...variant }) => ({ ...variant, image: media?.nodes?.[0]?.preview?.image || null })));
        if (!product.variants.pageInfo.hasNextPage) return { ...productDto(product), config: config(product.designerConfig?.value), variants };
        cursor = product.variants.pageInfo.endCursor;
        if (!cursor) break;
      }
      fail('CATALOG_INCOMPLETE', 'The complete variant list could not load. Retry before selecting a variant.', 503);
    },
  };
}
export async function handlePreparedDraftRequest(request, env, deps, identity, headers) {
  if (!env.R2_BUCKET || !env.SHOPIFY_SHOP_DOMAIN) fail('PREPARATION_UNAVAILABLE', 'Prepared order storage is not configured.', 503);
  const service = createPreparedDraftService(env, deps), url = new URL(request.url);
  const tail = url.pathname.slice('/order-manager/v1/prepared-order-drafts'.length).split('/').filter(Boolean).map(decodeURIComponent);
  const json = value => Response.json(value, { headers: { ...headers, 'Cache-Control': 'no-store' } });
  if (!tail.length && request.method === 'GET') return json(await service.list(url.searchParams.get('cursor')));
  if (tail[0] === 'catalog' && request.method === 'GET') return json(await service.catalog(url.searchParams.get('q'), url.searchParams.get('after')));
  if (tail[0] === 'product' && tail.length === 2 && request.method === 'GET') return json(await service.product(tail[1]));
  if (tail.length === 2 && ['publish', 'link', 'revoke', 'print-choices'].includes(tail[1])) return json(await handlePreparedLinkRequest(request, env, deps, service, tail[0], tail[1]));
  if (tail.length === 1 && request.method === 'GET') return json(await service.read(tail[0]));
  if (tail.length === 1 && request.method === 'PUT') {
    let body; try { body = JSON.parse(new TextDecoder().decode(await limitedBytes(request, MAX_JSON))); } catch (error) { if (error.status) throw error; fail('INVALID_JSON', 'The order details could not be read.'); }
    return json(await service.save(tail[0], body, `${identity.kind}:${identity.subject}`));
  }
  if (tail.length === 2 && tail[1] === 'assets' && request.method === 'POST') return json(await service.upload(tail[0], request));
  if (tail.length === 3 && tail[1] === 'assets' && request.method === 'GET') {
    const asset = await service.asset(tail[0], tail[2]);
    // SVG is always downloaded as bytes, sanitized by the shared editor before
    // rendering, and never exposed as an executable/public SVG document.
    return new Response(asset.body, { headers: { ...headers, 'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  }
  fail('NOT_FOUND', 'This prepared order action is unavailable.', 404);
}
export async function handlePublicPreparedOrderRequest(request, env, deps, headers) {
  const service = createPreparedDraftService(env, deps);
  return Response.json(await handlePublicPreparedLinkRequest(request, env, deps, service), { headers: { ...headers, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
}
