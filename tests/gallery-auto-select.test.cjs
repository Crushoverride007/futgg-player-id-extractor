const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
// Install linkedom outside the extension, then set FUTGG_TEST_DOM to its path.
// This suite exercises DOM selectors and event-driven replacement, not a live EA session.
const { parseHTML } = require(process.env.FUTGG_TEST_DOM || 'linkedom');
const KEY = 'galleryAutoSelectFirst15';

function galleryHTML({ count = 20, added = [], prefix = 'A', hidden = false, start = 1, missingRank = null, controls = '' } = {}) {
  let cards = '';
  for (let rank = start; rank < start + count; rank++) {
    if (rank === missingRank) continue;
    cards += `<article data-player-id="${prefix}-${rank}"><span>${rank}</span><div><span>1,000</span><img src="${prefix}-${rank}.png" alt="Player ${rank}"><span>83</span><span>RW</span></div><h3>${prefix} Player ${rank}</h3><p>410</p><div><button ${added.includes(rank) ? 'disabled' : ''}>${added.includes(rank) ? 'Added' : '+ Buy'}</button></div></article>`;
  }
  return `<section class="gallery" ${hidden ? 'hidden' : ''}><h2>${prefix} Gallery</h2><nav><span>Collected 0</span><span>Missing ${count}</span></nav><div class="cards">${cards}</div>${controls}</section>`;
}

function harness(build, options = {}, beforeStart = () => {}) {
  const { document, window } = parseHTML(`<html><body><main>${galleryHTML(options)}</main></body></html>`);
  let now = 0, counter = 0;
  const timers = new Map(), clicks = [], warnings = [], listeners = [];
  const selected = new Set(options.added || []);
  const statuses = new Map();
  const style = (element) => ({
    display: element.hidden ? 'none' : element.style.display || 'block',
    visibility: element.style.visibility || 'visible', pointerEvents: element.style.pointerEvents || 'auto'
  });
  window.Element.prototype.getBoundingClientRect = function () {
    return this.closest('[hidden]') ? { width: 0, height: 0 } : { width: 250, height: 320, top: 0, left: 0 };
  };
  const schedule = (fn, delay, interval = false) => {
    const id = ++counter;
    timers.set(id, { fn, at: now + (delay || 0), interval: interval ? delay : 0 });
    return id;
  };
  const context = vm.createContext({
    document, Element: window.Element, NodeFilter: { SHOW_TEXT: 4 },
    location: { href: 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/' },
    getComputedStyle: style,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true),
    console: { warn: (...args) => warnings.push(args) },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: { get: (defaults, callback) => callback({ ...defaults, [KEY]: options.enabled !== false }) },
        onChanged: { addListener: fn => listeners.push(fn) }
      }
    }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !button.closest('article')) return;
    const article = button.closest('article');
    const rank = Number(article.querySelector('span').textContent);
    clicks.push({ rank, id: article.getAttribute('data-player-id'), label: button.textContent });
    if (options.rejectRank === rank) return;
    const update = () => {
      selected.add(rank);
      statuses.set(rank, 'Added');
      if (options.replaceAll) {
        document.querySelector('main').innerHTML = galleryHTML({ ...options, added: [...selected] });
      } else {
        button.textContent = 'Added';
        button.disabled = true;
      }
    };
    if (options.ackDelay) schedule(update, options.ackDelay);
    else update();
  });
  beforeStart({ document, context, schedule });
  const source = fs.readFileSync(path.join(__dirname, '..', build, 'gallery-auto-select.js'), 'utf8');
  assert.ok(source.includes('  start();'));
  vm.runInContext(source.replace('  start();', '  globalThis.testAPI = { state, tick, discover, cardFor, action };\n  start();'), context);
  function tick(ms) {
    const until = now + ms;
    for (let i = 0; i < 10000; i++) {
      const next = [...timers].filter(([, item]) => item.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { now = until; return; }
      now = next[1].at;
      timers.delete(next[0]);
      if (next[1].interval) timers.set(next[0], { ...next[1], at: now + next[1].interval });
      next[1].fn();
    }
    throw new Error('Timer runaway');
  }
  return {
    document, context, clicks, warnings, tick, api: context.testAPI, timers,
    setting(enabled) { listeners.forEach(fn => fn({ [KEY]: { newValue: enabled } }, 'local')); },
    ranks() { return clicks.map(click => click.rank); }
  };
}

