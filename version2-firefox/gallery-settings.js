(() => {
  "use strict";
  const key = "galleryAutoSelectFirst15";
  const toggle = document.getElementById("gallery-auto-select");
  const status = document.getElementById("gallery-auto-select-status");
  toggle.disabled = true;
  chrome.storage.local.get({ [key]: true }, (settings) => {
    if (chrome.runtime.lastError) {
      status.textContent = "Could not load the auto-select setting. Reload the extension.";
      return;
    }
    toggle.checked = settings[key] !== false;
    toggle.disabled = false;
  });
  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    chrome.storage.local.set({ [key]: enabled }, () => {
      if (chrome.runtime.lastError) {
        toggle.checked = !enabled;
        status.textContent = "Could not save the auto-select setting. Try again.";
      } else {
        status.textContent = enabled ? "Enabled for Gallery player lists." : "Automatic selection is off.";
      }
      toggle.disabled = false;
    });
  });
})();
