// These executable counterexamples are TODO release gates, not successful acceptance.
// The fixture models independent drafts but cannot establish Shopify payment behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,item,gid} from './studio-merchandise.test-support.mjs';
const merchandise=quantity=>[{id:'retail-a',variantId:gid(1001),quantity}];
const setup=()=>{const f=fixture();f.env.STUDIO_MERCHANDISE_PROOF_ENABLED='true';return f;};

test('return without edits reuses the same checkout and stored quote',async()=>{
  const f=setup(),q=await f.quote({items:[item()],merchandise:merchandise(1)});
  const original=await f.checkout(q),returned=await f.checkout(structuredClone(q));
  assert.equal(returned.checkoutUrl,original.checkoutUrl);assert.equal(f.created.length,1);
  const snapshot=[...f.objects.values()].find(entry=>entry.value.id===q.id).value;
  assert.equal(snapshot.record.items[0].id,'a');assert.equal(snapshot.merchandise[0].quantity,1);
  assert.equal(snapshot.quoteId,q.quoteId);
});

test('RELEASE GATE: returning to edit must retire the previously issued checkout',
  {todo:'No verified provider retirement/fencing contract; two independent OPEN drafts remain.'},async()=>{
    const f=setup(),q=await f.quote({items:[item()],merchandise:merchandise(1)});
    await f.checkout(q);
    const edited=await f.quote({items:[item()],merchandise:merchandise(2)});
    await f.checkout(edited);
    const open=[...f.drafts.values()].filter(draft=>draft.status==='OPEN');
    assert.equal(open.length,1,'Changed review created a second OPEN checkout without retiring the first');
  });

test('RELEASE GATE: a new browser session must resume the same order attempt',
  {todo:'Checkout identity is scoped to supplied sessionId, not a durable order/revision identity.'},async()=>{
    const f=setup(),q=await f.quote({items:[],merchandise:merchandise(1)});
    await f.checkout(q,{artwork:{}});
    await f.checkout(q,{artwork:{},sessionId:'8b76c516-57d5-4b8e-93a7-fb20baf94a26'});
    assert.equal(f.created.length,1,'A new session created a second draft for the same reviewed order');
  });

test('RELEASE GATE: completed checkout must be detected before returning its cached URL',
  {todo:'Ready cache currently skips fresh provider completion state; OPEN alone is also insufficient after unlink.'},async()=>{
    const f=setup(),q=await f.quote({items:[],merchandise:merchandise(1)});
    await f.checkout(q,{artwork:{}});
    f.drafts.values().next().value.status='COMPLETED';
    await assert.rejects(f.checkout(q,{artwork:{}}),error=>error.code==='CHECKOUT_COMPLETE');
  });
