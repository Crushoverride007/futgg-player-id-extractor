(() => {
  const FIELD_TEXT = "comma separated ids";
  const FIELD_SELECTOR = "input:not([type]), input[type='text'], input[type='search'], input[type='number'], textarea, [contenteditable='true']";

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isUsableField(field) {
    if (!field || field.disabled || field.readOnly) return false;
    if (field instanceof HTMLInputElement && ["hidden", "checkbox", "radio", "button", "submit"].includes(field.type)) return false;
    return field.matches(FIELD_SELECTOR);
  }

  function visible(field) {
    const style = getComputedStyle(field);
    const rect = field.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function nearbyText(field) {
    const parts = [];
    const parent = field.parentElement;
    const container = field.closest("[role='dialog'], form, section") || parent?.parentElement || parent;
    if (container) parts.push(container.textContent);
    if (field.id) {
      document.querySelectorAll(`label[for="${CSS.escape(field.id)}"]`).forEach((label) => parts.push(label.textContent));
    }
    return normalize(parts.join(" "));
  }

  function findGalleryField() {
    const fields = [...document.querySelectorAll(FIELD_SELECTOR)]
      .filter((field) => isUsableField(field) && visible(field));

    // FUT Enhancer's current Buy players modal has one visible search input.
    const labelled = fields.find((field) => {
      const attributes = normalize([
        field.getAttribute("placeholder"),
        field.getAttribute("aria-label"),
        field.getAttribute("name"),
        nearbyText(field)
      ].join(" "));
      return attributes.includes(FIELD_TEXT) || attributes.includes("player name");
    });

    return labelled || fields.find((field) => {
      const containerText = nearbyText(field);
      return containerText.includes("buy players") && containerText.includes(FIELD_TEXT);
    });
  }

  function setReactValue(field, value, commit = true) {
    if (!field) return;
    field.focus();

    if (field.isContentEditable) {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    } else {
      field.select?.();
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
      field.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: String(value)
      }));
    }

    field.dispatchEvent(new Event("keyup", { bubbles: true, composed: true }));
    if (commit) {
      field.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      field.blur();
    }
  }

  function findBuyPlayersButton() {
    return [...document.querySelectorAll("button, [role='button'], a")]
      .filter(visible)
      .find((button) => normalize([
        button.textContent,
        button.getAttribute("aria-label"),
        button.getAttribute("title")
      ].join(" ")) === "buy players");
  }

  function waitForGalleryField(timeout = 5000) {
    const existing = findGalleryField();
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve) => {
      const started = Date.now();
      const observer = new MutationObserver(() => {
        const field = findGalleryField();
        if (field) {
          observer.disconnect();
          resolve(field);
        } else if (Date.now() - started >= timeout) {
          observer.disconnect();
          resolve(null);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

      const poll = () => {
        const field = findGalleryField();
        if (field) {
          observer.disconnect();
          resolve(field);
        } else if (Date.now() - started < timeout) {
          setTimeout(poll, 100);
        } else {
          observer.disconnect();
          resolve(null);
        }
      };
      setTimeout(poll, 100);
    });
  }

  async function applyIds(ids, openBuyPlayers = false) {
    let field = findGalleryField();
    if (!field && openBuyPlayers) {
      const button = findBuyPlayersButton();
      if (button) {
        button.click();
        field = await waitForGalleryField();
      }
    }
    if (!field) {
      return { ok: false, reason: "The FUT Enhancer player-ID field was not found. Open Buy players and try again." };
    }
    setReactValue(field, ids);
    return { ok: true };
  }

  function priceInput(field) {
    if (!field || field.disabled || field.readOnly) return false;
    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) return false;
    return !["hidden", "checkbox", "radio", "button", "submit", "range"].includes(field.type);
  }

  function visiblePriceInput(field) {
    return priceInput(field) && visible(field);
  }

  function findPriceTable() {
    const candidates = [...document.querySelectorAll("table, [role='table'], section, div")]
      .filter((element) => {
        if (!visible(element)) return false;
        const text = normalize(element.textContent);
        const inputs = [...element.querySelectorAll("input, textarea")].filter(priceInput);
        return text.includes("buy prices") && text.includes("sell price") && inputs.length >= 2;
      });

    // Select the smallest element containing both column headings and inputs.
    return candidates.sort((a, b) => {
      const inputDifference = a.querySelectorAll("input, textarea").length - b.querySelectorAll("input, textarea").length;
      return inputDifference || a.getBoundingClientRect().height - b.getBoundingClientRect().height;
    })[0];
  }

  function fieldRows(table = findPriceTable()) {
    if (!table) return [];

    // FUT Enhancer renders each item as a semantic row with Price and Sell price
    // inputs. Use that relationship first; geometry alone can pair fields from
    // different CSS grid columns when one input is blank or re-rendered.
    const semanticRows = [...table.querySelectorAll("tr, [role='row']")]
      .map((row) => [...row.querySelectorAll("input, textarea")].filter(visiblePriceInput))
      .filter((fields) => fields.length >= 2)
      .map((fields) => {
        fields.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        return [fields[0], fields[fields.length - 1]];
      });
    if (semanticRows.length) return semanticRows;

    // Fallback for versions using a CSS grid without row semantics.
    const fields = [...table.querySelectorAll("input, textarea")]
      .filter(visiblePriceInput)
      .map((field) => ({ field, rect: field.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    const rows = [];
    for (const entry of fields) {
      const centerY = entry.rect.top + entry.rect.height / 2;
      let row = rows.find((candidate) => Math.abs(candidate.centerY - centerY) <= Math.max(10, entry.rect.height * 0.65));
      if (!row) {
        row = { centerY, fields: [] };
        rows.push(row);
      }
      row.fields.push(entry);
    }

    return rows
      .map((row) => row.fields.sort((a, b) => a.rect.left - b.rect.left).map((entry) => entry.field))
      .filter((fields) => fields.length >= 2)
      .map((fields) => [fields[0], fields[fields.length - 1]]);
  }

  function waitForTablePaint(delay = 120) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, delay)));
    });
  }

  function scrollContainers(table) {
    const ancestors = [];
    for (let element = table; element; element = element.parentElement) ancestors.push(element);
    const elements = [...new Set([...ancestors, ...table.querySelectorAll("*")])];
    const containers = elements.filter((element) => {
      const style = getComputedStyle(element);
      const canScroll = ["auto", "scroll", "overlay"].includes(style.overflowY);
      return canScroll && element.scrollHeight > element.clientHeight + 2;
    });

    return containers.sort((a, b) => (a.scrollHeight - a.clientHeight) - (b.scrollHeight - b.clientHeight));
  }

  function rowSignature(fields) {
    const buyField = fields[0];
    const row = buyField.closest("tr, [role='row'], li") || buyField.parentElement?.parentElement;
    const image = row?.querySelector("img");
    const imageKey = image?.currentSrc || image?.src || image?.alt || "";
    const label = row?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) || "";
    return `${imageKey}|${label}|${String(buyField.value || "").trim()}`;
  }

  function usableTeamName(value) {
    const text = String(value || "").replace(/\s+FUT Gallery Set.*$/i, "").replace(/\s+/g, " ").trim();
    if (text.length < 3 || text.length > 60 || /^\d[\d,./%\s-]*$/.test(text)) return "";
    if (/^(x|close|gallery|buy players|sync collection|collected|base score|grade|tokens?|items|coins needed|total price|score|available|players?|needed|d|c|b|a|s)$/i.test(text)) return "";
    return text;
  }

  function galleryTeamHint(card) {
    const attributes = [
      "data-team-name", "data-club-name", "data-team", "data-club",
      "data-team-slug", "data-club-slug", "data-slug"
    ];
    for (const name of attributes) {
      const value = usableTeamName(card.getAttribute(name));
      if (value && !/^\d+$/.test(value)) return value;
    }

    const link = card.matches("a[href]") ? card : card.querySelector("a[href]");
    const href = link?.getAttribute("href") || "";
    const match = href.match(/\/fut-gallery\/[^/]+\/([^/?#]+)/i);
    return usableTeamName(match?.[1]?.replace(/-/g, " "));
  }

  function findGalleryTeamName(card) {
    const explicit = usableTeamName(galleryTeamHint(card) || card.getAttribute("aria-label"));
    if (explicit) return explicit;

    const heading = card.querySelector("h1, h2, h3, h4, [class*='team-name'], [class*='club-name']");
    const headingName = usableTeamName(heading?.textContent);
    if (headingName) return headingName;

    // Ignore icon text such as the single-character close button. The actual
    // club name is normally a longer text node beside the crest.
    const directText = [...card.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => usableTeamName(node.textContent))
      .find(Boolean);
    if (directText) return directText;

    const ignored = /^(gallery|buy players|sync collection|collected|base score|grade|tokens?|items|coins needed|total price|score|available|players?|needed|d|c|b|a|s)$/i;
    const metricText = /(collected|base score|tokens?|coins needed|total price)/i;
    const candidates = [...card.querySelectorAll("span, p, strong, b, div")]
      .filter((element) => element.children.length === 0)
      .map((element) => usableTeamName(element.textContent))
      .filter((text, index, values) => text && !ignored.test(text) && !metricText.test(text)
        && !values.some((other, otherIndex) => otherIndex !== index && other.length < text.length && other && text === other));

    return candidates.sort((a, b) => {
      const score = (value) => value.split(" ").length * 10 + value.length;
      return score(a) - score(b);
    })[0] || "";
  }

  function isGalleryCard(element) {
    if (!element || element.children.length > 80) return false;
    const text = normalize(element.textContent);
    if (text.length > 700) return false;
    // Restrict detection to the compact visual team-card shape. Without this
    // guard, a page-level container can contain the same labels and swallow
    // clicks on the real Gallery navigation button.
    const rect = element.getBoundingClientRect?.();
    if (rect && (rect.width < 180 || rect.width > 700 || rect.height < 100 || rect.height > 380)) return false;
    const collectedCount = (text.match(/collected/g) || []).length;
    const baseScoreCount = (text.match(/base score/g) || []).length;
    if (collectedCount !== 1 || baseScoreCount !== 1) return false;
    if (!element.querySelector("img, svg")) return false;
    // Current FUT Enhancer cards expose the token icon as an image, so the
    // accessible/text content contains the count but not the word "tokens".
    return Boolean(findGalleryTeamName(element));
  }

  function showGalleryNotice(message, error = false) {
    let notice = document.getElementById("futgg-extractor-gallery-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "futgg-extractor-gallery-notice";
      Object.assign(notice.style, {
        position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
        zIndex: "2147483647", maxWidth: "min(560px, calc(100vw - 40px))", padding: "12px 16px",
        borderRadius: "8px", font: "600 14px/1.35 system-ui, sans-serif", color: "#fff",
        boxShadow: "0 8px 28px rgba(0,0,0,.35)", pointerEvents: "none"
      });
      document.documentElement.appendChild(notice);
    }
    notice.textContent = message;
    notice.style.background = error ? "#a32929" : "#176b45";
    notice.style.display = "block";
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => { notice.style.display = "none"; }, error ? 7000 : 3500);
  }

  function isGalleryCardsView() {
    const title = normalize(document.title);
    const body = normalize(document.body?.textContent).slice(0, 5000);
    const hasGalleryHeading = body.includes("serie a enilive") || body.includes("gallery set") || body.includes("collected") && body.includes("base score");
    const hasBuyModal = body.includes("buy players") && body.includes("comma separated ids");
    const hasTeamCards = [...document.querySelectorAll("img, svg")].some((image) => {
      const alt = normalize(image.getAttribute("alt"));
      return alt.includes("club") || alt.includes("team") || alt.includes("crest") || alt.includes("logo");
    });
    return !hasBuyModal && (title.includes("gallery") || hasGalleryHeading) && hasTeamCards;
  }

  function findGalleryCardFromTarget(target) {
    if (!isGalleryCardsView()) return null;
    for (let element = target instanceof Element ? target : null; element && element !== document.body; element = element.parentElement) {
      if (isGalleryCard(element)) return element;
    }
    return null;
  }

  function handleGalleryCardClick(event) {
    // Never intercept navigation or modal controls. The Gallery route button
    // lives on the same page as the cards and must keep the app's own handler.
    const interactive = event.target.closest("button, a, [role='button']");
    if (interactive && !isGalleryCard(interactive)) return;

    const card = findGalleryCardFromTarget(event.target);
    if (!card) return;

    const control = event.target.closest("input, select, textarea, [contenteditable='true']");
    if (control) return;

    const teamName = findGalleryTeamName(card);
    if (!teamName) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    card.classList.add("futgg-extractor-loading");
    showGalleryNotice(`Loading ${teamName} player IDs…`);
    chrome.runtime.sendMessage({
      type: "galleryTeamClicked",
      teamName,
      teamSlug: galleryTeamHint(card)
    }, (response) => {
      card.classList.remove("futgg-extractor-loading");
      if (chrome.runtime.lastError || !response?.ok) {
        const reason = chrome.runtime.lastError?.message || response?.reason || "Could not extract this team.";
        console.warn("FUT.GG Player ID Extractor:", reason);
        showGalleryNotice(reason, true);
      } else {
        showGalleryNotice(`${teamName}: ${response.count} IDs inserted into Buy players.`);
      }
    });
  }

  function installGalleryCardHandlers() {
    if (!document.documentElement.dataset.futggExtractorDelegated) {
      document.documentElement.dataset.futggExtractorDelegated = "true";
      document.addEventListener("click", handleGalleryCardClick, true);
    }

    if (!isGalleryCardsView()) return;

    // Add a pointer cue to currently rendered cards. The delegated handler is
    // intentionally document-level because React can replace card nodes.
    const cards = [...document.querySelectorAll("a, button, [role='button'], article, section, li, div")]
      .filter((element) => isGalleryCard(element));
    const cardSet = new Set(cards);
    for (const card of cards) {
      if ([...card.parentElement ? card.parentElement.children : []].some((sibling) => sibling !== card && cardSet.has(sibling))) {
        card.style.cursor = "pointer";
        card.title = `${findGalleryTeamName(card)} — extract players with FUT.GG Player ID Extractor`;
      }
    }
  }

  function watchGallery() {
    installGalleryCardHandlers();
    const observer = new MutationObserver(() => installGalleryCardHandlers());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function pageButton(direction) {
    const wanted = direction === "next" ? "next page" : "previous page";
    return [...document.querySelectorAll("button, [role='button']")]
      .filter(visible)
      .find((button) => normalize([
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.textContent
      ].join(" ")).includes(wanted));
  }

  function buttonDisabled(button) {
    return !button || button.disabled || button.getAttribute("aria-disabled") === "true";
  }

  async function changePage(direction) {
    const button = pageButton(direction);
    if (buttonDisabled(button)) return false;
    button.click();
    await waitForTablePaint(260);
    return true;
  }

  async function syncCurrentPage() {
    const table = findPriceTable();
    if (!table) return { ok: false, updated: 0, rows: 0 };

    const containers = scrollContainers(table);
    const originalPositions = containers.map((container) => ({ container, top: container.scrollTop }));
    const processed = new Set();
    let updated = 0;
    let rows = 0;
    let failed = 0;

    const applyRowValue = async (signature, value) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        // Re-query after every write because FUT Enhancer may replace the whole
        // row when React commits a controlled input update.
        const current = fieldRows(table).find((candidate) => rowSignature(candidate) === signature);
        const sellField = current?.[1];
        if (!sellField) return false;
        if (String(sellField.value || "").replace(/,/g, "").trim() === value) return true;

        setReactValue(sellField, value, true);
        await new Promise((resolve) => setTimeout(resolve, 90));
        const verified = fieldRows(table).find((candidate) => rowSignature(candidate) === signature)?.[1];
        if (String(verified?.value || "").replace(/,/g, "").trim() === value) return true;
      }
      return false;
    };

    const processVisibleRows = async () => {
      const candidates = fieldRows(table).map((fields) => ({
        signature: rowSignature(fields),
        value: String(fields[0].value || "").replace(/,/g, "").trim()
      }));

      for (const candidate of candidates) {
        rows += 1;
        if (!/^\d+$/.test(candidate.value) || Number(candidate.value) <= 0) continue;
        if (processed.has(candidate.signature)) continue;

        const applied = await applyRowValue(candidate.signature, candidate.value);
        if (applied) {
          processed.add(candidate.signature);
          updated += 1;
        } else {
          failed += 1;
        }
      }
    };

    // Process every rendered row, then walk the internal virtualized scroll list.
    await processVisibleRows();
    for (const container of containers.slice(0, 1)) {
      container.scrollTop = 0;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      await waitForTablePaint();

      let previousTop = -1;
      while (container.scrollTop !== previousTop) {
        previousTop = container.scrollTop;
        await processVisibleRows();
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) break;
        container.scrollTop = Math.min(
          container.scrollTop + Math.max(80, Math.floor(container.clientHeight * 0.8)),
          container.scrollHeight - container.clientHeight
        );
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
        await waitForTablePaint();
      }
    }

    for (const { container, top } of originalPositions) {
      container.scrollTop = top;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    return { ok: rows > 0, updated, rows, failed };
  }

  async function syncSellPrices() {
    if (!findPriceTable()) {
      return { ok: false, reason: "No FUT Enhancer price rows were found. Open the gallery price table first." };
    }

    let pages = 0;
    let updated = 0;
    let rows = 0;
    let failed = 0;

    const scan = async () => {
      const result = await syncCurrentPage();
      if (!result.ok && !result.rows) return false;
      pages += 1;
      updated += result.updated;
      rows += result.rows;
      failed += result.failed;
      return true;
    };

    await scan();

    let forward = 0;
    while (await changePage("next")) {
      forward += 1;
      await scan();
    }

    // Restore the page where the user started before scanning earlier pages.
    for (let index = 0; index < forward; index += 1) await changePage("previous");

    let backward = 0;
    while (await changePage("previous")) {
      backward += 1;
      await scan();
    }

    // Restore the original page after scanning from the beginning.
    for (let index = 0; index < backward; index += 1) await changePage("next");

    if (!rows) {
      return { ok: false, reason: "No FUT Enhancer price rows were found. Open the gallery price table first." };
    }
    return { ok: true, updated, rows, failed, pages };
  }

  async function applyGalleryTeamIds(ids) {
    const result = await applyIds(ids, true);
    const field = findGalleryField();
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    return result;
  }

  watchGallery();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "applyGalleryTeamIds") {
      applyGalleryTeamIds(message.ids).then(sendResponse);
      return true;
    }
    if (message?.type === "applyFutEnhancerIds") {
      applyIds(message.ids, false).then(sendResponse);
      return true;
    }
    if (message?.type === "syncSellPrices") {
      syncSellPrices().then(sendResponse);
      return true;
    }
  });
})();
