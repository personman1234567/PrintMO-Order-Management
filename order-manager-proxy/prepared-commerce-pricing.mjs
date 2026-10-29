// Generated from canonical Designer pricing by scripts/build-placement-editor.js.
// ../Print-MO Website/Shopify Website/designer/src/lib/geometry.ts
function rotAabb(print) {
  return rotSubRectAabb(print, { x: 0, y: 0, w: print.design.wIn, h: print.design.hIn });
}
function rotSubRectAabb(print, rect) {
  const { xIn, yIn, wIn, hIn, rotation } = print.design;
  const cx = xIn + wIn / 2;
  const cy = yIn + hIn / 2;
  const corners = [
    { x: xIn + rect.x, y: yIn + rect.y },
    { x: xIn + rect.x + rect.w, y: yIn + rect.y },
    { x: xIn + rect.x + rect.w, y: yIn + rect.y + rect.h },
    { x: xIn + rect.x, y: yIn + rect.y + rect.h }
  ].map((pt) => rotatePointAround(pt, { x: cx, y: cy }, rotation));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function unionOf(rects) {
  const u = rects.reduce(
    (acc, r) => ({
      x: Math.min(acc.x, r.x),
      y: Math.min(acc.y, r.y),
      r: Math.max(acc.r, r.x + r.w),
      b: Math.max(acc.b, r.y + r.h)
    }),
    { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity }
  );
  return { wIn: Math.max(0, u.r - u.x), hIn: Math.max(0, u.b - u.y) };
}
function rotatePointAround(point, pivot, rotationDeg) {
  const rad = rotationDeg * Math.PI / 180;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos
  };
}

// ../Print-MO Website/Shopify Website/designer/src/domain/workspace/placement.ts
var SIDE_MAP = {
  front: ["breast", "chest", "front_full"],
  back: ["back_tag", "back_half", "back_full"],
  breast: ["breast"],
  // Map both left/right to sleeve placement unless specific keys exist
  left: ["left", "sleeve_left", "sleeve"],
  right: ["right", "sleeve_right", "sleeve"]
};
var FRONT_BACK_TIER_KEY_PATTERN = /^(tote|koozie|kozzie|hat)[_-]/i;
var FRONT_TIER_SUFFIX_PATTERN = /(?:[_-])front$/i;
var BACK_TIER_SUFFIX_PATTERN = /(?:[_-])back$/i;
function isTieredFrontBackPlacementKey(key) {
  return FRONT_BACK_TIER_KEY_PATTERN.test(String(key || ""));
}
function tieredPlacementSupportsSide(key, side) {
  if (side !== "front" && side !== "back") return false;
  const normalizedKey = String(key || "");
  if (FRONT_TIER_SUFFIX_PATTERN.test(normalizedKey)) return side === "front";
  if (BACK_TIER_SUFFIX_PATTERN.test(normalizedKey)) return side === "back";
  return true;
}
function placementKeysForSide(placements, side) {
  const safePlacements = placements || {};
  const baseKeys = (SIDE_MAP[side] || []).filter((key) => safePlacements[key]);
  if (baseKeys.length > 0 || side !== "front" && side !== "back") return baseKeys;
  return Object.keys(safePlacements).filter((key) => isTieredFrontBackPlacementKey(key) && tieredPlacementSupportsSide(key, side)).sort((a, b) => {
    const areaA = (Number(safePlacements[a]?.wIn) || 0) * (Number(safePlacements[a]?.hIn) || 0);
    const areaB = (Number(safePlacements[b]?.wIn) || 0) * (Number(safePlacements[b]?.hIn) || 0);
    return areaA - areaB || a.localeCompare(b);
  });
}
function selectPlacement(placements, side, wIn, hIn) {
  const safePlacements = placements || {};
  const keys = placementKeysForSide(safePlacements, side);
  const eligible = keys.map((key) => ({ key, placement: safePlacements[key] })).filter(
    ({ placement }) => wIn >= (placement.minWIn ?? 0) && hIn >= (placement.minHIn ?? 0)
  );
  if (!eligible.length) return null;
  eligible.sort(
    (a, b) => b.placement.wIn * b.placement.hIn - a.placement.wIn * a.placement.hIn
  );
  return eligible[0];
}
function selectTieredPlacementByArea(placements, side, areaIn2) {
  if (side !== "front" && side !== "back") return null;
  const safePlacements = placements || {};
  const area = Math.max(0, Number(areaIn2) || 0);
  if (!(area > 0)) return null;
  const tiers = placementKeysForSide(safePlacements, side).filter((key) => isTieredFrontBackPlacementKey(key)).map((key) => {
    const placement = safePlacements[key];
    const tierArea = Math.max(0, (Number(placement.wIn) || 0) * (Number(placement.hIn) || 0));
    return { key, placement, tierArea };
  }).filter(({ tierArea }) => tierArea > 0).sort((a, b) => a.tierArea - b.tierArea || a.key.localeCompare(b.key));
  if (!tiers.length) return null;
  const selected = tiers.find((tier) => area <= tier.tierArea) || tiers[tiers.length - 1];
  return { key: selected.key, placement: selected.placement };
}

