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
    field.focus({ preventScroll: true });

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

    // The price grid has no reliable row semantics. Pair each buy input with
    // the nearest sell input by vertical position, then require the sell field
    // to be to its right. This also works when the sell field is still blank.
    const allFields = [...table.querySelectorAll("input, textarea")].filter(visiblePriceInput);
    const buyFields = allFields.filter((field) => {
      const rect = field.getBoundingClientRect();
      return allFields.some((other) => {
        const otherRect = other.getBoundingClientRect();
        return other !== field && otherRect.left > rect.right - 4 && Math.abs(otherRect.top - rect.top) <= Math.max(12, rect.height * 0.7);
      });
    });
    const geometricRows = buyFields.map((buyField) => {
      const buyRect = buyField.getBoundingClientRect();
      const sellField = allFields
        .filter((field) => field !== buyField)
        .map((field) => ({ field, rect: field.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left > buyRect.right - 4 && Math.abs(rect.top - buyRect.top) <= Math.max(12, buyRect.height * 0.7))
        .sort((a, b) => Math.abs(a.rect.top - buyRect.top) - Math.abs(b.rect.top - buyRect.top) || a.rect.left - b.rect.left)[0]?.field;
      return sellField ? [buyField, sellField] : null;
    }).filter(Boolean);
    if (geometricRows.length) return geometricRows;

    // Fallback for versions exposing semantic rows.
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

  function waitForPageChange(previousSnapshot, timeout = 6000) {
    return new Promise((resolve) => {
      const started = Date.now();
      let candidate = "";
      let stableChecks = 0;

      const check = () => {
        const table = findPriceTable();
        const snapshot = pageSnapshot(table);
        const changed = Boolean(snapshot && snapshot !== previousSnapshot);

        if (changed) {
          if (snapshot === candidate) stableChecks += 1;
          else {
            candidate = snapshot;
            stableChecks = 0;
          }
          // React may render the new page in several commits. Require the same
          // rows on consecutive checks before scanning them.
          if (stableChecks >= 2) {
            resolve(true);
            return;
          }
        }

        if (Date.now() - started >= timeout) {
          resolve(false);
          return;
        }
        setTimeout(check, 120);
      };

      check();
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

  function rowIdentity(fields) {
    const [buyField, sellField] = fields;
    let row = buyField.closest("tr, [role='row'], li");
    if (!row?.contains(sellField)) row = null;

    // Input wrappers are not player rows. Find a common ancestor containing
    // both price fields, stopping before a container for multiple players.
    if (!row) {
      for (let parent = buyField.parentElement; parent; parent = parent.parentElement) {
        if (!parent.contains?.(sellField)) continue;
        if (parent.querySelectorAll("input, textarea").length > 2) break;
        row = parent;
        if (parent.querySelector("img")) break;
      }
    }
    const image = row?.querySelector("img");
    const imageKey = image?.currentSrc || image?.src || image?.alt || "";
    const itemKey = ["data-item-id", "data-player-id", "data-row-key", "aria-rowindex"]
      .map((name) => row?.getAttribute(name) || "").join("|");
    const label = row?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) || "";
    return `${itemKey}|${imageKey}|${label}`;
  }

  function rowSignature(fields) {
    const buyField = fields[0];
    return `${rowIdentity(fields)}|${String(buyField.value || "").trim()}`;
  }

  function pageSnapshot(table = findPriceTable()) {
    if (!table) return "";
    return fieldRows(table)
      .map((fields) => `${rowIdentity(fields)}=>${String(fields[0]?.value || "").replace(/,/g, "").trim()}`)
      .join("||");
  }

  function cleanGalleryTeamName(value) {
    const text = String(value || "")
      .replace(/\s+FUT Gallery Set.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";

    // Some cards expose the whole accessible label instead of only the club
    // name, for example `GenoaDCBAS1,152/2,000Grade B is...`.
    const compact = text.replace(/\s+/g, "");
    const marker = [
      compact.search(/dcbas(?=\d|[,/])/i),
      compact.search(/collected/i),
      compact.search(/basescore/i),
      compact.search(/\d[\d,]*\/\d[\d,]*/i),
      compact.search(/grade/i)
    ].filter((index) => index > 0).sort((a, b) => a - b)[0];
    return marker === undefined ? text : compact.slice(0, marker).replace(/[-_]+$/, "").trim();
  }

  function usableTeamName(value) {
    const text = cleanGalleryTeamName(value);
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

  function cardNameFromMetrics(card) {
    const raw = String(card?.textContent || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";

    // FUT Enhancer can render the club name and grade row without separators,
    // for example `GenoaDCBAS1,152/2,000Grade...`. Cut at the first metric.
    const compact = raw.replace(/\s+/g, "");
    const marker = [
      compact.search(/dcbas/i),
      compact.search(/collected/i),
      compact.search(/basescore/i),
      compact.search(/\d[\d,]*\/\d[\d,]*/i),
      compact.search(/grade/i)
    ].filter((index) => index > 0).sort((a, b) => a - b)[0];
    if (marker === undefined) return "";

    const prefix = compact.slice(0, marker)
      .replace(/[^\p{L}\p{N}&' .-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    return usableTeamName(prefix);
  }

  function findGalleryTeamName(card) {
    const hinted = usableTeamName(galleryTeamHint(card));
    if (hinted) return hinted;

    const aria = card.getAttribute("aria-label");
    const ariaName = aria && !/(collected|base score|grade|tokens?)/i.test(aria)
      ? usableTeamName(aria) : "";
    if (ariaName) return ariaName;

    const heading = card.querySelector("h1, h2, h3, h4, [class*='team-name'], [class*='club-name']");
    const headingName = usableTeamName(heading?.textContent);
    if (headingName) return headingName;

    const parsed = cardNameFromMetrics(card);
    if (parsed) return parsed;

    // Final fallback: inspect leaf text only after the metric-prefix parser.
    const ignored = /^(gallery|buy players|sync collection|collected|base score|grade|tokens?|items|coins needed|total price|score|available|players?|needed|d|c|b|a|s)$/i;
    const metricText = /(collected|base score|tokens?|coins needed|total price|grade)/i;
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
    // Only visible, compact team cards qualify. This prevents hidden cards or
    // route-level containers from swallowing clicks on league/navigation cards.
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 180 || rect.width > 700 || rect.height < 100 || rect.height > 380) return false;
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

  function visibleGalleryCards() {
    return [...document.querySelectorAll("a, button, [role='button'], article, section, li, div")]
      .filter((element) => isGalleryCard(element))
      .filter((element) => {
        const parent = element.parentElement;
        return !parent || ![...parent.children].some((sibling) => sibling !== element && isGalleryCard(sibling) && sibling.contains(element));
      });
  }

  function isGalleryCardsView() {
    const body = normalize(document.body?.textContent).slice(0, 5000);
    const hasBuyModal = body.includes("buy players") && body.includes("comma separated ids");
    // League/category screens have no visible team cards. Requiring multiple
    // rendered cards prevents the handler from affecting route transitions.
    return !hasBuyModal && visibleGalleryCards().length >= 2;
  }

  function findGalleryCardFromTarget(target) {
    if (!isGalleryCardsView()) return null;
    const element = target instanceof Element ? target : null;
    if (!element) return null;
    return visibleGalleryCards()
      .filter((card) => card === element || card.contains(element))
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      })[0] || null;
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

    // Do not cancel or stop the site's event. FC Enhancer owns the Gallery
    // and league navigation; this extension only observes the team-card click.
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
    if (document.documentElement.dataset.futggExtractorDelegated === "true") return;
    document.documentElement.dataset.futggExtractorDelegated = "true";
    // One lightweight bubbling listener is enough. Do not scan the whole DOM
    // or observe every React mutation: that can interfere with FC Enhancer's
    // route rendering and leave a blank league page.
    document.addEventListener("click", handleGalleryCardClick, false);
  }

  function watchGallery() {
    installGalleryCardHandlers();
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

    const previousSnapshot = pageSnapshot();
    button.click();
    const changed = await waitForPageChange(previousSnapshot);
    if (!changed) return false;
    await waitForTablePaint(180);
    return true;
  }

  async function syncCurrentPage() {
    const initialTable = findPriceTable();
    if (!initialTable) return { ok: false, updated: 0, rows: 0 };

    const containers = scrollContainers(initialTable);
    const originalPositions = containers.map((container) => ({ container, top: container.scrollTop }));
    const observations = new Map();

    const recordRows = () => {
      const occurrences = new Map();
      for (const fields of fieldRows(findPriceTable())) {
        const identity = rowIdentity(fields);
        const occurrence = occurrences.get(identity) || 0;
        occurrences.set(identity, occurrence + 1);
        const value = priceValue(fields[0]);
        // Keys are for accounting only, never for deciding which input to edit.
        // Equal-price players and even identical labels must not be skipped.
        observations.set(JSON.stringify([identity, occurrence]), {
          eligible: validBuyPrice(value),
          matched: priceValue(fields[1]) === value
        });
      }
    };

    const processVisibleRows = async () => {
      for (let pass = 0; pass < 4; pass += 1) {
        const count = fieldRows(findPriceTable()).length;
        for (let index = 0; index < count; index += 1) {
          // Re-read the actual pair immediately before every write. Do not find
          // a target using price/text signatures: different players share them.
          const fields = fieldRows(findPriceTable())[index];
          if (!fields) continue;
          const [buyField, sellField] = fields;
          const value = priceValue(buyField);
          if (!validBuyPrice(value) || priceValue(sellField) === value) continue;
          // Leave an in-progress manual edit alone; blur/input polling retries it.
          if (document.activeElement === buyField || document.activeElement === sellField) continue;

          setReactValue(sellField, value, true);
          await new Promise((resolve) => setTimeout(resolve, 90));
        }
        recordRows();
        if (!tableNeedsSellSync()) break;
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

    await waitForTablePaint();
    // A controlled value can revert when scrolling causes a row to remount.
    await processVisibleRows();
    const values = [...observations.values()];
    const rows = values.length;
    const eligible = values.filter((entry) => entry.eligible).length;
    const updated = values.filter((entry) => entry.eligible && entry.matched).length;
    return { ok: rows > 0, updated, rows, eligible, failed: eligible - updated };
  }

  async function syncSellPrices() {
    if (!findPriceTable()) {
      return { ok: false, reason: "No FUT Enhancer price rows were found. Open the gallery price table first." };
    }

    let pages = 0;
    let updated = 0;
    let rows = 0;
    let eligible = 0;
    let failed = 0;

    const scan = async () => {
      const result = await syncCurrentPage();
      if (!result.ok && !result.rows) return false;
      pages += 1;
      updated += result.updated;
      rows += result.rows;
      eligible += result.eligible || 0;
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
    return { ok: true, updated, rows, eligible, failed, pages };
  }

  const automaticSyncState = {
    timer: null,
    timerDue: 0,
    queued: null,
    running: false,
    pending: null,
    observedTable: null,
    lastKey: "",
    blockedKey: "",
    retryCount: 0,
    observer: null,
    mutationTimer: null,
    pollTimer: null
  };

  function priceValue(field) {
    return String(field?.value || "").replace(/,/g, "").trim();
  }

  function validBuyPrice(value) {
    return /^\d+$/.test(value) && Number(value) > 0;
  }

  function automaticSyncKey(table = findPriceTable()) {
    if (!table) return "";
    return JSON.stringify(fieldRows(table).map((fields, index) => [
      index, rowIdentity(fields), priceValue(fields[0]), priceValue(fields[1])
    ]));
  }

  function tableHasBuyValues(table = findPriceTable()) {
    return fieldRows(table).some(([buyField]) => validBuyPrice(priceValue(buyField)));
  }

  function tableNeedsSellSync(table = findPriceTable()) {
    return fieldRows(table).some(([buyField, sellField]) => {
      const value = priceValue(buyField);
      return validBuyPrice(value) && priceValue(sellField) !== value;
    });
  }

  function buyFieldInTable(field, table = findPriceTable()) {
    if (!field || !table) return false;
    return fieldRows(table).some(([buyField]) => buyField === field);
  }

  function mergeSyncRequest(previous, request) {
    if (!previous) return request;
    return {
      reason: previous.force ? previous.reason : request.reason,
      delay: Math.min(previous.delay, request.delay),
      force: previous.force || request.force
    };
  }

  function queueFailedSyncRetry() {
    automaticSyncState.lastKey = "";
    if (automaticSyncState.retryCount < 4) {
      automaticSyncState.retryCount += 1;
      scheduleAutomaticSellSync("retry", 900, true);
    } else {
      // Stop trying an unchanged, rejected value forever. A changed row/value
      // or a closed and reopened table allows a new bounded attempt sequence.
      automaticSyncState.blockedKey = automaticSyncKey();
      console.warn("FUT.GG sell sync: some fields did not retain their values after 5 passes.");
    }
  }

  function scheduleAutomaticSellSync(reason = "table", delay = 450, force = false) {
    const request = { reason, delay, force };
    if (automaticSyncState.running) {
      automaticSyncState.pending = mergeSyncRequest(automaticSyncState.pending, request);
      return;
    }

    automaticSyncState.queued = mergeSyncRequest(automaticSyncState.queued, request);
    const due = Date.now() + delay;
    // Throttle instead of trailing-edge debounce: continuous React mutations
    // must not keep postponing the first write. Preserve forced retry flags.
    if (automaticSyncState.timer !== null && due >= automaticSyncState.timerDue) return;
    clearTimeout(automaticSyncState.timer);
    automaticSyncState.timerDue = due;
    automaticSyncState.timer = setTimeout(runAutomaticSellSync, delay);
  }

  async function runAutomaticSellSync() {
    const request = automaticSyncState.queued;
    automaticSyncState.timer = null;
    automaticSyncState.queued = null;
    const table = findPriceTable();
    if (!request || !table || !tableHasBuyValues(table)) return;

    const keyBefore = automaticSyncKey(table);
    if (!request.force && keyBefore === automaticSyncState.blockedKey) return;
    if (!request.force && keyBefore === automaticSyncState.lastKey && !tableNeedsSellSync(table)) return;
    if (!request.force) automaticSyncState.retryCount = 0;

    automaticSyncState.running = true;
    try {
      await waitForTablePaint(220);
      const result = await syncSellPrices();
      const incomplete = !result.ok || result.failed > 0 || result.updated < result.eligible || tableNeedsSellSync();
      if (incomplete) {
        queueFailedSyncRetry();
      } else {
        automaticSyncState.lastKey = automaticSyncKey();
        automaticSyncState.blockedKey = "";
        automaticSyncState.retryCount = 0;
        console.info(`FUT.GG sell sync: verified ${result.updated}/${result.eligible} eligible rows across ${result.pages} page(s).`);
      }
    } catch (error) {
      console.warn("FUT.GG sell sync: automatic synchronization failed.", error);
      queueFailedSyncRetry();
    } finally {
      automaticSyncState.running = false;
      const pending = automaticSyncState.pending;
      automaticSyncState.pending = null;
      if (pending) scheduleAutomaticSellSync(pending.reason, pending.delay, pending.force);
    }
  }

  function handleAutomaticSyncInput(event) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) return;
    const table = findPriceTable();
    if (buyFieldInTable(field, table)) scheduleAutomaticSellSync("buy-input", 650);
  }

  function watchAutomaticSellSync() {
    document.addEventListener("input", handleAutomaticSyncInput, true);
    document.addEventListener("change", handleAutomaticSyncInput, true);

    const poll = () => {
      // The active pass already re-queries rows; don't flood its pending queue
      // with the mutations generated by our own input writes and scrolling.
      if (automaticSyncState.running) return;
      const table = findPriceTable();
      if (!table) {
        automaticSyncState.observedTable = null;
        automaticSyncState.lastKey = "";
        automaticSyncState.blockedKey = "";
        automaticSyncState.retryCount = 0;
        return;
      }
      const tableChanged = table !== automaticSyncState.observedTable;
      automaticSyncState.observedTable = table;
      const key = automaticSyncKey(table);
      if (tableHasBuyValues(table) && key !== automaticSyncState.blockedKey
          && (tableChanged || key !== automaticSyncState.lastKey || tableNeedsSellSync(table))) {
        scheduleAutomaticSellSync(tableChanged ? "table" : "poll", 350);
      }
    };

    const observer = new MutationObserver(() => {
      if (automaticSyncState.running || automaticSyncState.mutationTimer !== null) return;
      // Coalesce DOM reads as well as writes; do not rescan the document for
      // every animation, clock, spinner, or React commit.
      automaticSyncState.mutationTimer = setTimeout(() => {
        automaticSyncState.mutationTimer = null;
        poll();
      }, 150);
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, characterData: true
    });
    automaticSyncState.observer = observer;
    poll();
    // Programmatic input.value hydration does not always emit a DOM mutation.
    automaticSyncState.pollTimer = setInterval(poll, 800);
  }

  async function applyGalleryTeamIds(ids) {
    const result = await applyIds(ids, true);
    const field = findGalleryField();
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    return result;
  }

  watchGallery();
  watchAutomaticSellSync();

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
