// Read-only unit tests: no Prisma import and no database connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../modules/orders/helpers/expedition-day.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox = { exports: {}, Intl, Date };
vm.runInNewContext(compiled, sandbox);
const { getExpeditionDayRange, isInExpeditionDay } = sandbox.exports;
for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
  process.env.TZ = timezone;
  const range = getExpeditionDayRange(new Date('2026-08-31T12:30:00Z'));
  assert.equal(range.gte.toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-09-01T00:00:00.000Z');
  for (const date of ['2026-08-30T23:59:59Z', '2026-08-29T12:00:00Z', '2026-08-24T12:00:00Z', '2026-09-01T00:00:00Z']) {
    assert.equal(isInExpeditionDay(new Date(date), range), false, `${timezone}: ${date} must not block`);
  }
  for (const date of ['2026-08-31T00:00:00Z', '2026-08-31T23:59:59.999Z']) {
    assert.equal(isInExpeditionDay(new Date(date), range), true);
  }
  const nextDay = getExpeditionDayRange(new Date('2026-09-01T00:00:00Z'));
  assert.equal(isInExpeditionDay(new Date('2026-08-31T23:59:59Z'), nextDay), false);
}
console.log('OK: same-day only, previous day / 2 days / week excluded, midnight boundary and 3 server timezones.');
