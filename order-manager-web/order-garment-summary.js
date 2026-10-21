/* Read-only, bounded garment recognition from the order's existing line items. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrderGarmentSummary = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  // Authored cloth / seam pairs. Dark families keep a darker chromatic seam,
  // rather than reversing the illustration to white linework.
  const colorPairs = {
    black: ['#697581', '#202a35'], white: ['#faf9f5', '#68635a'],
    gray: ['#aeb7c0', '#465361'], navy: ['#6b89ae', '#24364f'],
    blue: ['#78a4ce', '#294e76'], red: ['#c7797b', '#672d3c'],
    pink: ['#dfa6bd', '#79455f'], purple: ['#ad95c5', '#503765'],
    green: ['#96b69d', '#355740'], teal: ['#83b7b9', '#305e65'],
    yellow: ['#e2c76b', '#746023'], orange: ['#dfa571', '#784723'],
    brown: ['#b39985', '#513d32'], tan: ['#c9b99b', '#6d5941'],
    unknown: ['#cbd0d5', '#4b5865']
  };
  const palette = Object.fromEntries(Object.entries(colorPairs).map(([key, pair]) => [key, pair[0]]));
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
    ['sweatshirt', 'Sweatshirt', /\b(sweatshirt|fleece pullover)\b/],
    ['polo', 'Polo', /\bpolo\b/],
    ['longsleeve', 'Long-sleeve shirt', /\blong[ -]?sleeve\b/],
    ['pocket-tee', 'Pocket T-shirt', /\bpocket\b.*\b(t[ -]?shirt|tee)\b|\b(t[ -]?shirt|tee)\b.*\bpocket\b/],
    ['tank', 'Tank', /\b(tank|sleeveless)\b/],
    ['tee', 'T-shirt', /\b(t[ -]?shirt|tee|tees|jersey)\b/],
    ['pants', 'Pants', /\b(pants|jogger|joggers|sweatpants|shorts)\b/],
    ['hat', 'Hat', /\b(hat|cap|beanie)\b/],
    ['bag', 'Bag', /\b(tote|bag|drawstring)\b/]
  ];
  const printNames = /^(?:t-shirt (?:breast|chest|full|full front|full back|half back|back tag|neck tag|sleeve|left sleeve|right sleeve)|(?:full|half|left|right) sleeve|hood|sweatpants (?:small logo|half leg|full leg)|hat (?:front|side|back)|drawstring bag full|tote bag (?:small|half|full)|dtf) print$/i;
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
    if (/\bleft sleeve\b/.test(text)) return 'left-sleeve';
    if (/\bright sleeve\b/.test(text)) return 'right-sleeve';
    if (/\b(breast|left chest)\b/.test(text)) return 'breast';
    if (/\b(back tag|neck tag|back neck)\b/.test(text)) return 'back-tag';
    if (/\bhalf back\b/.test(text)) return 'half-back';
    if (/\bfull back\b/.test(text)) return 'full-back';
    if (/\bback\b/.test(text)) return 'back';
    if (/\bfull sleeve\b/.test(text)) return 'full-sleeve';
    if (/\bhalf sleeve\b/.test(text)) return 'half-sleeve';
    if (/\bsleeve\b/.test(text)) return 'sleeve';
    if (/\bchest\b/.test(text)) return 'chest';
    if (/\bfull front\b/.test(text) || text === 't shirt full print') return 'full-front';
    if (/\bfront\b/.test(text)) return 'front';
    if (text === 'hood print' || text === 'hood') return 'hood';
    if (/\bhat side\b/.test(text)) return 'hat-side';
    return '';
  }
  const placementLabels = {
    breast: 'Breast', chest: 'Chest', front: 'Front', 'full-front': 'Full front',
    back: 'Back', 'full-back': 'Full back', 'half-back': 'Half back', 'back-tag': 'Back tag',
    sleeve: 'Sleeve (side unspecified)', 'full-sleeve': 'Full sleeve (side unspecified)',
    'half-sleeve': 'Half sleeve (side unspecified)', 'left-sleeve': 'Left sleeve',
    'right-sleeve': 'Right sleeve', hood: 'Hood', 'hat-side': 'Hat side'
  };
  function models(order) {
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
        if (print.id && Object.values(order?.printPlacements || {}).some(entry => entry?.printItemId === print.id)) continue;
        const assigned = groupId(print);
        // No order-wide placement guess when there is more than one garment/color.
        if (assigned ? !garment.groupIds.has(assigned) : garments.length !== 1 || unclassifiedProducts) continue;
        const recorded = attribute(print, ['placement', 'print placement', 'print location', 'side']);
        const location = locationOf(recorded) || locationOf(print.title);
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
    const manual = Object.values(order?.printPlacements || {});
    for (const garment of garments) {
      const ids = new Set(garment.lines.map(line => line.id).filter(Boolean));
      for (const entry of manual) {
        if (!entry || !placementLabels[entry.placement] || !entry.garmentLineIds?.some(id => ids.has(id))) continue;
        // Stale assignments to a removed print line never become evidence.
        if (entry.printItemId && !items.some(item => item.id === entry.printItemId)) continue;
        garment.locations.add(entry.placement);
      }
    }
    return garments.map(garment => {
    const extra = garments.length - 1;
    return { ...garment, locations: [...garment.locations], fill: palette[garment.color.family],
      stroke: colorPairs[garment.color.family][1],
      placementText: [...garment.locations].map(location => placementLabels[location]).join(' · '),
      extra, label: [garment.color.name, garment.title].filter(Boolean).join(' · '),
      caption: extra ? `+${extra} garment/color ${extra === 1 ? 'combination' : 'combinations'}` : 'Garment summary · no mockup',
      key: JSON.stringify([garment.title, garment.color, [...garment.locations], extra]) };
    });
  }
  const model = order => models(order)[0] || null;
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
  // Owner-supplied vectors. The T-shirt back's export margins are cropped in
  // the sprite viewBox; the original path geometry remains unchanged.
  const iconSizes = {
    tee: { front: [906, 878], back: [897.2667, 871.0557] },
    'pocket-tee': { front: [806, 790], back: [804, 790] },
    longsleeve: { front: [819, 726], back: [822, 726] },
    sweatshirt: { front: [725, 683], back: [722, 683] },
    hoodie: { front: [924, 845], back: [902, 848] },
    polo: { front: [726, 767], back: [725, 763] },
    hat: { front: [722, 576], side: [860, 551] }
  };
  function markersFor(type, view, locations) {
    const marks = [];
    const add = (location, x, y, width, height, angle = 0) => marks.push({ location, x, y, width, height, angle });
    for (const location of locations) {
      if (type === 'hat') {
        if (view === 'front' && ['front', 'full-front'].includes(location)) add(location, 36, 29, 28, 24);
        if (view === 'side' && location === 'hat-side') add(location, 56, 28, 18, 22);
        continue;
      }
      if (['pants', 'bag'].includes(type)) continue;
      if (view === 'front') {
        if (location === 'breast') add(location, 59, type === 'hoodie' ? 33 : 28, 10, 11);
        if (location === 'chest') add(location, 35, type === 'hoodie' ? 36 : 33, 30, 14);
        if (location === 'full-front') add(location, 34, type === 'hoodie' ? 36 : 31, 32, type === 'hoodie' ? 27 : 43);
        if (location === 'front') add(location, 36, 33, 28, 22);
        // Wearer's left is the viewer's right. Unspecified sleeve sides are
        // named in the caption, not silently assigned to one arm.
        const long = ['hoodie', 'sweatshirt', 'longsleeve'].includes(type);
        if (location === 'left-sleeve') add(location, long ? 80 : 82, long ? 29 : 31, 7, long ? 15 : 10, long ? -12 : -35);
        if (location === 'right-sleeve') add(location, long ? 13 : 11, long ? 29 : 31, 7, long ? 15 : 10, long ? 12 : 35);
      } else if (view === 'back') {
        const upper = type === 'hoodie' ? 35 : 23;
        if (location === 'back-tag') add(location, 45, type === 'hoodie' ? 33 : 12, 10, 7);
        if (location === 'half-back') add(location, 35, upper, 30, 23);
        if (['back', 'full-back'].includes(location)) add(location, 34, upper, 32, type === 'hoodie' ? 45 : 52);
        if (location === 'hood' && type === 'hoodie') add(location, 43, 12, 14, 12);
      }
    }
    return marks;
  }
  function diagram(data, back = false) {
    const view = back ? data.type === 'hat' ? 'side' : 'back' : 'front';
    const size = iconSizes[data.type]?.[view];
    const fill = /^#[a-f\d]{6}$/i.test(data.fill) ? data.fill : palette.unknown;
    const ink = Object.values(colorPairs).find(pair => pair[0] === fill)?.[1] || colorPairs.unknown[1];
    const shadow = '#' + fill.slice(1).match(/../g).map(c => Math.round(parseInt(c, 16) * .83).toString(16).padStart(2, '0')).join('');
    let body, geometry = '';
    if (size) {
      body = `<use href="./Assets/garments/garment-icons.svg?v=5d300a994eea#${data.type}-${view}" width="100" height="110"/>`;
      const scale = Math.min(100 / size[0], 110 / size[1]);
      const width = size[0] * scale, height = size[1] * scale;
      geometry = `translate(${(100 - width) / 2} ${(110 - height) / 2}) scale(${width / 100} ${height / 100})`;
    } else {
      // Categories without supplied artwork retain their existing fallback.
      body = `<path d="${outlines[data.type] || outlines.tee}" fill="${fill}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
    }
    const markers = markersFor(data.type, view, data.locations).map(mark => {
      const rotation = mark.angle ? ` transform="rotate(${mark.angle} ${mark.x + mark.width / 2} ${mark.y + mark.height / 2})"` : '';
      const rect = `x="${mark.x}" y="${mark.y}" width="${mark.width}" height="${mark.height}" rx=".6"${rotation} vector-effect="non-scaling-stroke"`;
      return `<g data-placement="${mark.location}"><title>${placementLabels[mark.location]}</title><rect ${rect} fill="none" stroke="#fff" stroke-width="2.8"/><rect ${rect} fill="#edf5ff" fill-opacity=".45" stroke="#1765c1" stroke-width="1.1"/></g>`;
    }).join('');
    return `<svg viewBox="0 0 100 125" data-garment-view="${view}" aria-hidden="true" focusable="false" style="--garment-fill:${fill};--garment-ink:${ink};--garment-shadow:${shadow}">${body}<g transform="${geometry}">${markers}</g><text x="50" y="122" text-anchor="middle" fill="#475569" font-family="system-ui,sans-serif" font-size="14">${view === 'side' ? 'Side' : back ? 'Back' : 'Front'}</text></svg>`;
  }
  return { model, models, colorFamily, diagram, palette, colorPairs, locationOf, placementLabels, markersFor,
    isPrint: item => printNames.test(String(item.title || '').trim()) };
});
