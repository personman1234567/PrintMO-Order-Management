(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StudioUsageModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [y, m, d] = value.split('-').map(Number), result = new Date(y, m - 1, d);
    return dateKey(result) === value ? result : null;
  }
  function bounds(start, end) {
    const a = date(start), b = date(end);
    if (!a || !b || a > b) return null;
    const stop = new Date(b); stop.setDate(stop.getDate() + 1);
    return { start, end, after: a.toISOString(), before: stop.toISOString() };
  }
  function days(range) {
    const first = date(range.start), last = date(range.end), result = [];
    if (!first || !last || first > last) return result;
    for (let d = first; d <= last; d.setDate(d.getDate() + 1)) result.push(dateKey(d));
    return result;
  }
  function preceding(range) {
    const count = days(range).length, end = date(range.start);
    end.setDate(end.getDate() - 1); const start = new Date(end); start.setDate(start.getDate() - count + 1);
    return bounds(dateKey(start), dateKey(end));
  }
  function daily(buckets, range) {
    const counts = new Map(days(range).map(day => [day, 0]));
    for (const bucket of buckets || []) {
      const d = new Date(bucket.timestamp), day = dateKey(d), count = Number(bucket.count);
      if (!Number.isNaN(d.getTime()) && counts.has(day) && Number.isFinite(count) && count >= 0) counts.set(day, counts.get(day) + count);
    }
    return [...counts].map(([day, count]) => ({ day, count }));
  }
  function timeline(buckets, range, now = Date.now()) {
    const single = range.start === range.end, start = Date.parse(range.after), stop = Date.parse(range.before);
    const values = single ? Array.from({ length: Math.round((stop - start) / 3600000) }, (_, i) => {
      const time = start + i * 3600000;
      return { key: String(time), timestamp: time, label: new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), count: 0, future: time > now, partial: time <= now && time + 3600000 > now };
    }) : daily([], range).map(row => ({ key: row.day, timestamp: date(row.day).getTime(), label: date(row.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), count: 0, future: date(row.day).getTime() > now, partial: row.day === dateKey(new Date(now)) }));
    const byKey = new Map(values.map(v => [v.key, v]));
    for (const bucket of buckets || []) {
      const time = Date.parse(bucket.timestamp), count = Number(bucket.count);
      if (!Number.isFinite(time) || time < start || time >= stop || !Number.isFinite(count) || count < 0) continue;
      const key = single ? String(start + Math.floor((time - start) / 3600000) * 3600000) : dateKey(new Date(time));
      const row = byKey.get(key); if (row && !row.future) row.count += count;
    }
    if (single) {
      const frequencies = new Map(); values.forEach(v => frequencies.set(v.label, (frequencies.get(v.label) || 0) + 1));
      values.forEach(v => { if (frequencies.get(v.label) > 1) v.label += ' ' + new Date(v.timestamp).toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop(); });
    }
    return { unit: single ? 'hour' : 'day', values };
  }
  function compactPeriod(range) {
    if (range.start === range.end) {
      const label = date(range.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return range.start === dateKey(new Date()) ? 'Today · ' + label : label;
    }
    return period(range);
  }
  function zoneLabel() { const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local'; return zone.split('/').pop().replace(/_/g, ' ') + ' time'; }
  const reasons = { timeout: 'Timed out', network: 'Network', export: 'Artwork export', preview: 'Preview capture', validation: 'Validation', inventory: 'Availability', pricing: 'Pricing', unknown: 'Other recorded failures' };
  const reasonLabel = value => reasons[value] || reasons.unknown;
  const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value) || 0);
  function period(range) {
    return [range.start, range.end].map(value => date(value)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) || '').join(' – ');
  }
  return { dateKey, date, bounds, days, preceding, daily, timeline, compactPeriod, zoneLabel, reasonLabel, number, period };
});
