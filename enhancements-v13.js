(() => {
  const byId = id => document.getElementById(id);

  function hideReloadButtons() {
    ['loadWraWellsBtn', 'loadMoenvWellsBtn'].forEach(id => {
      const button = byId(id);
      if (!button) return;
      button.style.display = 'none';
      button.setAttribute('aria-hidden', 'true');
    });
    const grid = document.querySelector('.well-source-grid');
    if (grid) grid.style.display = 'none';
  }

  function keepLayersOffByDefault() {
    ['wraWellLayerCheck', 'moenvWellLayerCheck', 'moenvSiteWellLayerCheck'].forEach(id => {
      const checkbox = byId(id);
      if (!checkbox || checkbox.dataset.defaultOffApplied) return;
      checkbox.dataset.defaultOffApplied = '1';
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function autoLoadData() {
    const wraButton = byId('loadWraWellsBtn');
    if (wraButton && !wraButton.dataset.autoLoaded) {
      wraButton.dataset.autoLoaded = '1';
      wraButton.click();
    }

    // MOENV data are loaded by the GitHub monthly-sync client (enhancements-v11).
    // Do not call the legacy API-key button; only remove it from the UI.
    const status = byId('wellStatus');
    if (status) {
      status.textContent = '監測井資料於開啟網站時自動載入；勾選資料來源後才在地圖顯示。';
    }
    const summary = byId('wellSummary');
    if (summary && /尚未載入|預設不顯示/.test(summary.textContent || '')) {
      summary.textContent = '資料背景載入中；圖層預設隱藏，勾選後顯示。';
    }
  }

  function apply() {
    autoLoadData();
    hideReloadButtons();
    keepLayersOffByDefault();
  }

  apply();
  [250, 800, 1800, 3500].forEach(ms => setTimeout(apply, ms));
})();
