(() => {
  const byId = id => document.getElementById(id);

  function setLabelText(input, text) {
    const label = input?.closest('label');
    if (!label) return;
    [...label.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    });
    label.append(document.createTextNode(text));
  }

  function configureSiteFilters() {
    const statusBox = byId('siteStatusFilters');
    const mediaBox = byId('siteMediaFilters');
    if (!statusBox || !mediaBox) return false;

    const labels = {
      'active-control': '控制場址',
      'active-remediation': '整治場址',
      'other-active': '限期改善／其他列管',
      'released': '解除列管／解除公告'
    };
    statusBox.querySelectorAll('input').forEach(input => {
      setLabelText(input, labels[input.value] || input.value);
      input.checked = false;
    });

    const soil = mediaBox.querySelector('input[value="soil"]');
    const groundwater = mediaBox.querySelector('input[value="groundwater"]');
    const both = mediaBox.querySelector('input[value="both"]');
    const unknown = mediaBox.querySelector('input[value="unknown"]');
    setLabelText(soil, '土壤');
    setLabelText(groundwater, '地下水');
    soil.checked = false;
    groundwater.checked = false;
    if (both) {
      both.checked = false;
      both.closest('label').style.display = 'none';
    }
    if (unknown) {
      unknown.checked = false;
      unknown.closest('label').style.display = 'none';
    }

    const syncBoth = () => {
      if (both) both.checked = Boolean(soil?.checked || groundwater?.checked);
      both?.dispatchEvent(new Event('change', { bubbles: true }));
    };
    soil?.addEventListener('change', syncBoth);
    groundwater?.addEventListener('change', syncBoth);

    const summary = byId('siteFilterSummary');
    if (summary) summary.textContent = '請先勾選場址狀態與污染介質，再顯示符合條件的污染場址。';
    return true;
  }

  function hideSitesByDefault() {
    const toggle = byId('sitesLayer');
    if (!toggle) return false;
    toggle.checked = false;
    localStorage.setItem('soil_gis_sites_visible', '0');
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function hideWellsByDefault() {
    const ids = ['wraWellLayerCheck', 'moenvWellLayerCheck', 'moenvSiteWellLayerCheck'];
    let found = false;
    ids.forEach(id => {
      const checkbox = byId(id);
      if (!checkbox) return;
      found = true;
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const summary = byId('wellSummary');
    if (summary) summary.textContent = '監測井圖層預設不顯示；勾選資料來源後才呈現井位與資訊。';
    return found;
  }

  function applyDefaults() {
    configureSiteFilters();
    hideSitesByDefault();
    hideWellsByDefault();
  }

  applyDefaults();
  [250, 800, 1800].forEach(delay => setTimeout(applyDefaults, delay));
})();