// ../Print-MO Website/Shopify Website/designer/src/domain/workspace/printPricing.ts
var PRINT_AREA_PRICING = {
  front: [
    { maxArea: 25, variantId: 46714190135544, label: "Breast Print" },
    { maxArea: 112, variantId: 46714190168312, label: "Chest Print" },
    { maxArea: Infinity, variantId: 46714190201080, label: "Full Front Print" }
  ],
  back: [
    { maxArea: 16, variantId: 46714190233848, label: "Back Tag" },
    { maxArea: 112, variantId: 46714190266616, label: "Half Back Print" },
    { maxArea: Infinity, variantId: 46714190299384, label: "Full Back Print" }
  ],
  left: [
    { maxArea: Infinity, variantId: 46714190332152, label: "Short Sleeve Print" }
  ],
  right: [
    { maxArea: Infinity, variantId: 46714190332152, label: "Short Sleeve Print" }
  ]
};
function resolvePrintVariantByArea(side, areaIn2) {
  const rules = PRINT_AREA_PRICING[side];
  if (!rules || !rules.length) return void 0;
  const area = Math.max(0, areaIn2 || 0);
  for (const rule of rules) {
    if (area <= rule.maxArea) return rule;
  }
  return rules[rules.length - 1];
}
var DEFAULT_CANVAS_REFERENCE_WIDTH_IN = 14;
function approxEq(a, b, eps = 0.01) {
  if (a === null || b === null) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= eps * scale;
}
function unionArea(rects) {
  if (!rects.length) return 0;
  const events = [];
  rects.forEach((rect, idx) => {
    const x1 = rect.x;
    const y1 = rect.y;
    const x2 = rect.x + rect.w;
    const y2 = rect.y + rect.h;
    if (!(x2 > x1 && y2 > y1)) return;
    events.push({ x: x1, type: 1, y1, y2, id: idx });
    events.push({ x: x2, type: -1, y1, y2, id: idx });
  });
  if (!events.length) return 0;
  events.sort((a, b) => a.x === b.x ? a.type - b.type : a.x - b.x);
  const active = /* @__PURE__ */ new Map();
  let prevX = events[0]?.x ?? 0;
  let area = 0;
  const computeCoveredY = () => {
    if (!active.size) return 0;
    const segments = Array.from(active.values()).map((seg) => ({ y1: Math.min(seg.y1, seg.y2), y2: Math.max(seg.y1, seg.y2) })).filter((seg) => seg.y2 > seg.y1).sort((a, b) => a.y1 - b.y1);
    if (!segments.length) return 0;
    let total = 0;
    let curStart = segments[0].y1;
    let curEnd = segments[0].y2;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.y1 > curEnd) {
        total += curEnd - curStart;
        curStart = seg.y1;
        curEnd = seg.y2;
      } else {
        curEnd = Math.max(curEnd, seg.y2);
      }
    }
    total += curEnd - curStart;
    return total;
  };
  for (const event of events) {
    const dx = event.x - prevX;
    if (dx > 0) {
      const coveredY = computeCoveredY();
      if (coveredY > 0) {
        area += dx * coveredY;
      }
    }
    if (event.type === 1) {
      active.set(event.id, { y1: event.y1, y2: event.y2 });
    } else {
      active.delete(event.id);
    }
    prevX = event.x;
  }
  return area;
}
function applyTrimToDesign(design, trim, naturalWidthHint, naturalHeightHint) {
  if (!trim) return design;
  if (trim.blank) return design;
  const padded = trim.paddedCrop || trim.crop;
  if (!padded || !(padded.width > 0 && padded.height > 0)) return design;
  const naturalWidth = Math.max(0, Number(trim.naturalWidth ?? naturalWidthHint) || 0);
  const naturalHeight = Math.max(0, Number(trim.naturalHeight ?? naturalHeightHint) || 0);
  if (!(naturalWidth > 0 && naturalHeight > 0)) return design;
  const trimmedWidthRatio = padded.width / naturalWidth;
  const trimmedHeightRatio = padded.height / naturalHeight;
  if (!(trimmedWidthRatio > 0 && trimmedHeightRatio > 0)) return design;
  const designAspect = design.wIn > 0 && design.hIn > 0 ? design.wIn / design.hIn : null;
  const naturalAspect = naturalWidth / naturalHeight;
  const trimmedAspect = padded.width / padded.height;
  if (designAspect !== null && approxEq(designAspect, naturalAspect) && !approxEq(designAspect, trimmedAspect)) {
    const cx = design.xIn + design.wIn / 2;
    const cy = design.yIn + design.hIn / 2;
    const nextW = design.wIn * trimmedWidthRatio;
    const nextH = design.hIn * trimmedHeightRatio;
    return {
      xIn: cx - nextW / 2,
      yIn: cy - nextH / 2,
      wIn: nextW,
      hIn: nextH,
      rotation: design.rotation
    };
  }
  return design;
}
function derivePrintPricingForDesign(options) {
  const {
    prints,
    safeAreaWidthInBySide,
    canvasReferenceWidthIn = DEFAULT_CANVAS_REFERENCE_WIDTH_IN,
    canvasReferenceWidthInBySide,
    placements,
    coverageMode = "trimmed-rect"
  } = options;
  const resolvedPrints = Array.isArray(prints) ? prints : [];
  if (!resolvedPrints.length) return [];
  const safeWidths = safeAreaWidthInBySide || {};
  const referenceWidths = canvasReferenceWidthInBySide || {};
  const referenceWidthIn = Math.max(1e-3, Number(canvasReferenceWidthIn) || DEFAULT_CANVAS_REFERENCE_WIDTH_IN);
  const coverageRectsBySide = {
    front: [],
    back: [],
    left: [],
    right: [],
    breast: []
  };
  for (const entry of resolvedPrints) {
    const side = String(entry?.side || "").toLowerCase();
    if (side !== "front" && side !== "back" && side !== "left" && side !== "right" && side !== "breast") continue;
    const safeWidth = Math.max(
      1e-3,
      Number(safeWidths[side]) || Number(safeWidths.front) || referenceWidthIn
    );
    const sideReferenceWidth = Math.max(
      1e-3,
      Number(referenceWidths[side]) || referenceWidthIn
    );
    const conversion = sideReferenceWidth / safeWidth;
    const design = entry?.design || {};
    const baseDesign = {
      xIn: (Number(design?.xIn) || 0) * conversion,
      yIn: (Number(design?.yIn) || 0) * conversion,
      wIn: Math.max(0, Number(design?.wIn) || 0) * conversion,
      hIn: Math.max(0, Number(design?.hIn) || 0) * conversion,
      rotation: Number(design?.rotation) || 0
    };
    if (!(baseDesign.wIn > 0 && baseDesign.hIn > 0)) continue;
    const trimMeta = entry?.trim ?? entry?.asset?.trim ?? null;
    const naturalW = Number(entry?.asset?.naturalW ?? trimMeta?.naturalWidth ?? null);
    const naturalH = Number(entry?.asset?.naturalH ?? trimMeta?.naturalHeight ?? null);
    const trimmedDesign = applyTrimToDesign(baseDesign, trimMeta, naturalW, naturalH);
    if (!trimmedDesign) continue;
    const designForCoverage = coverageMode === "painted-pixels" ? trimmedDesign : trimmedDesign;
    const box = rotAabb({ design: designForCoverage });
    if (!(box.w > 0 && box.h > 0)) continue;
    coverageRectsBySide[side].push(box);
  }
  const rectsByPricingSide = {
    front: [...coverageRectsBySide.front, ...coverageRectsBySide.breast],
    back: coverageRectsBySide.back,
    left: coverageRectsBySide.left,
    right: coverageRectsBySide.right
  };
  const decisions = [];
  ["front", "back", "left", "right"].forEach((side) => {
    const rects = rectsByPricingSide[side];
    const areaIn2 = unionArea(rects);
    if (!(areaIn2 > 0)) return;
    const bounds = unionOf(rects);
    const placement = selectTieredPlacementByArea(placements, side, areaIn2) || selectPlacement(placements, side, bounds.wIn, bounds.hIn);
    const addonVariantId = Number(placement?.placement?.addonVariantId);
    if (placement && isTieredFrontBackPlacementKey(placement.key) && Number.isFinite(addonVariantId) && addonVariantId > 0) {
      decisions.push({
        side,
        areaIn2,
        placementKey: placement.key,
        rule: {
          maxArea: Infinity,
          variantId: addonVariantId,
          label: placement.placement.label || placement.key
        }
      });
      return;
    }
    const rule = resolvePrintVariantByArea(side, areaIn2);
    if (!rule) return;
    decisions.push({ side, areaIn2, rule });
  });
  return decisions;
}

