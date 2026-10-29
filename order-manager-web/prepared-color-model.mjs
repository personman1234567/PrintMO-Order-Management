export const colorOf = variant => variant.selectedOptions.find(option => /colou?r/i.test(option.name))?.value || '';
export const configurationOf = variant => variant.selectedOptions.filter(option => !/^size$/i.test(option.name)).map(option => option.value).join(' · ') || 'Default';

export function colorVariants(detail, reference, colorOnly = false) {
  const hasColor = reference?.selectedOptions.some(option => /colou?r/i.test(option.name));
  const fixed = colorOnly && hasColor ? reference.selectedOptions.filter(option => !/^size$/i.test(option.name) && !/colou?r/i.test(option.name)) : [];
  const variants = detail.variants.filter(variant => fixed.every(option => variant.selectedOptions.some(value => value.name === option.name && value.value === option.value)));
  return variants.filter((variant, index) => variants.findIndex(other => configurationOf(other) === configurationOf(variant)) === index);
}

export function copiedArtwork(source, target) {
  const project = structuredClone(source.project);
  // Keep source calibration: the shared placement engine rebases physical inches.
  project.printSummary = [];
  if (source.productId !== target.productId) project.printClassOverrides = {};
  return project;
}

export function previewSignature(item) {
  const project = item.project;
  return JSON.stringify({ productId: item.productId, color: item.color,
    prints: (project?.prints || []).map(p => [p.id, p.side, p.asset?.assetId, p.asset?.mime, p.design.xIn, p.design.yIn, p.design.wIn, p.design.hIn, p.design.rotation, !!p.flipH, !!p.flipV, p.trim || p.asset?.trim || null]),
    calibration: Object.entries(project?.canvasCalibration?.bySide || {}).sort().map(([side, c]) => [side, c.referenceWidthIn, c.safeWidthIn, c.safeHeightIn]),
    overrides: Object.entries(project?.printClassOverrides || {}).sort().map(([side, value]) => [side, value.variantId]),
  });
}
