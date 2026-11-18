const test = require('node:test'), assert = require('node:assert/strict');
const m = require('../order-manager-web/studio-usage-model.js');
test('local calendar bounds and preceding periods preserve the number of days across DST', () => {
  const priorZone = process.env.TZ; process.env.TZ = 'America/Chicago';
  try {
    const range = m.bounds('2026-11-01', '2026-11-07');
    assert.equal(range.after, '2026-11-01T05:00:00.000Z'); assert.equal(range.before, '2026-11-08T06:00:00.000Z');
    assert.equal(m.days(range).length, 7); const previous = m.preceding(range);
    assert.equal(previous.start, '2026-10-25'); assert.equal(previous.end, '2026-10-31'); assert.equal(previous.before, range.after);
    assert.equal(m.bounds('2026-02-30', '2026-03-02'), null); assert.equal(m.bounds('2026-11-08', '2026-11-01'), null);
  } finally { if (priorZone === undefined) delete process.env.TZ; else process.env.TZ = priorZone; }
});
test('quarter-hour buckets aggregate to local calendar days without dropping a quarter-hour zone midnight', () => {
  const priorZone = process.env.TZ; process.env.TZ = 'Asia/Kathmandu';
  try {
    const range = m.bounds('2026-11-15', '2026-11-16');
    assert.deepEqual(m.daily([{timestamp:'2026-11-14T18:15:00Z',count:2},{timestamp:'2026-11-15T18:00:00Z',count:3},{timestamp:'2026-11-15T18:15:00Z',count:7}],range),[{day:'2026-11-15',count:5},{day:'2026-11-16',count:7}]);
    assert.equal(m.reasonLabel('provider SQL SECRET'), 'Other recorded failures');
  } finally { if (priorZone === undefined) delete process.env.TZ; else process.env.TZ = priorZone; }
});

test('hourly single-day timeline preserves DST repeated hours, partial hours and blank future hours', () => {
  const old=process.env.TZ;process.env.TZ='America/Chicago';
  try {
    const range=m.bounds('2026-11-01','2026-11-01'),now=Date.parse('2026-11-01T08:30:00Z');
    const result=m.timeline([{timestamp:'2026-11-01T06:15:00Z',count:2},{timestamp:'2026-11-01T07:15:00Z',count:3},{timestamp:'2026-11-01T08:15:00Z',count:1}],range,now);
    assert.equal(result.unit,'hour');assert.equal(result.values.length,25);assert.equal(result.values.reduce((n,v)=>n+v.count,0),6);assert.notEqual(result.values[1].label,result.values[2].label);
    assert.equal(result.values.filter(v=>v.partial).length,1);assert(result.values.some(v=>v.future));assert(result.values.filter(v=>v.future).every(v=>v.count===0));
    assert.equal(m.timeline([],m.bounds('2026-03-08','2026-03-08')).values.length,23);
    assert.equal(m.timeline([],m.bounds('2026-11-01','2026-11-02')).unit,'day');
  }finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
