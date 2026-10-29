export const COLOR_FAMILIES = ['Black', 'White', 'Gray', 'Blue', 'Green', 'Red', 'Pink', 'Purple', 'Orange', 'Yellow', 'Brown', 'Beige', 'Multicolor', 'Unmapped'];
const normalized = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function catalogBrand(product) {
  if (product.vendor && !/^(my store|print[ -]?mo)$/i.test(product.vendor)) return product.vendor;
  const named = /^(American Apparel|Comfort Colors|Gildan|Tultex|Shaka Wear|Independent Trading Co\.?|Bella\s*\+\s*Canvas|Devon\s*&\s*Jones|Adidas|Next Level|Hanes|Jerzees|District|Port & Company|Sport-Tek)\b/i.exec(product.title);
  return named?.[1] || (product.title.includes(' - ') ? product.title.split(' - ')[0] : 'Other brands');
}
export function garmentType(product) {
  const value = normalized(`${product.productType || ''} ${product.category?.name || ''} ${product.title}`);
  for (const [test, label] of [[/\bhood(?:ed|ie|ies)?\b/, 'Hoodies'], [/\bpolo\b/, 'Polos'], [/\btank|\bmuscle tee|\bsleeveless/, 'Tanks'], [/crewneck|sweatshirt/, 'Crewnecks'], [/\bt shirts?\b|\btees?\b|\bjersey shirts?\b/, 'T-shirts'], [/jacket|windbreaker|\bvest\b/, 'Outerwear'], [/\bpant|jogger|shorts|legging/, 'Bottoms'], [/\bcap\b|beanie|\bhat\b/, 'Headwear']]) if (test.test(value)) return label;
  return 'Other garments';
}
export function colorFamilies(name, hex, native = []) {
  const aliases = { grey: 'Gray', silver: 'Gray', gold: 'Yellow', beige: 'Beige', multicolor: 'Multicolor', 'multi color': 'Multicolor', 'rose gold': 'Pink' };
  const declared = native.map(value => aliases[normalized(value)] || COLOR_FAMILIES.find(f => normalized(f) === normalized(value))).filter(Boolean);
  if (declared.length) return [...new Set(declared)];
  const text = normalized(name);
  const names = [[/multi|rainbow|camo|camouflage|tie dye/, 'Multicolor'], [/black|onyx/, 'Black'], [/navy|blue|aqua|sapphire|turquoise|teal|denim|indigo/, 'Blue'], [/green|olive|army|kiwi|moss|sage|forest|jade/, 'Green'], [/purple|violet|lavender|lilac|plum/, 'Purple'], [/pink|rose|azalea|fuchsia|coral/, 'Pink'], [/red|maroon|burgundy|cardinal|cherry|scarlet|wine/, 'Red'], [/orange|rust|paprika/, 'Orange'], [/yellow|gold|mustard|citron/, 'Yellow'], [/brown|chocolate|cocoa|espresso/, 'Brown'], [/beige|tan|khaki|sand|cream|natural|ivory|bone/, 'Beige'], [/white/, 'White'], [/gr[ae]y|charcoal|ash|silver|pewter/, 'Gray']];
  for (const [test, family] of names) if (test.test(text)) return [family];
  if (/^#[0-9a-f]{6}$/i.test(hex || '')) {
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255), max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
    if (max < .18) return ['Black']; if (min > .91) return ['White']; if (delta < .08) return ['Gray'];
    const hue = ((max === rgb[0] ? (rgb[1] - rgb[2]) / delta : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4) * 60 + 360) % 360;
    if (hue < 20 || hue >= 345) return ['Red']; if (hue < 48) return [max < .58 ? 'Brown' : min > .55 ? 'Beige' : 'Orange'];
    if (hue < 70) return ['Yellow']; if (hue < 165) return ['Green']; if (hue < 260) return ['Blue']; if (hue < 305) return ['Purple']; return ['Pink'];
  }
  return ['Unmapped'];
}
export function searchWords(value) { return normalized(value).replace(/\bt shirts?\b|\btees?\b/g, 'tshirt').replace(/\bhooded\s+sweatshirts?\b|\bhoodies\b/g, 'hoodie').replace(/\bcrew\s+necks?\b/g, 'crewneck').split(/\s+/).filter(Boolean); }
export function catalogMatch(product, query, filters = {}, skuMatches = new Set()) {
  if (filters.status?.length && !filters.status.includes(product.status)) return -1;
  if (filters.type?.length && !filters.type.includes(product.garmentType)) return -1;
  if (filters.brand?.length && !filters.brand.includes(product.brand)) return -1;
  if (filters.family?.length && !product.colors.some(color => color.families.some(family => filters.family.includes(family)))) return -1;
  const words = searchWords(query), title = searchWords(product.title).join(' '), haystack = searchWords(`${product.title} ${product.brand} ${product.garmentType} ${product.colors.map(c => c.name).join(' ')}`).join(' ');
  if (!words.length) return 0;
  if (skuMatches.has(product.id)) return 100;
  if (!words.every(word => haystack.includes(word))) return -1;
  const style = normalized(product.title.split(' - ').at(-1));
  return normalized(query) === style ? 120 : title === words.join(' ') ? 110 : title.startsWith(words.join(' ')) ? 60 : 20;
}