// ../Print-MO Website/Shopify Website/designer/src/adminPlacementEditor/printClassification.ts
function printClassChoices(config, side) {
  const tiers = placementKeysForSide(config.placements, side).filter(isTieredFrontBackPlacementKey).map((key) => config.placements[key]).filter((placement) => Number.isSafeInteger(placement.addonVariantId) && Number(placement.addonVariantId) > 0).map((placement) => ({ variantId: placement.addonVariantId, label: placement.label }));
  return tiers.length ? tiers : PRINT_AREA_PRICING[side].map(({ variantId, label }) => ({ variantId, label }));
}
function resolvePrintClasses(config, decisions, overrides) {
  return decisions.map((decision) => {
    const manual = printClassChoices(config, decision.side).find((choice) => choice.variantId === overrides[decision.side]?.variantId);
    return {
      side: decision.side,
      variantId: manual?.variantId || decision.rule.variantId,
      label: manual?.label || decision.rule.label,
      mode: manual ? "manual" : "automatic"
    };
  });
}

// ../Print-MO Website/Shopify Website/designer/src/lib/imageInkGeometry.ts
function resolveInkRectFromTrim(trim, design) {
  if (!trim) return null;
  const renderCrop = trim.paddedCrop ?? trim.crop ?? null;
  const inkCrop = trim.crop ?? renderCrop;
  const baseW = renderCrop?.width || trim.naturalWidth || 0;
  const baseH = renderCrop?.height || trim.naturalHeight || 0;
  if (!renderCrop || !inkCrop || baseW <= 0 || baseH <= 0) return null;
  const scaleX = design.wIn / baseW;
  const scaleY = design.hIn / baseH;
  return { x: (inkCrop.x - renderCrop.x) * scaleX, y: (inkCrop.y - renderCrop.y) * scaleY, w: inkCrop.width * scaleX, h: inkCrop.height * scaleY };
}

// ../Print-MO Website/Shopify Website/designer/src/adminPlacementEditor/placementModel.ts
var FALLBACK_PLACEMENT_CALIBRATION = {
  version: 1,
  fingerprint: "admin-reference-12x16",
  bySide: Object.fromEntries(["front", "back", "left", "right", "breast"].map((side) => [side, { referenceWidthIn: 12, safeWidthIn: 12, safeHeightIn: 16 }]))
};
function placementInkBounds(print) {
  return rotSubRectAabb(print, resolveInkRectFromTrim(print.trim || print.asset.trim, print.design) || { x: 0, y: 0, w: print.design.wIn, h: print.design.hIn });
}
export {
  derivePrintPricingForDesign,
  placementInkBounds,
  printClassChoices,
  resolvePrintClasses
};
