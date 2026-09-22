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

  function applyIds(ids) {
    const field = findGalleryField();
    if (!field) {
      return { ok: false, reason: "The FUT Enhancer player-ID field was not found. Keep the Buy players modal open and try again." };
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

  function galleryTeamHint(card) {
    const attributes = [
      "data-team-name", "data-club-name", "data-team", "data-club",
      "data-team-slug", "data-club-slug", "data-slug"
    ];
    for (const name of attributes) {
      const value = card.getAttribute(name)?.trim();
      if (value && !/^\d+$/.test(value)) return value;
    }

    const link = card.matches("a[href]") ? card : card.querySelector("a[href]");
    const href = link?.getAttribute("href") || "";
    const match = href.match(/\/fut-gallery\/[^/]+\/([^/?#]+)/i);
    return match?.[1]?.replace(/-/g, " ") || "";
  }

  function findGalleryTeamName(card) {
    const explicit = galleryTeamHint(card) || card.getAttribute("aria-label");
    if (explicit) return explicit.replace(/\s+FUT Gallery Set.*$/i, "").trim();
    const heading = card.querySelector("h1, h2, h3, h4, [class*='team-name'], [class*='club-name'], [class*='title']");
    if (heading?.textContent?.trim()) return heading.textContent.replace(/\s+FUT Gallery Set.*$/i, "").trim();

    const ignored = /^(gallery|buy players|sync collection|collected|base score|grade|tokens|items|coins needed|total price|score|available|players?|needed|d|c|b|a|s)$/i;
    const candidates = [...card.querySelectorAll("span, p, strong, b, div")]
      .map((element) => element.textContent.replace(/\s+/g, " ").trim())
      .filter((text, index, values) => text && text.length <= 60 && !ignored.test(text)
        && !/^\d[\d,./\s-]*$/.test(text)
        && !values.some((other, otherIndex) => otherIndex !== index && other.length < text.length && other && text === other));
    return candidates.sort((a, b) => {
      const score = (value) => (value.split(" ").length > 1 ? 0 : 1) * 100 + value.length;
      return score(a) - score(b);
    })[0] || "";
  }

  function isGalleryCard(element) {
    if (!element || element.children.length > 80) return false;
    const text = normalize(element.textContent);
    if (text.length > 700) return false;
    return text.includes("collected") && text.includes("base score") && text.includes("tokens");
  }

  function installGalleryCardHandlers() {
    const cards = [...document.querySelectorAll("a, button, [role='button'], article, section, li, div")]
      .filter((element) => isGalleryCard(element));
    const cardSet = new Set(cards);
    const compact = cards.filter((card) => {
      for (let parent = card.parentElement; parent; parent = parent.parentElement) {
        if (cardSet.has(parent)) return false;
      }
      return true;
    });

    for (const card of compact) {
      if (card.dataset.futggExtractorBound === "true") continue;
      const teamName = findGalleryTeamName(card);
      if (!teamName) continue;
      card.dataset.futggExtractorBound = "true";
      card.style.cursor = "pointer";
      card.title = `${teamName} — extract players with FUT.GG Player ID Extractor`;
      card.addEventListener("click", (event) => {
        // The card itself may be a button or link. Only let real form controls
        // inside it keep their native behavior; do not reject clicks on nested
        // spans or on the card's own anchor/button element.
        const control = event.target.closest("input, select, textarea, [contenteditable='true']");
        if (control && control !== card) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        card.classList.add("futgg-extractor-loading");
        chrome.runtime.sendMessage({
          type: "galleryTeamClicked",
          teamName,
          teamSlug: galleryTeamHint(card)
        }, (response) => {
          card.classList.remove("futgg-extractor-loading");
          if (chrome.runtime.lastError || !response?.ok) {
            console.warn("FUT.GG Player ID Extractor:", chrome.runtime.lastError?.message || response?.reason || "Could not extract this team.");
          }
        });
      }, true);
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

  function applyGalleryTeamIds(ids) {
    const result = applyIds(ids);
    if (!result.ok) return result;
    const field = findGalleryField();
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    return result;
  }

  watchGallery();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "applyGalleryTeamIds") {
      sendResponse(applyGalleryTeamIds(message.ids));
      return;
    }
    if (message?.type === "applyFutEnhancerIds") {
      sendResponse(applyIds(message.ids));
      return;
    }
    if (message?.type === "syncSellPrices") {
      syncSellPrices().then(sendResponse);
      return true;
    }
  });
})();
