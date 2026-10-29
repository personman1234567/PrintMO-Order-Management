import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAlternativeGroups, preparedSelection, selectedPreparedRecord, primaryPreparedTemplate } from './prepared-choices.mjs';
const record = { items: [{id:'tee'}, {id:'hoodie'}, {id:'zip', alternativeForItemId:'hoodie'}] };
test('old clients receive only the proposed garments', () => {
  assert.deepEqual(preparedSelection(record), ['tee','hoodie']);
  assert.deepEqual(primaryPreparedTemplate({workspaces:record.items}, record).workspaces, record.items.slice(0,2));
});
test('replacement and extra selection include only explicit published configurations', () => {
  const selection = {choices:{tee:'tee',hoodie:'zip'},extras:['hoodie']};
  assert.deepEqual(preparedSelection(record, selection), ['tee','zip','hoodie']);
  assert.deepEqual(selectedPreparedRecord(record,{...selection,extras:[]}).items.map(item=>item.id), ['tee','zip']);
  assert.throws(()=>preparedSelection(record,{...selection,extras:['zip']}), /twice/);
  assert.throws(()=>preparedSelection(record,{choices:{tee:'zip',hoodie:'hoodie'},extras:[]}), /belong/);
  assert.throws(()=>preparedSelection(record,{choices:{hoodie:'zip'},extras:[]}), /every/);
  assert.throws(()=>preparedSelection(record,{...selection,extras:['foreign']}), /available/);
});
test('dangling, cyclic and nested alternatives are rejected', () => {
  for(const items of [[{id:'a',alternativeForItemId:'gone'}],[{id:'a',alternativeForItemId:'a'}],[{id:'a'},{id:'b',alternativeForItemId:'a'},{id:'c',alternativeForItemId:'b'}]]) assert.throws(()=>validateAlternativeGroups(items));
});