for (const build of ['version2', 'version2-firefox']) {
  test(`${build}: automatically click only cards 1–15 and never Added or purchase controls`, () => {
    const h = harness(build, { controls: '<button>Buy players</button><button>Buy Now</button><button>Buy</button><button>Confirm</button>' });
    const otherClicks = [];
    h.document.querySelectorAll('section > button').forEach(button => button.addEventListener('click', () => otherClicks.push(button.textContent)));
    h.tick(20000);
    assert.deepEqual(h.ranks(), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.ok(h.clicks.every(click => click.label === '+ Buy'));
    assert.deepEqual(otherClicks, []);
    assert.equal(h.document.querySelector('[data-player-id="A-16"] button').textContent, '+ Buy');
    assert.deepEqual(h.warnings, []);
  });
  test(`${build}: already-added first players count toward 15`, () => {
    const h = harness(build, { added: [1, 3, 8, 15] });
    h.tick(16000);
    assert.deepEqual(h.ranks(), [2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14]);
  });
  test(`${build}: a screenshot state with 1–15 Added generates no clicks`, () => {
    const h = harness(build, { added: Array.from({ length: 15 }, (_, i) => i + 1) });
    h.tick(20000);
    assert.deepEqual(h.ranks(), []);
  });
  test(`${build}: already-selected cards outside the first 15 still count toward total cap`, () => {
    const h = harness(build, { added: [16, 17, 18, 19, 20] });
    h.tick(20000);
    assert.deepEqual(h.ranks(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  test(`${build}: replace all React card nodes after each click without missing or duplicating`, () => {
    const h = harness(build, { replaceAll: true });
    h.tick(20000);
    assert.deepEqual(h.ranks(), Array.from({ length: 15 }, (_, i) => i + 1));
  });
  test(`${build}: wait for a delayed Added acknowledgement`, () => {
    const h = harness(build, { ackDelay: 1400 });
    h.tick(1800);
    assert.deepEqual(h.ranks(), [1]);
    h.tick(26000);
    assert.deepEqual(h.ranks(), Array.from({ length: 15 }, (_, i) => i + 1));
  });
  test(`${build}: rejected click stops rather than blindly clicking more players`, () => {
    const h = harness(build, { rejectRank: 2 });
    h.tick(30000);
    assert.deepEqual(h.ranks(), [1, 2]);
    assert.equal(h.api.state.session.stopped, true);
    assert.match(h.document.getElementById('futgg-first15-notice').textContent, /paused/);
  });
  test(`${build}: fewer than 15 players are selected without padding with unrelated buttons`, () => {
    const h = harness(build, { count: 7 });
    h.tick(14000);
    assert.deepEqual(h.ranks(), [1, 2, 3, 4, 5, 6, 7]);
  });
  test(`${build}: unrelated Buy controls outside a Gallery are ignored`, () => {
    const h = harness(build, {}, ({ document }) => {
      document.querySelector('nav').remove();
      document.querySelector('main').insertAdjacentHTML('beforeend', '<button>+ Buy</button>');
    });
    h.tick(15000);
    assert.deepEqual(h.ranks(), []);
  });
  test(`${build}: hidden Gallery cards cannot be selected`, () => {
    const h = harness(build, { hidden: true });
    h.tick(15000);
    assert.deepEqual(h.ranks(), []);
  });
  test(`${build}: duplicate visible Galleries fail closed`, () => {
    const h = harness(build, {}, ({ document }) => document.querySelector('main').insertAdjacentHTML('beforeend', galleryHTML({ prefix: 'B' })));
    h.tick(15000);
    assert.deepEqual(h.ranks(), []);
  });
  test(`${build}: noncontiguous or later-page ranks do not select the wrong first 15`, () => {
    for (const options of [{ missingRank: 3 }, { start: 16 }]) {
      const h = harness(build, options);
      h.tick(15000);
      assert.deepEqual(h.ranks(), []);
    }
  });
  test(`${build}: late cards can hydrate without selecting number 16`, () => {
    const h = harness(build, { count: 5 });
    h.tick(6000);
    const added = h.ranks();
    h.document.querySelector('main').innerHTML = galleryHTML({ added });
    h.tick(15000);
    assert.deepEqual(h.ranks(), Array.from({ length: 15 }, (_, i) => i + 1));
  });
  test(`${build}: disabled selection buttons are not clicked`, () => {
    const h = harness(build, {}, ({ document }) => document.querySelector('[data-player-id="A-3"] button').disabled = true);
    h.tick(15000);
    assert.equal(h.ranks().length, 14);
    assert.ok(!h.ranks().includes(3));
    assert.ok(!h.ranks().includes(16));
  });
  test(`${build}: setting persists off at startup and can be enabled and stopped mid-run`, () => {
    const h = harness(build, { enabled: false });
    h.tick(5000);
    assert.deepEqual(h.ranks(), []);
    h.setting(true);
    h.tick(1600);
    assert.ok(h.ranks().length > 0);
    h.setting(false);
    const count = h.ranks().length;
    h.tick(15000);
    assert.equal(h.ranks().length, count);
  });
  test(`${build}: rerendering an already processed player as Buy does not re-add it`, () => {
    const h = harness(build);
    h.tick(12000);
    const button = h.document.querySelector('[data-player-id="A-4"] button');
    button.textContent = '+ Buy';
    button.disabled = false;
    h.tick(12000);
    assert.equal(h.ranks().length, 15);
  });
  test(`${build}: a different Gallery gets its own first-15 selection`, () => {
    const h = harness(build);
    h.tick(12000);
    h.document.querySelector('main').innerHTML = galleryHTML({ prefix: 'B' });
    h.tick(12000);
    assert.equal(h.ranks().length, 30);
    assert.ok(h.clicks.slice(15).every(click => click.id.startsWith('B-')));
  });
  test(`${build}: document hidden pauses all automatic selection`, () => {
    const h = harness(build, {}, ({ document }) => document.hidden = true);
    h.tick(15000);
    assert.deepEqual(h.ranks(), []);
  });
  test(`${build}: plus-icon Buy buttons work without matching arbitrary icons`, () => {
    for (const icon of [
      '<svg class="lucide-plus"></svg>',
      '<svg><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      '<svg><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    ]) {
      const h = harness(build, {}, ({ document }) => document.querySelectorAll('article button').forEach(button => button.innerHTML = icon + '<span>Buy</span>'));
      h.tick(16000);
      assert.deepEqual(h.ranks(), Array.from({ length: 15 }, (_, i) => i + 1));
    }
    const h = harness(build, {}, ({ document }) => document.querySelectorAll('article button').forEach(button => button.innerHTML = '<svg><circle r="5"/></svg>Buy'));
    h.tick(15000);
    assert.deepEqual(h.ranks(), []);
  });
  test(`${build}: unrelated modal pauses background Gallery selection`, () => {
    const h = harness(build, {}, ({ document }) => document.querySelector('main').insertAdjacentHTML('beforeend', '<div role="dialog"><button>Confirm</button></div>'));
    h.tick(15000);
    assert.deepEqual(h.ranks(), []);
    h.document.querySelector('[role="dialog"]').remove();
    h.tick(15000);
    assert.equal(h.ranks().length, 15);
  });
  test(`${build}: Gallery inside its own dialog remains usable`, () => {
    const h = harness(build, {}, ({ document }) => document.querySelector('main').setAttribute('role', 'dialog'));
    h.tick(15000);
    assert.equal(h.ranks().length, 15);
  });
  test(`${build}: popup toggle saves setting and restores state on save failure`, () => {
    const { document } = parseHTML(fs.readFileSync(path.join(__dirname, '..', build, 'popup.html'), 'utf8'));
    const toggle = document.getElementById('gallery-auto-select');
    const status = document.getElementById('gallery-auto-select-status');
    const handlers = {};
    toggle.addEventListener = (type, fn) => handlers[type] = fn;
    const saved = [];
    const chrome = {
      runtime: { lastError: null },
      storage: { local: {
        get: (defaults, done) => done({ ...defaults, [KEY]: false }),
        set: (value, done) => { saved.push(value[KEY]); done(); }
      } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', build, 'gallery-settings.js'), 'utf8'), { document, chrome });
    assert.equal(toggle.checked, false);
    assert.equal(toggle.disabled, false);
    toggle.checked = true;
    handlers.change();
    assert.deepEqual(saved, [true]);
    assert.match(status.textContent, /Enabled/);
    chrome.runtime.lastError = { message: 'storage unavailable' };
    toggle.checked = false;
    handlers.change();
    assert.equal(toggle.checked, true);
    assert.match(status.textContent, /Could not save/);
  });
}
