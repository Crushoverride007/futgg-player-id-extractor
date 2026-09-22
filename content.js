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

  function setReactValue(field, value) {
    if (field.isContentEditable) {
      field.focus();
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    } else {
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
      field.focus();
    }

    for (const type of ["input", "change", "keyup"]) {
      field.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
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
    if (!field || !visible(field) || field.disabled || field.readOnly) return false;
    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) return false;
    return !["hidden", "checkbox", "radio", "button", "submit", "range"].includes(field.type);
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

    const fields = [...table.querySelectorAll("input, textarea")]
      .filter(priceInput)
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
      .map((fields) => fields.slice(0, 2));
  }

  function waitForTablePaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)));
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

    // Prefer the smallest scrollable element that contains the price inputs.
    return containers.sort((a, b) => (a.scrollHeight - a.clientHeight) - (b.scrollHeight - b.clientHeight));
  }

  function rowSignature(fields) {
    const buyField = fields[0];
    const row = buyField.closest("tr, [role='row'], li") || buyField.parentElement?.parentElement;
    const image = row?.querySelector("img");
    const imageKey = image?.currentSrc || image?.src || image?.alt || "";
    const label = row?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) || "";
    return `${imageKey}|${label}|${String(buyField.value || "").trim()}`;
  }

  async function syncSellPrices() {
    const table = findPriceTable();
    if (!table) {
      return { ok: false, reason: "No FUT Enhancer price rows were found. Open the gallery price table first." };
    }

    const containers = scrollContainers(table);
    const originalPositions = containers.map((container) => ({ container, top: container.scrollTop }));
    const processed = new Set();
    let updated = 0;
    let visibleRows = 0;

    const processVisibleRows = () => {
      for (const fields of fieldRows(table)) {
        visibleRows += 1;
        const buyField = fields[0];
        const sellField = fields[1];
        const value = String(buyField.value || "").trim();
        if (!/^\d+$/.test(value) || Number(value) <= 0) continue;

        const signature = rowSignature(fields);
        if (processed.has(signature)) continue;
        processed.add(signature);
        setReactValue(sellField, value);
        updated += 1;
      }
    };

    // Scan the initial viewport, then every viewport below it. This also handles
    // virtualized tables where only the currently visible rows exist in the DOM.
    for (const container of containers.slice(0, 1)) {
      container.scrollTop = 0;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      await waitForTablePaint();

      let previousTop = -1;
      while (container.scrollTop !== previousTop) {
        previousTop = container.scrollTop;
        processVisibleRows();
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) break;
        container.scrollTop = Math.min(
          container.scrollTop + Math.max(80, Math.floor(container.clientHeight * 0.8)),
          container.scrollHeight - container.clientHeight
        );
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
        await waitForTablePaint();
      }
    }

    // If the table has no scrollable child, process its currently rendered rows.
    if (!containers.length) processVisibleRows();

    for (const { container, top } of originalPositions) {
      container.scrollTop = top;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    if (!visibleRows) {
      return { ok: false, reason: "No FUT Enhancer price rows were found. Open the gallery price table first." };
    }
    return { ok: true, updated };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
