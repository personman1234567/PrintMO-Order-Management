import { normalizeStorefrontSetup } from './storefront-setup.mjs';

export const STOREFRONT_SETUP_SCOPES = Object.freeze(['write_products', 'read_metaobjects', 'write_metaobjects', 'read_metaobject_definitions', 'read_files', 'write_files']);
const fail = (code, message, status = 422) => { throw Object.assign(new Error(message), { code, status }); };
const validId = id => /^[a-f0-9-]{36}$/i.test(id || '') && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
const GID = (value, type) => new RegExp(`^gid://shopify/${type}/[1-9][0-9]{0,24}$`).test(value || '');
const META = 'fields { key type value reference { ... on MediaImage { id fileStatus image { url } } } }';
const BRAND = `id type handle updatedAt ${META} capabilities { publishable { status } } definition { type capabilities { publishable { enabled } } fieldDefinitions { key required type { name } } }`;
const MARKER = 'setupId:metafield(namespace:"printmo_setup",key:"plan_id"){value}';
export const SETUP_EXECUTION_OPERATIONS = Object.freeze({
  access: 'query StorefrontSetupAccess { currentAppInstallation { accessScopes { handle } } }',
  context: `query StorefrontSetupContext($partner:ID!,$collection:ID!){metaobject(id:$partner){${BRAND}} collection(id:$collection){id title handle partner:metafield(namespace:"custom",key:"partner_reference"){value}}}`,
  definition: 'query StorefrontSetupDefinition { metaobjectDefinitionByType(type:"partner_branding") { type capabilities { publishable { enabled } } fieldDefinitions { key required type { name } } } }',
  variantNodes: 'query StorefrontSetupSelectedVariants($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id sku price selectedOptions{name value} product{id status partner:metafield(namespace:"custom",key:"partner_reference"){value} collection:metafield(namespace:"custom",key:"partner_collection"){value}}}}}',
  existing: `query StorefrontSetupExisting($handle:String!,$branding:MetaobjectHandleInput!){productByIdentifier(identifier:{handle:$handle}){id status handle ${MARKER} variants(first:100){nodes{id selectedOptions{name value}} pageInfo{hasNextPage}}} metaobjectByHandle(handle:$branding){${BRAND}} collectionByHandle(handle:$handle){id handle ${MARKER} partner:metafield(namespace:"custom",key:"partner_reference"){value}}}`,
  branding: `mutation StorefrontSetupBranding($handle:MetaobjectHandleInput!,$input:MetaobjectUpsertInput!){metaobjectUpsert(handle:$handle,metaobject:$input){metaobject{id handle capabilities{publishable{status}}} userErrors{field message code}}}`,
  collection: 'mutation StorefrontSetupCollection($input:CollectionInput!){collectionCreate(input:$input){collection{id handle} userErrors{field message}}}',
  product: 'mutation StorefrontSetupProduct($identifier:ProductSetIdentifiers!,$input:ProductSetInput!){productSet(identifier:$identifier,input:$input,synchronous:true){product{id title handle status} userErrors{field message code}}}',
  files: 'query StorefrontSetupFiles($query:String!){files(first:20,query:$query){nodes{... on MediaImage{id alt fileStatus image{url}}}}}',
  stage: 'mutation StorefrontSetupStage($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}',
  fileCreate: 'mutation StorefrontSetupFileCreate($files:[FileCreateInput!]!){fileCreate(files:$files){files{id fileStatus ... on MediaImage{image{url}}} userErrors{field message code}}}',
  file: 'query StorefrontSetupFile($id:ID!){node(id:$id){... on MediaImage{id fileStatus image{url}}}}'
});
const appearanceKeys = { logoUrl: 'logo', desktopBannerUrl: 'hero_banner_desktop', mobileBannerUrl: 'hero_banner_mobile', background: 'background_color', text: 'text_color', primary: 'primary_color', secondary: 'secondary_color' };
const canonicalUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'cdn.shopify.com' ? u.origin + u.pathname : ''; } catch { return ''; } };
const meta = (key, value, type = 'single_line_text_field', namespace = 'printmo_setup') => ({ namespace, key, value, type });
const signature = options => JSON.stringify([...options].sort((a,b) => a.name.localeCompare(b.name)).map(x=>[x.name,x.value]));
export function createStorefrontSetupExecution({db, shopId, graphql, setup, shopDomain, now = () => new Date()}) {
  if (!db?.prepare || !setup?.getDraft || !graphql || !/^[a-z0-9-]+\.myshopify\.com$/.test(shopDomain)) throw new TypeError('Shop-scoped setup execution dependencies are required.');
  async function call(key, variables = {}) {
    let r; try { r = await graphql(SETUP_EXECUTION_OPERATIONS[key], variables, SETUP_EXECUTION_OPERATIONS[key].match(/^(?:query|mutation) ([A-Za-z0-9_]+)/)[1]); } catch { fail('SETUP_SHOPIFY_UNAVAILABLE', 'Shopify could not confirm this action. Retry to reconcile the same draft.', 503); }
    if (r?.errors?.some(e => e.extensions?.code === 'ACCESS_DENIED')) fail('SETUP_ACCESS_REQUIRED', 'Enable Shopify setup access, then retry.', 403);
    if (r?.errors?.length || !r?.data || r.ok === false) fail('SETUP_SHOPIFY_UNAVAILABLE', 'Shopify could not confirm this action. Your saved plan is retained.', 503);
    return r.data;
  }
  async function mutation(key, variables, field) {
    const data = (await call(key, variables))[field];
    if (!data || data.userErrors?.length) fail('SETUP_SHOPIFY_REVIEW', (data?.userErrors || []).map(e=>e.message).join(' ').slice(0,700) || 'Shopify did not confirm this draft. Review the plan and retry.');
    return data;
  }
  async function access() {
    const scopes = (await call('access')).currentAppInstallation?.accessScopes?.map(x=>x.handle) || [];
    const missing = STOREFRONT_SETUP_SCOPES.filter(s => !scopes.includes(s) && !(s.startsWith('read_') && scopes.includes(s.replace('read_', 'write_'))));
    return { ready: missing.length === 0, missing, requested: STOREFRONT_SETUP_SCOPES };
  }
  async function requireAccess() { if (!(await access()).ready) fail('SETUP_ACCESS_REQUIRED', 'Enable Shopify setup access to create branding and product drafts.', 403); }
  async function saved(id, revision) {
    if (!validId(id)) fail('SETUP_INVALID', 'Choose a saved setup plan.', 400);
    const row = await setup.getDraft(id);
    if (revision !== undefined && row.revision !== revision) fail('VERSION_CONFLICT', 'The saved plan changed. Reload it before creating Shopify drafts.', 409);
    return row;
  }
  function validateDefinition(definition) {
    const required = { name:'single_line_text_field', logo:'file_reference', hero_banner_desktop:'file_reference', hero_banner_mobile:'file_reference', background_color:'color', text_color:'color', primary_color:'color', secondary_color:'color' };
    if (definition?.type !== 'partner_branding' || !definition.capabilities?.publishable?.enabled) fail('SETUP_BRANDING_SCHEMA', 'Partner Branding must support Shopify draft status. Review its definition before continuing.');
    for (const [key,type] of Object.entries(required)) if (!definition.fieldDefinitions?.some(f=>f.key===key && f.type?.name===type)) fail('SETUP_BRANDING_SCHEMA', 'The Shopify branding fields changed. Review the definition before continuing.');
    if (definition.fieldDefinitions.some(f=>f.required && !(f.key in required))) fail('SETUP_BRANDING_SCHEMA', 'Partner Branding has an additional required field. Review it before continuing.');
  }
  async function contextFor(draft) {
    if (Boolean(draft.partnerId) !== Boolean(draft.collectionId)) fail('SETUP_OWNER_LINK_REQUIRED', 'Choose both the existing partner and storefront collection, or start a new storefront plan.');
    if (!draft.partnerId) { const def = (await call('definition')).metaobjectDefinitionByType; validateDefinition(def); return { brand:null, collection:null }; }
    const data = await call('context', {partner:draft.partnerId, collection:draft.collectionId});
    if (!data.metaobject || !data.collection || data.metaobject.id !== draft.partnerId || data.collection.id !== draft.collectionId || data.collection.partner?.value !== draft.partnerId) fail('SETUP_OWNER_LINK_MISMATCH', 'The storefront collection no longer matches this partner. Review the Shopify references.');
    validateDefinition(data.metaobject.definition);
    return {brand:data.metaobject, collection:data.collection};
  }
  async function loadBranding(id) {
    await requireAccess(); const row = await saved(id), {brand} = await contextFor(row.draft);
    if (!brand) return {appearance:null, name:'', source:'new-storefront'};
    const fields = new Map(brand.fields.map(f=>[f.key,f])); const appearance = {};
    for (const [key,fieldKey] of Object.entries(appearanceKeys)) appearance[key] = key.endsWith('Url') ? fields.get(fieldKey)?.reference?.image?.url || '' : fields.get(fieldKey)?.value || '';
    return {name:fields.get('name')?.value || '', appearance, source:'shopify', updatedAt:brand.updatedAt};
  }
  const executionRow = id => db.prepare('SELECT * FROM storefront_setup_execution WHERE shop_id=? AND draft_id=?').bind(shopId,id).first();
  async function result(id) { await saved(id); const row=await executionRow(id); if(!row)return {state:'not-created'}; const value={revision:row.revision,state:row.state,...JSON.parse(row.result_json)}; if(value.branding?.id)value.branding.adminUrl=`https://admin.shopify.com/store/${shopDomain.split('.')[0]}/content/metaobjects/entries/partner_branding/${value.branding.id.split('/').pop()}`; return value; }
  async function sourceVariants(draft) {
    if (!draft.product.title || !draft.owner.name || !draft.product.sourceProductId || !draft.product.selectedVariantIds.length) fail('SETUP_DETAILS_REQUIRED', 'Add the storefront name, product title, source garment and offered options first.');
    const ids=draft.product.selectedVariantIds; if(ids.length>100) fail('SETUP_VARIANT_LIMIT','Choose up to 100 variants for one draft product.');
    if (ids.some(id=>!Number.isSafeInteger(draft.product.retailPrices[id]) || draft.product.retailPrices[id]<=0)) fail('SETUP_PRICE_REQUIRED','Set a positive retail price for every selected variant.');
    const data=await call('variantNodes',{ids}),variants=data.nodes;
    if (!Array.isArray(variants) || variants.length!==ids.length || variants.some((v,i)=>!v || v.id!==ids[i] || v.product?.id!==draft.product.sourceProductId || !['ACTIVE','UNLISTED'].includes(v.product.status) || v.product.partner?.value || v.product.collection?.value || !v.selectedOptions?.length)) fail('SETUP_SOURCE_CHANGED','Selected variants must belong to the same available normal catalog garment. Review the source options.');
    return variants;
  }
  async function imageFile(url, known) {
    const canonical=canonicalUrl(url); if(!canonical)fail('SETUP_IMAGE_INVALID','Use a Shopify CDN image from this shop.');
    if (known.has(canonical)) return known.get(canonical);
    const filename=decodeURIComponent(new URL(canonical).pathname.split('/').pop());
    if (!/^[a-zA-Z0-9_.-]{1,255}$/.test(filename)) fail('SETUP_IMAGE_INVALID','Upload this image through the workspace before using it.');
    const files=(await call('files',{query:`filename:${filename}`})).files?.nodes || [];
    const match=files.find(f=>canonicalUrl(f.image?.url)===canonical && f.fileStatus==='READY');
    if(!match)fail('SETUP_IMAGE_NOT_READY','An image is unavailable or still processing. Upload it here or wait, then retry.');known.set(canonical,match.id);return match.id;
  }
  function owned(existing, planId) { if(existing && (existing.setupId?.value!==planId || existing.status!=='DRAFT' || existing.variants?.pageInfo?.hasNextPage))fail('SETUP_DRAFT_OWNERSHIP','The target product was edited, published or is not owned by this setup. Review it in Shopify; no changes were made.',409); }
  async function execute(id, body, actor, {reuseExistingBranding=false} = {}) {
    if(!Number.isSafeInteger(body?.expectedRevision)||body.expectedRevision<1||body.confirmDraftOnly!==true)fail('SETUP_REVIEW_REQUIRED','Save and review this plan before creating unpublished drafts.',400);
    await requireAccess(); const row=await saved(id,body.expectedRevision),draft=normalizeStorefrontSetup(row.draft);
    const previous=await executionRow(id); if(previous?.state==='complete' && previous.revision===row.revision) return result(id);
    // Validate all mutable inputs before creating anything in Shopify.
    const context=await contextFor(draft), variants=await sourceVariants(draft), known=new Map();
    for(const field of context.brand?.fields || []) if(field.reference?.image?.url && field.reference.fileStatus==='READY')known.set(canonicalUrl(field.reference.image.url),field.reference.id);
    const fields=[{key:'name',value:draft.owner.name}];
    for(const [key,fieldKey] of Object.entries(appearanceKeys)){const value=draft.appearance[key];if(value)fields.push({key:fieldKey,value:key.endsWith('Url')?await imageFile(value,known):value});}
    const files=[];for(const photo of draft.product.photos){const fileId=await imageFile(photo.url,known);if(!files.some(x=>x.id===fileId))files.push({id:fileId});}
    const handle='printmo-setup-'+id, brandingHandle={type:'partner_branding',handle};
    const existing=await call('existing',{handle,branding:brandingHandle});owned(existing.productByIdentifier,id);
    if(!reuseExistingBranding && existing.metaobjectByHandle?.capabilities?.publishable?.status && existing.metaobjectByHandle.capabilities.publishable.status!=='DRAFT')fail('SETUP_BRANDING_ALREADY_ACTIVE','The setup branding was activated in Shopify. Review it there before continuing.',409);
    const milliseconds=now().getTime(),lease=crypto.randomUUID(),stamp=now().toISOString();
    const claim=await db.prepare(`INSERT INTO storefront_setup_execution(shop_id,draft_id,revision,state,lease_id,lease_until,result_json,updated_by,updated_at) SELECT ?,?,?,'running',?,?,'{}',?,? WHERE EXISTS(SELECT 1 FROM storefront_setup_drafts d WHERE d.shop_id=? AND d.id=? AND d.revision=?) ON CONFLICT(shop_id,draft_id) DO UPDATE SET revision=excluded.revision,state='running',lease_id=excluded.lease_id,lease_until=excluded.lease_until,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE storefront_setup_execution.lease_until < ? AND EXISTS(SELECT 1 FROM storefront_setup_drafts d WHERE d.shop_id=? AND d.id=? AND d.revision=?)`).bind(shopId,id,row.revision,lease,milliseconds+120000,actor,stamp,shopId,id,row.revision,milliseconds,shopId,id,row.revision).run();
    if(!claim.meta?.changes)fail('SETUP_EXECUTION_BUSY','This setup is already creating drafts, or the plan changed. Wait and reload its result.',409);
    let output=previous?.result_json ? JSON.parse(previous.result_json) : {};
    const checkpoint=async state=>db.prepare('UPDATE storefront_setup_execution SET state=?,result_json=?,lease_until=?,updated_at=? WHERE shop_id=? AND draft_id=? AND lease_id=?').bind(state,JSON.stringify(output),state==='running'?now().getTime()+120000:0,now().toISOString(),shopId,id,lease).run();
    try {
      if(reuseExistingBranding && (!draft.partnerId || !draft.collectionId))fail('SETUP_OWNER_LINK_REQUIRED','Choose a managed storefront before creating a product.');
      const brand = reuseExistingBranding ? {metaobject:{id:context.brand.id,capabilities:context.brand.capabilities}} : await mutation('branding',{handle:brandingHandle,input:{fields,capabilities:{publishable:{status:'DRAFT'}}}},'metaobjectUpsert');
      if(!brand.metaobject?.id || !reuseExistingBranding && brand.metaobject.capabilities?.publishable?.status!=='DRAFT')fail('SETUP_BRANDING_NOT_DRAFT','Shopify did not confirm draft branding. Review the result before retrying.',503);
      output.branding={id:brand.metaobject.id,status:brand.metaobject.capabilities?.publishable?.status||'DRAFT',adminUrl:`https://admin.shopify.com/store/${shopDomain.split('.')[0]}/content/metaobjects/entries/partner_branding/${brand.metaobject.id.split('/').pop()}`};await checkpoint('running');
      let collectionId=draft.collectionId;
      if(!collectionId){let collection=existing.collectionByHandle;if(collection && (collection.setupId?.value!==id || collection.partner?.value!==brand.metaobject.id))fail('SETUP_COLLECTION_OWNERSHIP','The setup collection does not match this plan.',409);
        if(!collection)collection=(await mutation('collection',{input:{title:draft.owner.name,handle,templateSuffix:'partner-storefront',metafields:[meta('plan_id',id),meta('partner_reference',brand.metaobject.id,'metaobject_reference','custom')]}},'collectionCreate')).collection;
        if(!collection?.id)fail('SETUP_COLLECTION_UNCONFIRMED','Shopify did not confirm the unpublished collection. Retry to reconcile.',503);collectionId=collection.id;
      }
      output.collection={id:collectionId,existing:Boolean(draft.collectionId)};await checkpoint('running');
      const partnerId=draft.partnerId||brand.metaobject.id;
      const variantImage = v => { const color=v.selectedOptions.find(o=>/^(color|colour)$/i.test(o.name))?.value; if(!color)return {}; const photos=draft.product.photos.filter(p=>p.color.trim().toLowerCase()===color.toLowerCase()); const photo=photos.find(p=>/^front$/i.test(p.view))||photos[0]; return photo ? {file:{id:known.get(canonicalUrl(photo.url))}} : {}; }; 
      const oldVariants=new Map((existing.productByIdentifier?.variants?.nodes||[]).map(v=>[signature(v.selectedOptions),v.id]));
      const options=[];for(const variant of variants)for(const option of variant.selectedOptions){let entry=options.find(o=>o.name===option.name);if(!entry){entry={name:option.name,position:options.length+1,values:[]};options.push(entry);}if(!entry.values.some(v=>v.name===option.value))entry.values.push({name:option.value});}
      const prices=draft.product.retailPrices;
      const refreshed=await call('existing',{handle,branding:brandingHandle});owned(refreshed.productByIdentifier,id);
      const product=await mutation('product',{identifier:{handle},input:{handle,title:draft.product.title,status:'DRAFT',productOptions:options,collections:[collectionId],...(files.length?{files}:{}),metafields:[meta('plan_id',id),meta('source_product',draft.product.sourceProductId,'product_reference'),meta('partner_reference',partnerId,'metaobject_reference','custom'),meta('partner_collection',collectionId,'collection_reference','custom')],variants:variants.map(v=>({...oldVariants.has(signature(v.selectedOptions))?{id:oldVariants.get(signature(v.selectedOptions))}:{},...variantImage(v),sku:v.sku,price:(prices[v.id]/100).toFixed(2),optionValues:v.selectedOptions.map(o=>({optionName:o.name,name:o.value})),metafields:[meta('source_variant',v.id,'variant_reference')]}))}},'productSet');
      if(!product.product?.id || product.product.status!=='DRAFT')fail('SETUP_PRODUCT_NOT_DRAFT','Shopify did not confirm an unpublished draft. Review the result before retrying.',503);
      output.product={...product.product,adminUrl:`https://admin.shopify.com/store/${shopDomain.split('.')[0]}/products/${product.product.id.split('/').pop()}`};output.sourceProductId=draft.product.sourceProductId;output.variantCount=variants.length;output.message='Branding and product drafts are ready in Shopify. Nothing was published.';await checkpoint('complete');return result(id);
    }catch(error){output.message=error.status<500?error.message:'Shopify could not confirm the entire action. Retry reconciles the same setup handles.';await checkpoint('needs-review');throw error;}
  }
  async function stageUpload(id,body) {
    await requireAccess();await saved(id);
    if(!validId(body.id)||!['image/png','image/jpeg','image/webp'].includes(body.mimeType)||!Number.isSafeInteger(body.size)||body.size<1||body.size>20*1024*1024)fail('SETUP_UPLOAD_INVALID','Choose a PNG, JPEG or WebP image up to 20 MB.',400);
    const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[body.mimeType],filename=`printmo-setup-${body.id}.${ext}`;
    const data=await mutation('stage',{input:[{filename,mimeType:body.mimeType,fileSize:String(body.size),resource:'IMAGE',httpMethod:'POST'}]},'stagedUploadsCreate');const target=data.stagedTargets?.[0];
    if(!target?.url||!target.resourceUrl)fail('SETUP_UPLOAD_UNAVAILABLE','Shopify could not prepare the image upload.',503);
    const endpoint=new URL(target.url);if(endpoint.protocol!=='https:'||!(/(^|\.)(shopify\.com|googleapis\.com|amazonaws\.com)$/.test(endpoint.hostname)))fail('SETUP_UPLOAD_UNAVAILABLE','Shopify returned an unsupported upload target.',503);
    await db.prepare('INSERT INTO storefront_setup_uploads(shop_id,draft_id,id,filename,resource_url,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(shop_id,draft_id,id) DO UPDATE SET resource_url=excluded.resource_url WHERE storefront_setup_uploads.file_id IS NULL').bind(shopId,id,body.id,filename,target.resourceUrl,now().toISOString()).run();return {id:body.id,target};
  }
  async function finishUpload(id,uploadId) {
    await requireAccess();await saved(id);if(!validId(uploadId))fail('SETUP_UPLOAD_INVALID','This image upload is invalid.',400);
    const row=await db.prepare('SELECT * FROM storefront_setup_uploads WHERE shop_id=? AND draft_id=? AND id=?').bind(shopId,id,uploadId).first();if(!row)fail('SETUP_UPLOAD_NOT_FOUND','Start this image upload again.',404);
    let fileId=row.file_id;
    if(!fileId){const found=(await call('files',{query:`filename:${row.filename}`})).files?.nodes||[];fileId=found.find(f=>f.alt==='Print-MO setup upload '+uploadId || (f.image?.url && decodeURIComponent(new URL(f.image.url).pathname).endsWith('/'+row.filename)))?.id;
      if(!fileId){const response=await mutation('fileCreate',{files:[{filename:row.filename,alt:'Print-MO setup upload '+uploadId,originalSource:row.resource_url,contentType:'IMAGE',duplicateResolutionMode:'RAISE_ERROR'}]},'fileCreate');fileId=response.files?.[0]?.id;}
      if(!GID(fileId,'MediaImage'))fail('SETUP_UPLOAD_PROCESSING','The image could not be confirmed yet. Retry the same upload.',503);await db.prepare('UPDATE storefront_setup_uploads SET file_id=? WHERE shop_id=? AND draft_id=? AND id=?').bind(fileId,shopId,id,uploadId).run();
    }
    const file=(await call('file',{id:fileId})).node;if(file?.fileStatus==='FAILED')fail('SETUP_UPLOAD_FAILED','Shopify could not process this image. Choose another file.');
    return {id:uploadId,fileId,state:file?.fileStatus||'PROCESSING',url:file?.fileStatus==='READY'?file.image?.url||null:null};
  }
  return Object.freeze({access,loadBranding,result,execute,stageUpload,finishUpload});
}
