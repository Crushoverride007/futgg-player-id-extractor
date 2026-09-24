(() => {
  "use strict";
  // Separate from the pricing and legacy ID-extraction integrations.
  if (globalThis.__futggGalleryAutoSelect) return;
  globalThis.__futggGalleryAutoSelect = true;

  const SETTING = "galleryAutoSelectFirst15";
  const LIMIT = 15;
  const CONTROL = "button, [role='button']";
  const POLL_MS = 350;
  const SETTLE_MS = 700;
  const ACK_MS = 3500;
  const state = { enabled: false, session: null, absentSince: null };
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function visible(element) {
    if (!element?.isConnected || element.closest("[hidden], [aria-hidden='true']")) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function plusIcon(button) {
    if (button.querySelector(".lucide-plus, .fa-plus, .icon-plus, .tabler-icon-plus, [data-icon='plus'], [aria-label='plus'], [aria-label='Plus']")) return true;
    return [...button.querySelectorAll("svg")].some((svg) => {
      // Common outlined Plus SVG: one centered horizontal and vertical stroke.
      // Merely containing an arbitrary SVG is not enough to identify + Buy.
      const strokes = [...svg.querySelectorAll("path")].map((path) => text(path.getAttribute("d")).toLowerCase().replace(/[\s,]+/g, ""));
      if (strokes.some((d) => /^(m125v14m512h14|m512h14m125v14)$/.test(d))) return true;
      const vertical = strokes.includes("m125v14") || strokes.includes("m125l1219");
      const horizontal = strokes.includes("m512h14") || strokes.includes("m512l1912");
      if (vertical && horizontal) return true;
      const lines = [...svg.querySelectorAll("line")].map((line) => ["x1", "y1", "x2", "y2"].map((name) => Number(line.getAttribute(name))));
      return lines.some(([x1, y1, x2, y2]) => x1 === 12 && x2 === 12 && Math.min(y1, y2) === 5 && Math.max(y1, y2) === 19)
        && lines.some(([x1, y1, x2, y2]) => y1 === 12 && y2 === 12 && Math.min(x1, x2) === 5 && Math.max(x1, x2) === 19);
    });
  }

  function action(element) {
    const label = text(element.textContent).toLowerCase();
    // Never match plain Buy, Buy Now, Buy players, bid, or confirmations.
    if (/^[+＋]\s*buy$/.test(label) || (label === "buy" && plusIcon(element))) return "buy";
    if (label === "added") return "added";
    return "";
  }

  function disabled(button) {
    return button.disabled || button.getAttribute("aria-disabled") === "true"
      || button.closest("[inert]") || getComputedStyle(button).pointerEvents === "none";
  }

  function rankOf(card) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("svg, button, [role='button'], [hidden], [aria-hidden='true']")) continue;
      const label = text(node.nodeValue);
      if (!label) continue;
      // The screenshot's cards start with a separate ordinal (1, 2, ...).
      // Fail closed if the ordinal cannot be distinguished from price/rating.
      return /^#?\d{1,3}$/.test(label) ? Number(label.replace("#", "")) : null;
    }
    return null;
  }

  function cardFor(button) {
    for (let card = button.parentElement, depth = 0; card && depth < 8; card = card.parentElement, depth++) {
      if (card === document.body || card === document.documentElement) break;
      const controls = [...card.querySelectorAll(CONTROL)].filter((control) => action(control));
      if (controls.length !== 1) break;
      if (!card.querySelector("img") || !visible(card)) continue;
      const rank = rankOf(card);
      if (!rank || rank > 999 || text(card.textContent).length > 900) continue;
      const images = [...card.querySelectorAll("img")].map((image) => image.getAttribute("src") || image.getAttribute("alt") || "");
      const name = [...card.querySelectorAll("h1, h2, h3, h4, span, p, div")]
        .filter((element) => !element.children.length && !element.closest(CONTROL))
        .map((element) => text(element.textContent))
        .filter((label) => /[\p{L}]/u.test(label) && !/^(added|[+＋]\s*buy)$/i.test(label));
      const playerId = card.getAttribute("data-player-id") || card.getAttribute("data-item-id") || "";
      return { card, button, rank, status: action(button), key: JSON.stringify([rank, playerId, images, name]) };
    }
    return null;
  }

  function galleryRoot(card) {
    for (let root = card.parentElement; root && root !== document.body; root = root.parentElement) {
      const label = text(root.textContent);
      if (label.length > 100000) break;
      if (/collected\s*\d/i.test(label) && /missing\s*\d/i.test(label) && visible(root)) return root;
    }
    return null;
  }

  function discover() {
    const groups = new Map();
    for (const button of document.querySelectorAll(CONTROL)) {
      if (!action(button) || !visible(button)) continue;
      const item = cardFor(button);
      if (!item) continue;
      const root = galleryRoot(item.card);
      if (!root) continue;
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(item);
    }
    // Ambiguous overlapping Galleries or dialogs must never trigger clicks.
    if (groups.size !== 1) return null;
    const [root, cards] = [...groups][0];
    if ([...document.querySelectorAll("[role='dialog'], [aria-modal='true'], dialog[open]")]
      .some((dialog) => visible(dialog) && !dialog.contains(root) && dialog !== root)) return null;
    cards.sort((a, b) => a.rank - b.rank);
    if (!cards.length || cards[0].rank !== 1 || new Set(cards.map((card) => card.rank)).size !== cards.length) return null;
    const targets = cards.filter((card) => card.rank <= LIMIT);
    if (targets.some((card, index) => card.rank !== index + 1)) return null;
    const heading = text(root.querySelector("h1, h2, [role='heading']")?.textContent);
    return { root, cards, targets, key: JSON.stringify([location.href, heading, cards[0].key]) };
  }

  function notice(message, error = false) {
    let element = document.getElementById("futgg-first15-notice");
    if (!element) {
      element = document.createElement("div");
      element.id = "futgg-first15-notice";
      element.setAttribute("role", "status");
      Object.assign(element.style, {
        position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)",
        zIndex: "2147483647", padding: "10px 14px", borderRadius: "8px",
        maxWidth: "min(520px, calc(100vw - 40px))", font: "600 13px/1.4 system-ui, sans-serif",
        color: "#fff", pointerEvents: "none", boxShadow: "0 4px 20px #0005"
      });
      document.documentElement.appendChild(element);
    }
    element.textContent = message;
    element.style.background = error ? "#9f3030" : "#176b45";
    element.hidden = false;
    clearTimeout(element._hide);
    element._hide = setTimeout(() => { element.hidden = true; }, error ? 7000 : 3000);
  }

  function tick() {
    if (!state.enabled || document.hidden) return;
    const now = Date.now();
    const gallery = discover();
    if (!gallery) {
      if (state.absentSince === null) state.absentSince = now;
      if (now - state.absentSince > 1400) state.session = null;
      return;
    }
    state.absentSince = null;
    if (!state.session || state.session.key !== gallery.key) {
      state.session = { key: gallery.key, signature: "", stableAt: now, seen: new Set(), pending: null, stopped: false, clicked: 0, announced: false };
    }
    const session = state.session;
    if (session.stopped) return;
    const signature = JSON.stringify(gallery.targets.map((item) => item.key));
    if (session.signature !== signature) {
      session.signature = signature;
      session.stableAt = now;
    }
    // Existing selections count toward the limit and are never clicked again.
    for (const item of gallery.targets) if (item.status === "added") session.seen.add(item.key);
    if (session.pending) {
      const item = gallery.cards.find((candidate) => candidate.key === session.pending.key);
      if (item?.status === "added") session.pending = null;
      else if (now - session.pending.at >= ACK_MS) {
        session.stopped = true;
        notice("Auto-select paused: the last player did not show Added. Reopen the Gallery or toggle auto-select to retry.", true);
        return;
      } else return;
    }
    if (now - session.stableAt < SETTLE_MS) return;
    const selected = gallery.cards.filter((item) => item.status === "added").length;
    if (selected >= LIMIT || session.clicked >= LIMIT) {
      if (!session.announced && session.clicked) {
        notice("Gallery: selection limit reached (15). Purchasing has not been started.");
        session.announced = true;
      }
      return;
    }
    const next = gallery.targets.find((item) => !session.seen.has(item.key) && item.status === "buy" && !disabled(item.button));
    if (!next) {
      if (!session.announced && session.clicked && gallery.targets.every((item) => session.seen.has(item.key))) {
        notice(`Gallery: ${gallery.targets.length} first-player selections handled. Purchasing has not been started.`);
        session.announced = true;
      }
      return;
    }
    // Read fresh nodes on every tick, click only one, then require Added before
    // continuing. A failed click is not blindly retried, and #16+ is untouched.
    session.seen.add(next.key);
    session.pending = { key: next.key, at: now };
    session.clicked++;
    if (!next.button.isConnected || action(next.button) !== "buy") return;
    next.button.click();
  }

  function safelyTick() {
    try { tick(); }
    catch (error) {
      if (state.session) state.session.stopped = true;
      console.warn("FUT.GG Gallery auto-select paused:", error);
    }
  }

  function start() {
    chrome.storage.local.get({ [SETTING]: true }, (settings) => {
      if (chrome.runtime.lastError) return;
      state.enabled = settings[SETTING] !== false;
      safelyTick();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[SETTING]) return;
      state.enabled = changes[SETTING].newValue !== false;
      state.session = null;
      state.absentSince = null;
      safelyTick();
    });
    // Poll only controls, not every DOM node; no global mutation observer or
    // automatic scrolling/navigation, and no fetching or EA API requests.
    setInterval(safelyTick, POLL_MS);
    document.addEventListener("click", (event) => {
      if (!event.isTrusted || !state.session || !(event.target instanceof Element)) return;
      const button = event.target.closest(CONTROL);
      const item = button && action(button) && cardFor(button);
      // Respect a manual deselection instead of immediately selecting it again.
      if (item) state.session.seen.add(item.key);
    }, true);
  }

  start();
})();
