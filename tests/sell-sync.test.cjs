const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const builds = ['version2', 'version2-firefox'];

function fixture(prices, sells = []) {
  const table = { isConnected: true };
  const pairs = prices.map((price, index) => {
    // A nested input wrapper contains neither the player image nor row text.
    // Several real players can therefore share the old price-based signature.
    const wrapper = { parentElement: table, textContent: '', querySelector: () => null };
    const playerImage = { currentSrc: `player-${index}.png`, src: `player-${index}.png` };
    const row = {
      parentElement: table, textContent: '600 650 700',
      querySelector: () => playerImage,
      querySelectorAll: selector => selector === 'img' ? [playerImage] : pairs[index],
      getAttribute: () => null,
      contains: field => pairs[index].includes(field)
    };
    wrapper.parentElement = row;
    const inner = { parentElement: wrapper, contains: () => false };
    // old parentElement.parentElement === wrapper, not the actual player row
    const buy = { value: String(price), parentElement: inner, closest: () => null };
    const sell = { value: String(sells[index] ?? ''), parentElement: inner, closest: () => null };
    return [buy, sell];
  });
  return { table, pairs };
}

function harness(build, data = fixture([650])) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const warnings = [];
  const setTimeoutFake = (fn, delay = 0) => {
    const handle = ++id;
    timers.set(handle, { fn, at: now + delay });
    return handle;
  };
  const source = fs.readFileSync(path.join(__dirname, '..', build, 'content.js'), 'utf8');
  const startup = '  watchGallery();\n  watchAutomaticSellSync();';
  assert.ok(source.includes(startup), 'Expected startup marker');
  const context = vm.createContext({
    console: { info() {}, warn(...args) { warnings.push(args); } },
    setTimeout: setTimeoutFake,
    clearTimeout: handle => timers.delete(handle),
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: fn => setTimeoutFake(fn, 0),
    Date: class extends Date { static now() { return now; } },
    document: { activeElement: null },
    Event: class {},
    chrome: { runtime: { onMessage: { addListener() {} } } }
  });
  vm.runInContext(source.replace(startup, `
  globalThis.testAPI = {
    syncCurrentPage, rowIdentity, rowSignature, automaticSyncKey,
    scheduleAutomaticSellSync, automaticSyncState,
    setTableProvider(provider) { findPriceTable = provider; },
    setRowsProvider(provider) { fieldRows = provider; },
    setWriter(writer) { setReactValue = writer; },
    setSyncRunner(runner) { syncSellPrices = runner; },
    setScrollProvider(provider) { scrollContainers = provider; },
    setPaintWait(wait) { waitForTablePaint = wait; }
  };
`), context);
  const api = context.testAPI;
  api.setTableProvider(() => data.table);
  api.setRowsProvider(() => data.pairs);
  api.setScrollProvider(() => []);
  api.setPaintWait(async () => {});
  api.setWriter((field, value) => { field.value = value; });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  async function tick(ms) {
    const end = now + ms;
    for (let count = 0; count < 20000; count++) {
      await flush();
      const next = [...timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { now = end; await flush(); return; }
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    throw new Error('Timer runaway');
  }
  return { api, data, tick, warnings };
}

for (const build of builds) {
  test(`${build}: every equal-price row is populated, including already-filled neighbors`, async () => {
    const h = harness(build, fixture([700, 650, 650, 650, 650, 700, 800], [700, 650, '', 650, 650, '', '']));
    const work = h.api.syncCurrentPage();
    await h.tick(15000);
    const result = await work;
    assert.deepEqual(h.data.pairs.map(([, sell]) => sell.value), ['700', '650', '650', '650', '650', '700', '800']);
    assert.equal(result.failed, 0);
  });

  test(`${build}: rows with completely identical identities still get individual writes`, async () => {
    const h = harness(build, fixture([650, 650, 650, 800]));
    for (const fields of h.data.pairs) {
      const row = fields[0].parentElement.parentElement.parentElement;
      row.querySelector = () => null;
      row.textContent = '';
    }
    assert.equal(h.api.rowIdentity(h.data.pairs[0]), h.api.rowIdentity(h.data.pairs[1]));
    const work = h.api.syncCurrentPage();
    await h.tick(15000);
    const result = await work;
    assert.deepEqual(h.data.pairs.map(([, sell]) => sell.value), ['650', '650', '650', '800']);
    assert.equal(result.rows, 4);
    assert.equal(result.eligible, 4);
    assert.equal(result.updated, 4);
  });

  test(`${build}: duplicate scroll scans do not inflate eligible-row counts`, async () => {
    const h = harness(build, fixture([650, 700]));
    const container = { scrollTop: 0, clientHeight: 100, scrollHeight: 200, dispatchEvent() {} };
    h.api.setScrollProvider(() => [container]);
    const work = h.api.syncCurrentPage();
    await h.tick(15000);
    const result = await work;
    assert.equal(result.rows, 2);
    assert.equal(result.eligible, 2);
    assert.equal(result.updated, 2);
    assert.equal(container.scrollTop, 0);
  });

  test(`${build}: permanently rejected values stop retrying until the state changes`, async () => {
    const h = harness(build);
    let calls = 0;
    h.api.setSyncRunner(async () => {
      calls++;
      return { ok: true, rows: 1, eligible: 1, updated: 0, failed: 1, pages: 1 };
    });
    h.api.scheduleAutomaticSellSync('table', 10);
    await h.tick(10000);
    assert.equal(calls, 5);
    h.api.scheduleAutomaticSellSync('poll', 10);
    await h.tick(10000);
    assert.equal(calls, 5, 'An unchanged rejected field must not loop forever');
    h.data.pairs[0][0].value = '700';
    h.api.scheduleAutomaticSellSync('buy-input', 10);
    await h.tick(10000);
    assert.equal(calls, 10);
  });

  test(`${build}: a field cleared after success triggers another pass with unchanged buy values`, async () => {
    const h = harness(build);
    let calls = 0;
    h.api.setSyncRunner(async () => {
      calls++;
      h.data.pairs[0][1].value = '650';
      return { ok: true, rows: 1, eligible: 1, updated: 1, failed: 0, pages: 1 };
    });
    h.api.scheduleAutomaticSellSync('table', 10);
    await h.tick(1000);
    h.data.pairs[0][1].value = '';
    h.api.scheduleAutomaticSellSync('poll', 10);
    await h.tick(1000);
    assert.equal(calls, 2);
    assert.equal(h.data.pairs[0][1].value, '650');
  });

  test(`${build}: detect a sell field cleared without changing its buy price`, () => {
    const h = harness(build, fixture([650], [650]));
    const before = h.api.automaticSyncKey(h.data.table);
    h.data.pairs[0][1].value = '';
    assert.notEqual(h.api.automaticSyncKey(h.data.table), before);
  });

  test(`${build}: an incomplete pass actually runs its forced retry`, async () => {
    const h = harness(build);
    let calls = 0;
    h.api.setSyncRunner(async () => {
      calls++;
      if (calls > 1) h.data.pairs[0][1].value = '650';
      return { ok: true, rows: 1, eligible: 1, updated: calls > 1 ? 1 : 0, failed: calls > 1 ? 0 : 1, pages: 1 };
    });
    h.api.scheduleAutomaticSellSync('table', 10);
    await h.tick(3000);
    assert.equal(calls, 2);
  });

  test(`${build}: frequent mutations cannot postpone the first pass indefinitely`, async () => {
    const h = harness(build);
    let calls = 0;
    h.api.setSyncRunner(async () => {
      calls++;
      h.data.pairs[0][1].value = '650';
      return { ok: true, rows: 1, eligible: 1, updated: 1, failed: 0, pages: 1 };
    });
    for (let i = 0; i < 20; i++) {
      h.api.scheduleAutomaticSellSync('page', 500);
      await h.tick(100);
    }
    assert.ok(calls >= 1, 'Frequent DOM changes starved the timer');
  });

  test(`${build}: re-query replaced inputs after each write`, async () => {
    const h = harness(build, fixture([650, 650, 800]));
    const writes = [];
    h.api.setWriter((field, value) => {
      const index = h.data.pairs.findIndex(([, sell]) => sell === field);
      assert.ok(index >= 0, 'Attempted write to a stale detached input');
      writes.push(index);
      field.value = value;
      h.data.pairs = h.data.pairs.map(([buy, sell]) => [{ ...buy }, { ...sell }]);
    });
    const work = h.api.syncCurrentPage();
    await h.tick(15000);
    await work;
    assert.deepEqual(h.data.pairs.map(([, sell]) => sell.value), ['650', '650', '800']);
    assert.deepEqual(writes, [0, 1, 2]);
  });

  test(`${build}: a rejected write does not block later rows or retry without a bound`, async () => {
    const h = harness(build, fixture([650, 650, 800]));
    let attempts = 0;
    h.api.setWriter((field, value) => {
      attempts++;
      if (field !== h.data.pairs[0][1]) field.value = value;
    });
    const work = h.api.syncCurrentPage();
    await h.tick(15000);
    const result = await work;
    assert.deepEqual(h.data.pairs.map(([, sell]) => sell.value), ['', '650', '800']);
    assert.equal(result.failed, 1);
    assert.ok(attempts <= 15);
  });
}
