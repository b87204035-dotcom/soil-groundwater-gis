(() => {
  const byId = id => document.getElementById(id);
  const toggle = byId('sitesLayer');
  if (!toggle || typeof map === 'undefined' || typeof sites === 'undefined') return;

  const label = toggle.closest('label');
  if (label) {
    const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = ' 污染場址位置／資訊';
  }

  const state = document.createElement('div');
  state.id = 'contaminatedSiteDisplayState';
  state.className = 'small';
  state.style.marginTop = '5px';
  label?.insertAdjacentElement('afterend', state);

  const css = document.createElement('style');
  css.textContent = `
    .contaminated-site-result-hidden{display:none!important}
    #contaminatedSiteDisplayState.on{color:#176b68;font-weight:700}
    #contaminatedSiteDisplayState.off{color:#8a4a42;font-weight:700}
  `;
  document.head.appendChild(css);

  function resultElements() {
    return [
      byId('nearestSite'),
      byId('officialSiteList'),
      byId('siteFilterSummary')
    ].filter(Boolean);
  }

  function applyDisplay(enabled, recalculate = true) {
    localStorage.setItem('show_contaminated_sites', enabled ? '1' : '0');

    if (enabled) {
      if (!map.hasLayer(sites)) sites.addTo(map);
      resultElements().forEach(el => el.classList.remove('contaminated-site-result-hidden'));
      state.className = 'small on';
      state.textContent = '已顯示污染場址點位與鄰近場址資訊';
      if (recalculate) {
        const radius = byId('siteRadius');
        if (radius) radius.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      if (map.hasLayer(sites)) map.removeLayer(sites);
      map.closePopup();
      resultElements().forEach(el => el.classList.add('contaminated-site-result-hidden'));
      state.className = 'small off';
      state.textContent = '已隱藏污染場址點位與資訊；已載入資料不會被刪除';
    }
  }

  toggle.onchange = event => applyDisplay(event.target.checked);

  const saved = localStorage.getItem('show_contaminated_sites');
  if (saved !== null) toggle.checked = saved === '1';
  applyDisplay(toggle.checked, false);

  const observer = new MutationObserver(() => {
    if (!toggle.checked) resultElements().forEach(el => el.classList.add('contaminated-site-result-hidden'));
  });
  const leftPanel = toggle.closest('.panel');
  const rightPanel = byId('nearestSite')?.closest('.panel');
  if (leftPanel) observer.observe(leftPanel, { childList: true, subtree: true });
  if (rightPanel) observer.observe(rightPanel, { childList: true, subtree: true });
})();