// Alternatives are staff-authored configurations, never public catalog suggestions.
const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_SELECTION', status: 400 }); };
export function validateAlternativeGroups(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  for (const item of items) if (item.alternativeForItemId) {
    const parent = byId.get(item.alternativeForItemId);
    if (!parent || parent.id === item.id || parent.alternativeForItemId) invalid('An alternative must belong to a proposed garment, not another alternative.');
  }
}
export function preparedSelection(record, selection) {
  validateAlternativeGroups(record.items);
  const roots = record.items.filter(item => !item.alternativeForItemId);
  if (selection === undefined) return roots.map(item => item.id);
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || !selection.choices || typeof selection.choices !== 'object' || Array.isArray(selection.choices)
    || !Array.isArray(selection.extras)) invalid('Choose the garments to include in this order.');
  const byId = new Map(record.items.map(item => [item.id, item]));
  if (Object.keys(selection.choices).length !== roots.length) invalid('Review every proposed garment before continuing.');
  const selected = roots.map(root => {
    const chosen = byId.get(selection.choices[root.id]);
    if (!chosen || (chosen.id !== root.id && chosen.alternativeForItemId !== root.id)) invalid('A selected alternative does not belong to this garment.');
    return chosen.id;
  });
  for (const extra of selection.extras) {
    const item = byId.get(extra);
    if (!item || (!item.alternativeForItemId && !record.items.some(option => option.alternativeForItemId === item.id))) invalid('An extra garment is not an available option.');
    selected.push(extra);
  }
  if (new Set(selected).size !== selected.length || selected.length > record.items.length) invalid('A garment cannot be selected twice. Adjust its quantities instead.');
  return selected;
}
export function selectedPreparedRecord(record, selection) {
  const ids = new Set(preparedSelection(record, selection));
  return { ...record, items: record.items.filter(item => ids.has(item.id)) };
}
export function primaryPreparedTemplate(template, record) {
  const ids = new Set(preparedSelection(record));
  const workspaces = template.workspaces.filter(workspace => ids.has(workspace.id));
  return { ...template, workspaces, activeWorkspaceId: workspaces[0]?.id, activeHandle: workspaces[0]?.handle || null };
}
