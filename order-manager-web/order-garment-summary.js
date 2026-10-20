/* Read-only, bounded garment recognition from the order's existing line items. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrderGarmentSummary = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const palette = {
    black: '#34383e', white: '#faf9f5', gray: '#a3a8ae', navy: '#304665',
    blue: '#477db5', red: '#b94c4d', pink: '#d68aa5', purple: '#806398',
    green: '#567c62', teal: '#4c8e91', yellow: '#e2c76b', orange: '#cf8856',
    brown: '#896b58', tan: '#c9b99b', unknown: '#cbd0d5'
  };
  const families = [
    ['navy', /\b(navy|midnight|deep blue|dark blue|indigo)\b/],
    ['black', /\b(black|onyx|jet|coal|charcoal black)\b/],
    ['white', /\b(white|ivory|natural|cream|bone)\b/],
    ['red', /\b(red|maroon|cardinal|burgundy|crimson|scarlet|wine|cherry)\b/],
    ['pink', /\b(pink|rose|blush|fuchsia|azalea|coral)\b/],
    ['purple', /\b(purple|violet|lavender|lilac|plum|orchid)\b/],
    ['teal', /\b(teal|turquoise|aqua|aquatic)\b/],
    ['green', /\b(green|forest|olive|sage|kelly|lime|mint|moss|military)\b/],
    ['blue', /\b(blue|royal|cobalt|sapphire|denim|carolina|azure)\b/],
    ['yellow', /\b(yellow|gold|mustard|canary|lemon)\b/],
    ['orange', /\b(orange|rust|tangerine|peach|safety orange)\b/],
    ['brown', /\b(brown|chocolate|coffee|espresso|chestnut)\b/],
    ['tan', /\b(tan|khaki|sand|beige|camel|stone)\b/],
    ['gray', /\b(gr[ae]y|charcoal|silver|ash|graphite|heather)\b/]
  ];
  const types = [
    ['hoodie', 'Hoodie', /\b(hoodie|hooded|hooded sweatshirt)\b/],
    ['sweatshirt', 'Sweatshirt', /\b(sweatshirt|crewneck|crew neck|fleece pullover)\b/],
    ['polo', 'Polo', /\bpolo\b/],
    ['longsleeve', 'Long-sleeve shirt', /\blong[ -]?sleeve\b/],
    ['tank', 'Tank', /\b(tank|sleeveless)\b/],
    ['tee', 'T-shirt', /\b(t[ -]?shirt|tee|tees|jersey)\b/],
    ['pants', 'Pants', /\b(pants|jogger|joggers|sweatpants|shorts)\b/],
    ['hat', 'Hat', /\b(hat|cap|beanie)\b/],
    ['bag', 'Bag', /\b(tote|bag|drawstring)\b/]
  ];
  const printNames = /^(?:t-shirt (?:breast|chest|full|full back|half back|back tag|neck tag|sleeve)|(?:full|half) sleeve|hood|sweatpants (?:small logo|half leg|full leg)|hat (?:front|side|back)|drawstring bag full|tote bag (?:small|half|full)|dtf) print$/i;
  const normalize = value => String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const attributes = item => ({
    ...Object.fromEntries((item.customAttributes || []).filter(a => a?.key).map(a => [a.key, a.value])),
    ...(item.properties || {})
  });
  const attribute = (item, keys) => {
    const entries = Object.entries(attributes(item));
    return entries.find(([key]) => keys.includes(normalize(key)))?.[1] || '';
  };
  const groupId = item => String(attribute(item, ['group id', 'designer group id', 'workspace id', 'designer workspace id']));
  function colorFamily(value) {
    const text = normalize(value);
    if (!text || /\b(camo|camouflage|tie dye|multicolou?r|rainbow)\b|\//.test(text)) return 'unknown';
    return families.find(([, pattern]) => pattern.test(text))?.[0] || 'unknown';
  }
  function colorOf(item) {
    const explicit = attribute(item, ['color', 'colour', 'garment color', 'garment colour']);
    if (explicit) return { name: String(explicit), family: colorFamily(explicit) };
    const options = String(item.variantTitle || '').split(/\s*\/\s*|\s*\|\s*/).filter(Boolean);
    const known = options.find(option => colorFamily(option) !== 'unknown');
    return { name: known || '', family: colorFamily(known) };
  }
  function locationOf(value) {
    const text = normalize(value);
    if (/\b(breast|left chest)\b/.test(text)) return 'breast';
    if (/\b(back tag|neck tag)\b/.test(text)) return 'back-neck';
    if (/\bback\b/.test(text)) return 'back';
    if (/\bsleeve\b/.test(text)) return 'sleeve';
    if (/\b(chest|front)\b/.test(text) || text === 't shirt full print') return 'front';
    return '';
  }
  function model(order) {
    const items = (order?.items || []).filter(item => Number(item.qty ?? item.quantity) > 0);
    const groups = new Map(), prints = [];
    let unclassifiedProducts = false;
    for (const item of items) {
      const title = String(item.title || item.name || '').trim();
      if (printNames.test(title)) { prints.push(item); continue; }
      const type = types.find(([, , pattern]) => pattern.test(normalize(title)));
      if (!type) { unclassifiedProducts = true; continue; }
      const color = colorOf(item);
      const key = JSON.stringify([normalize(title), type[0], normalize(color.name)]);
      if (!groups.has(key)) groups.set(key, { type: type[0], typeLabel: type[1], title, color,
        qty: 0, groupIds: new Set(), locations: new Set(), lines: [] });
      const group = groups.get(key);
      group.qty += Number(item.qty ?? item.quantity);
      if (groupId(item)) group.groupIds.add(groupId(item));
      group.lines.push(item);
    }
    const garments = [...groups.values()].sort((a, b) => b.qty - a.qty);
    for (const garment of garments) {
      for (const print of prints) {
        const assigned = groupId(print);
        // No order-wide placement guess when there is more than one garment/color.
        if (assigned ? !garment.groupIds.has(assigned) : garments.length !== 1 || unclassifiedProducts) continue;
        const location = locationOf(print.title);
        if (location) garment.locations.add(location);
      }
      for (const item of garment.lines) {
        for (const asset of item.assets || []) {
          if (!item.id || asset.lineItemId !== item.id) continue;
          const location = locationOf(asset.placement || asset.side);
          if (location && asset.role !== 'mockup') garment.locations.add(location);
        }
      }
    }
    if (!garments.length) return null;
    const garment = garments[0];
    const extra = garments.length - 1;
    return { ...garment, locations: [...garment.locations], fill: palette[garment.color.family],
      stroke: ['black', 'navy', 'purple', 'brown'].includes(garment.color.family) ? '#e3e9ef' : '#4b5563',
      extra, label: [garment.color.name, garment.title].filter(Boolean).join(' · '),
      caption: extra ? `+${extra} garment/color ${extra === 1 ? 'combination' : 'combinations'}` : 'Garment summary · no mockup',
      key: JSON.stringify([garment.title, garment.color, [...garment.locations], extra]) };
  }
  const outlines = {
    tee: 'M30 22 16 29 5 52 22 60 29 47 29 105 71 105 71 47 78 60 95 52 84 29 70 22Q50 35 30 22Z',
    longsleeve: 'M30 22 16 29 3 96 18 100 29 50 29 105 71 105 71 50 82 100 97 96 84 29 70 22Q50 35 30 22Z',
    hoodie: 'M34 23Q30 3 50 3Q70 3 66 23L83 30 97 98 81 102 71 52 71 108 29 108 29 52 19 102 3 98 17 30Z',
    sweatshirt: 'M31 22 17 29 3 98 19 102 29 50 29 108 71 108 71 50 81 102 97 98 83 29 69 22Q50 32 31 22Z',
    polo: 'M32 22 17 29 5 53 22 61 29 47 29 105 71 105 71 47 78 61 95 53 83 29 68 22 56 30 50 26 44 30Z',
    tank: 'M34 19Q50 32 66 19L74 23Q68 42 76 49L71 106 29 106 24 49Q32 42 26 23Z',
    pants: 'M26 20 74 20 81 107 57 107 50 58 43 107 19 107Z',
    hat: 'M18 69Q15 22 49 22Q81 22 82 69L92 78Q58 94 10 77Z',
    bag: 'M30 36V23Q50 2 70 23V36H82L88 108H12L18 36Z'
  };
  function diagram(data, back = false) {
    const markers = [];
    if (['tee', 'longsleeve', 'hoodie', 'sweatshirt', 'polo', 'tank'].includes(data.type)) {
      for (const location of data.locations) {
        if (back && location === 'back') markers.push('<rect x="36" y="42" width="28" height="33" rx="1"/>');
        if (back && location === 'back-neck') markers.push('<rect x="44" y="29" width="12" height="8" rx="1"/>');
        if (!back && location === 'front') markers.push('<rect x="36" y="44" width="28" height="28" rx="1"/>');
        if (!back && location === 'breast') markers.push('<rect x="57" y="39" width="10" height="10" rx="1"/>');
        if (!back && location === 'sleeve') markers.push('<path d="m15 36 8 4-5 12-8-4Z"/>');
      }
    }
    const detail = back ? '<path d="M35 27Q50 32 65 27"/>'
      : data.type === 'hoodie' ? '<path d="M35 23Q50 40 65 23M45 32v13m10-13v13M38 88h24l-4-12H42Z"/>'
        : data.type === 'polo' ? '<path d="m33 23 11 14 6-10 6 10 11-14M50 28v20"/>'
          : '<path d="M35 25Q50 39 65 25"/>';
    return `<svg viewBox="0 0 100 125" aria-hidden="true" focusable="false"><path d="${outlines[data.type]}" fill="${data.fill}" stroke="${data.stroke}" stroke-width="1.5" stroke-linejoin="round"/><g fill="none" stroke="${data.stroke}" stroke-width="1.2">${['hat', 'bag', 'pants'].includes(data.type) ? '' : detail}</g><g fill="#fff" fill-opacity=".8" stroke="#1765c1" stroke-width="1.5">${markers.join('')}</g><text x="50" y="122" text-anchor="middle" fill="#475569" font-family="system-ui,sans-serif" font-size="14">${back ? 'Back' : 'Front'}</text></svg>`;
  }
  return { model, colorFamily, diagram, palette };
});
