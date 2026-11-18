// Prepared originals are resolved from immutable snapshot membership, never client URLs.
export const PREPARED_ARTWORK_TRANSPORT = 'prepared-raster-refs-v1';
export const PREPARED_REQUEST_LIMIT = 24*1024*1024;
export const PREPARED_SIDE_LIMIT = 12*1024*1024;
const SOURCE_LIMIT = 20*1024*1024;
const OUTPUT_LIMIT = 32*1024*1024; // Allows one 20 MiB original, with bounded production memory.
const OUTPUT_TOTAL_LIMIT = 64*1024*1024;
const TOKEN = /pm-prepared-asset:[a-f0-9]{64}/g;
const RASTER_MIMES = ['image/png','image/jpeg','image/webp'];
const bytes = value => new TextEncoder().encode(value).length;
export function preparedArtworkError(code,message,details,status=413) {
  return Object.assign(new Error(message),{code,status,details});
}
const packageMessage = 'The artwork and preview files exceed the 24 MB checkout upload limit. Use a smaller new image or contact Print-MO for help. Your quantities are unchanged.';
const allowedSide = side => ['front','back','breast','left','right'].includes(side)?side:'other';
export function preparedPayloadMetrics(body) {
  const size = value => bytes(JSON.stringify(value)||'');
  const sides=[];let itemIndex=0;
  if(body.artwork&&typeof body.artwork==='object')for(const key in body.artwork){
    if(itemIndex>=30)break;
    const item=body.artwork[key];
    if(item&&typeof item==='object'&&!Array.isArray(item))for(const side of ['front','back','breast','left','right'])if(typeof item[side]==='string')sides.push({itemIndex,side,bytes:bytes(item[side])});
    itemIndex++;
  }
  return {artworkBytes:size(body?.artwork),previewBytes:size(body?.previews),frontPreviewBytes:size(body?.frontPreviews),
    sides};
}
export async function readPreparedBody(request) {
  const declared=Number(request.headers.get('Content-Length'))||0;
  request.preparedDiagnostic={stage:'request',declaredBytes:declared,limitBytes:PREPARED_REQUEST_LIMIT};
  const reported=request.headers.get('X-PM-Prepared-Metrics');
  if(reported&&reported.length<=512)try{
    const values=JSON.parse(reported);
    for(const key of ['artworkBytes','previewBytes','frontPreviewBytes','largestSideBytes'])if(Number.isSafeInteger(values[key])&&values[key]>=0&&values[key]<=1024*1024*1024)request.preparedDiagnostic['client'+key[0].toUpperCase()+key.slice(1)]=values[key];
  }catch{ /* Optional numerical hints never affect validation. */ }
  if(declared>PREPARED_REQUEST_LIMIT)throw preparedArtworkError('REQUEST_TOO_LARGE',packageMessage,request.preparedDiagnostic);
  const reader=request.body?.getReader();const chunks=[];let length=0;
  if(reader)try {
    while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;
      request.preparedDiagnostic.requestBytes=length;
      if(length>PREPARED_REQUEST_LIMIT){await reader.cancel();throw preparedArtworkError('REQUEST_TOO_LARGE',packageMessage,request.preparedDiagnostic);}
      chunks.push(part.value);
    }
  }finally{reader.releaseLock();}
  const buffer=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder().decode(buffer));}catch{throw preparedArtworkError('INVALID_JSON','Your order details could not be read. Return to the order and try again.',{stage:'request'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))throw preparedArtworkError('INVALID_JSON','Your order details could not be read. Return to the order and try again.',{stage:'request'},400);
  Object.assign(request.preparedDiagnostic,{requestBytes:length,...preparedPayloadMetrics(body)});
  return body;
}
export function assertPreparedArtworkSize(svg,itemIndex,side) {
  if(typeof svg==='string'&&bytes(svg)>PREPARED_SIDE_LIMIT)throw preparedArtworkError('ARTWORK_TOO_LARGE',
    `The ${side==='breast'?'chest':allowedSide(side)} artwork exceeds the 12 MB limit for new checkout artwork. Use a smaller new image or contact Print-MO for help. Your quantities are unchanged.`,
    {stage:'artwork',itemIndex,side:allowedSide(side),artworkBytes:bytes(svg),limitBytes:PREPARED_SIDE_LIMIT});
}
function references(svg) {
  const matches=[...svg.matchAll(/<image\b[^>]*\s(?:xlink:)?href\s*=\s*(["'])(pm-prepared-asset:([a-f0-9]{64}))\1/g)];
  // Reserved tokens are accepted only in actual image href attributes, not CSS,
  // text, unrelated attributes, malformed hashes, or encoded external URLs.
  const occurrences=svg.match(/pm-prepared-asset:/gi)||[];
  if(matches.length!==occurrences.length||matches.length>40)throw preparedArtworkError('PREPARED_SOURCE_INVALID','A prepared artwork reference could not be verified. Reload the order or contact Print-MO.',{stage:'prepared-source'},400);
  return matches.map(match=>({token:match[2],hash:match[3]}));
}
function originalFor(record,itemId,hash) {
  const item=record.items.find(item=>item.id===itemId);
  // Garment/choice transfers may retain another item's original artwork. Only
  // project sources in THIS immutable snapshot qualify, never arbitrary stored
  // preparation assets, mockups, proofs, or another published order.
  const source=item&&record.items.flatMap(value=>value.project?.prints||[]).find(print=>print.asset?.assetId===hash&&RASTER_MIMES.includes(print.asset.mime));
  if(!source)throw preparedArtworkError('PREPARED_SOURCE_INVALID','A prepared artwork reference does not belong to this item. Reload the order or contact Print-MO.',{stage:'prepared-source'},400);
  return source.asset;
}
async function originalBytes(service,record,asset,beforeRead=()=>{}) {
  const stored=await service.asset(record.id,asset.assetId);
  if(stored.size>SOURCE_LIMIT)throw preparedArtworkError('PREPARED_SOURCE_TOO_LARGE','The prepared artwork needs attention from Print-MO. Contact us with the reference below; your quantities are unchanged.',{stage:'prepared-source',sourceBytes:stored.size,limitBytes:SOURCE_LIMIT});
  if(Number.isSafeInteger(stored.size))beforeRead(stored.size);
  const data=new Uint8Array(await stored.arrayBuffer());
  const mime=stored.httpMetadata?.contentType||stored.customMetadata?.mime;
  const signature=asset.mime==='image/png'?[137,80,78,71,13,10,26,10].every((n,i)=>data[i]===n)
    :asset.mime==='image/jpeg'?data[0]===255&&data[1]===216&&data[2]===255
    :String.fromCharCode(...data.subarray(0,4))==='RIFF'&&String.fromCharCode(...data.subarray(8,12))==='WEBP';
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(!data.length||data.length>SOURCE_LIMIT||mime!==asset.mime||!signature||hash!==asset.assetId)throw preparedArtworkError('PREPARED_SOURCE_INVALID','The prepared artwork could not be verified. Contact Print-MO for help.',{stage:'prepared-source'},409);
  return data;
}
const dataUrlBytes=(asset,length)=>('data:'+asset.mime+';base64,').length+4*Math.ceil(length/3);
function assertOutputSize(length,total) {
  if(length>OUTPUT_LIMIT||total>OUTPUT_TOTAL_LIMIT)throw preparedArtworkError('PREPARED_OUTPUT_TOO_LARGE','The prepared print files need attention from Print-MO before checkout. Contact us with the reference below; your quantities are unchanged.',{stage:'production-artwork',expandedBytes:length,totalExpandedBytes:total,limitBytes:OUTPUT_LIMIT,totalLimitBytes:OUTPUT_TOTAL_LIMIT});
}
/** Preflight all references before Shopify draft creation. Retain sizes, not image buffers. */
export async function validatePreparedReferences(record,files,service) {
  const sizes=new Map();let total=0,sourceBytes=0;
  for(const file of files){if(!file.svg)continue;let expanded=bytes(file.svg);
    for(const {token,hash}of references(file.svg)){
      const asset=originalFor(record,file.itemId,hash);
      if(!sizes.has(hash)){
        if(sizes.size>=64)throw preparedArtworkError('PREPARED_SOURCE_INVALID','This prepared order has too many artwork sources. Contact Print-MO.',{stage:'prepared-source'},400);
        const data=await originalBytes(service,record,asset,length=>assertOutputSize(expanded+dataUrlBytes(asset,length)-token.length,total+expanded+dataUrlBytes(asset,length)-token.length));sizes.set(hash,data.length);sourceBytes+=data.length;
      }
      expanded+=dataUrlBytes(asset,sizes.get(hash))-token.length;
      assertOutputSize(expanded,total+expanded);
    }
    total+=expanded;assertOutputSize(expanded,total);
  }
  return {preparedSourceCount:sizes.size,preparedSourceBytes:sourceBytes,expandedArtworkBytes:total};
}
function base64Parts(data) {
  // Multiples of three avoid intermediate whole-file binary strings.
  const parts=[];for(let at=0;at<data.length;at+=49152)parts.push(btoa(String.fromCharCode(...data.subarray(at,at+49152))));return parts;
}
async function hydratedParts(record,itemId,svg,service) {
  const refs=references(svg);if(!refs.length)return [svg];
  const urls=new Map();let expanded=bytes(svg);
  for(const {token,hash}of refs){
    const asset=originalFor(record,itemId,hash);
    if(!urls.has(token)){
      const data=await originalBytes(service,record,asset,length=>assertOutputSize(expanded+dataUrlBytes(asset,length)-token.length,expanded+dataUrlBytes(asset,length)-token.length));
      urls.set(token,{length:dataUrlBytes(asset,data.length),parts:['data:'+asset.mime+';base64,',...base64Parts(data)]});
    }
    expanded+=urls.get(token).length-token.length;assertOutputSize(expanded,expanded);
  }
  const parts=[];let offset=0;
  for(const match of svg.matchAll(TOKEN)){parts.push(svg.slice(offset,match.index),...urls.get(match[0]).parts);offset=match.index+match[0].length;}
  parts.push(svg.slice(offset));return parts;
}
export async function hydratePreparedSvg(record,itemId,svg,service) {
  return (await hydratedParts(record,itemId,svg,service)).join('');
}
/** Production builds a Blob from chunks, avoiding whole-file data-URL, SVG,
 * UTF-8 and File copies together. Checkout recovery records retain compact refs. */
export async function hydratePreparedSvgBlob(record,itemId,svg,service) {
  return new Blob(await hydratedParts(record,itemId,svg,service),{type:'image/svg+xml'});
}
/** Public-safe diagnostics only. Never log errors, bodies, paths, or bearer/source IDs. */
export function logPreparedFailure(request,error) {
  const requestId=crypto.randomUUID();
  const numeric={};const source={...(request.preparedDiagnostic||{}),...(error.details||{})};
  for(const key of ['declaredBytes','requestBytes','limitBytes','artworkBytes','previewBytes','frontPreviewBytes','clientArtworkBytes','clientPreviewBytes','clientFrontPreviewBytes','clientLargestSideBytes','sourceBytes','expandedBytes','totalExpandedBytes','totalLimitBytes','preparedSourceCount','preparedSourceBytes','expandedArtworkBytes','itemIndex'])if(Number.isFinite(source[key])&&source[key]>=0)numeric[key]=source[key];
  const stage=['request','artwork','prepared-source','production-artwork','checkout'].includes(source.stage)?source.stage:'checkout';
  const sides=Array.isArray(source.sides)?source.sides.slice(0,150).map(value=>({itemIndex:Number(value.itemIndex)||0,side:allowedSide(value.side),bytes:Number(value.bytes)||0})):[];
  const code=/^[A-Z_]{1,64}$/.test(error.code||'')?error.code:'CHECKOUT_UNAVAILABLE';
  const endpoint=/\/(checkout|quote)$/.exec(new URL(request.url).pathname)?.[1]||'read';
  const details={stage,...numeric,...(sides.length?{sides}:{}),...(source.side?{side:allowedSide(source.side)}:{})};
  console.warn('prepared_order_request_failed',JSON.stringify({requestId,endpoint,code,status:error.status||503,...details}));
  error.requestId=requestId;error.details=details;
  return error;
}
