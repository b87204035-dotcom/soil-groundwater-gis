(() => {
  const byId = id => document.getElementById(id);
  if (typeof map === 'undefined' || typeof L === 'undefined') return;

  const css = document.createElement('style');
  css.textContent = `
    .auto-sync-note{margin-top:7px;padding:9px 10px;border-radius:10px;background:#e7f6ef;color:#28564a;font-size:11px;line-height:1.5}
    .auto-sync-note.error{background:#ffe7e2;color:#7f3028}
    .auto-well-list{display:grid;gap:7px;margin-top:8px;max-height:320px;overflow:auto}
    .auto-well-card{border:1px solid #cad9e2;border-radius:10px;padding:9px;background:#f8fbfd;font-size:12px;line-height:1.48;cursor:pointer}
    .auto-well-card:hover{background:#edf6fb}.auto-well-card strong{font-size:13px}.auto-well-distance{font-weight:800;color:#1f669c}
    @media(max-width:520px){.auto-well-list{max-height:none}}
  `;
  document.head.appendChild(css);

  try { localStorage.removeItem('moenv_api_key'); } catch (_) {}

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const distanceKm = (lat1, lng1, lat2, lng2) => {
    const radius = 6371;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const value = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  };
  const currentCenter = () => {
    if (typeof centerMarker !== 'undefined' && centerMarker) {
      const point = centerMarker.getLatLng();
      return { lat: point.lat, lng: point.lng };
    }
    const point = map.getCenter();
    return { lat: point.lat, lng: point.lng };
  };
  const formatTaiwanTime = iso => {
    if (!iso) return '時間未提供';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  };
  async function fetchPublishedJson(filename) {
    const response = await fetch(`data/${filename}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 404) throw new Error('尚未完成第一次 GitHub Actions 同步');
      throw new Error(`資料檔回應 ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.records)) throw new Error('資料檔格式錯誤');
    return payload;
  }

  const keyInput = byId('moenvApiKey');
  if (keyInput) keyInput.remove();
  [...document.querySelectorAll('.site-tools .api-note')].forEach(note => {
    note.textContent = '環境部 API Key 已改存於 GitHub Repository Secret。官方資料由 GitHub Actions 每日同步，所有裝置直接讀取同一份公開資料檔。';
  });
  [...document.querySelectorAll('.well-links a')].forEach(link => {
    if (/API Key|註冊/.test(link.textContent || '')) link.remove();
  });

  let siteRecords = [];
  const siteButton = byId('syncOfficialSitesBtn');
  const siteStatus = byId('syncStatus');
  const siteToggle = byId('sitesLayer');

  function selectedValues(selector) {
    const nodes = [...document.querySelectorAll(`${selector} input:checked`)];
    return new Set(nodes.map(node => node.value));
  }
  function sitePopup(site) {
    return `<b>${escapeHtml(site.name)}</b><br><b>列管：</b>${escapeHtml(site.control || site.siteType || '未載明')}<br><b>介質：</b>${escapeHtml(site.siteType || '未載明')}<br><b>地址：</b>${escapeHtml(site.address || '未載明')}<br><b>地號：</b>${escapeHtml(site.landNo || '未載明')}<hr style="border:0;border-top:1px solid #ddd"><b>污染物：</b>${escapeHtml(site.pollutant || '未載明')}<br><b>公告：</b>${escapeHtml(site.annoDate || '')} ${escapeHtml(site.annoNo || '')}${site.released ? `<br><b>解除：</b>${escapeHtml(site.deannoDate || '')} ${escapeHtml(site.deannoNo || '')}` : ''}`;
  }
  function filteredSites() {
    let result = siteRecords;
    const statusNodes = document.querySelectorAll('#siteStatusFilters input');
    const mediaNodes = document.querySelectorAll('#siteMediaFilters input');
    if (statusNodes.length) {
      const statuses = selectedValues('#siteStatusFilters');
      result = result.filter(site => statuses.has(site.statusGroup));
    }
    if (mediaNodes.length) {
      const media = selectedValues('#siteMediaFilters');
      result = result.filter(site => media.has(site.mediaGroup));
    }
    return result;
  }
  function renderSites() {
    const enabled = siteToggle?.checked !== false;
    const filtered = filteredSites();
    sites.clearLayers();
    if (enabled) {
      filtered.forEach(site => {
        const color = site.released ? '#66757a'
          : site.statusGroup === 'active-remediation' ? '#a32620'
          : site.statusGroup === 'active-control' ? '#e36d2f' : '#8f5e2e';
        L.circleMarker([site.lat, site.lng], {
          radius: 6, color, weight: 2, fillColor: color, fillOpacity: 0.78
        }).bindPopup(sitePopup(site), { maxWidth: 330 }).addTo(sites);
      });
    }

    const radius = Number(byId('siteRadius')?.value || 1);
    const center = currentCenter();
    const nearby = enabled ? filtered
      .map(site => ({ ...site, distance: distanceKm(center.lat, center.lng, site.lat, site.lng) }))
      .filter(site => site.distance <= radius)
      .sort((a, b) => a.distance - b.distance) : [];

    const list = byId('officialSiteList');
    if (list) {
      list.innerHTML = '';
      if (!enabled) {
        list.innerHTML = '<div class="small">已取消勾選污染場址位置／資訊。</div>';
      } else {
        nearby.slice(0, 40).forEach(site => {
          const card = document.createElement('div');
          card.className = 'site-card';
          card.innerHTML = `<strong>${escapeHtml(site.name)}</strong><br><span class="distance">距離 ${site.distance.toFixed(2)} 公里</span>｜${escapeHtml(site.control || site.siteType)}<br>${escapeHtml(site.address || '')}<br>${site.released ? '已解除列管' : '現行列管'}・${escapeHtml(site.siteType || '介質未載明')}`;
          card.onclick = () => map.setView([site.lat, site.lng], 18);
          list.appendChild(card);
        });
        if (!nearby.length) list.innerHTML = `<div class="small">${radius} 公里內未查得符合條件的污染場址。</div>`;
      }
    }

    const summary = byId('siteFilterSummary');
    if (summary) summary.textContent = enabled
      ? `每日同步 ${siteRecords.length} 筆；目前篩選顯示 ${filtered.length} 筆，半徑內 ${nearby.length} 筆。`
      : '污染場址位置／資訊目前關閉。';
    const nearest = byId('nearestSite');
    if (nearest) nearest.textContent = !enabled
      ? '污染場址位置／資訊目前關閉'
      : nearby.length
        ? `${radius} 公里內有 ${nearby.length} 處；最近 ${nearby[0].distance.toFixed(2)} 公里：${nearby[0].name}`
        : `${radius} 公里內未查得符合篩選條件的場址`;
  }
  async function loadPublishedSites() {
    if (!siteStatus) return;
    if (siteButton) { siteButton.disabled = true; siteButton.textContent = '載入中…'; }
    siteStatus.className = 'status';
    siteStatus.textContent = '正在載入 GitHub Actions 每日同步的環境部污染場址資料…';
    try {
      const payload = await fetchPublishedJson('moenv-sites.json');
      siteRecords = payload.records.filter(site => Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lng)));
      siteStatus.className = 'status success';
      siteStatus.textContent = `已載入環境部官方污染場址 ${siteRecords.length} 筆・同步時間 ${formatTaiwanTime(payload.updatedAt)}`;
      renderSites();
      const source = byId('sourceStatus');
      if (source) source.innerHTML = source.innerHTML.replace(/<b>污染場址：<\/b>[^<]*/, `<b>污染場址：</b>環境部 EMS_S_07，每日自動同步 ${siteRecords.length} 筆`);
    } catch (error) {
      siteStatus.className = 'status error';
      siteStatus.textContent = `每日同步資料尚不可用：${error.message}。請確認 GitHub Secret「MOENV_API_KEY」並手動執行同步工作流程一次。`;
    } finally {
      if (siteButton) { siteButton.disabled = false; siteButton.textContent = '重新載入每日資料'; }
    }
  }
  if (siteButton) siteButton.onclick = loadPublishedSites;
  document.querySelectorAll('#siteStatusFilters input,#siteMediaFilters input').forEach(node => node.addEventListener('change', renderSites));
  byId('siteRadius')?.addEventListener('change', renderSites);
  siteToggle?.addEventListener('change', renderSites);

  const regionalLayer = L.layerGroup().addTo(map);
  const siteWellLayer = L.layerGroup().addTo(map);
  let regionalWells = [];
  let siteWells = [];
  const moenvWellButton = byId('loadMoenvWellsBtn');
  const wellStatus = byId('wellStatus');
  const regionalToggle = byId('moenvWellLayerCheck');
  const siteWellToggle = byId('moenvSiteWellLayerCheck');

  const wellList = document.createElement('div');
  wellList.id = 'autoMoenvWellList';
  wellList.className = 'auto-well-list';
  const existingWellList = byId('wellList');
  if (existingWellList) {
    const title = document.createElement('div');
    title.className = 'well-note';
    title.style.marginTop = '10px';
    title.innerHTML = '<b>環境部監測井（每日同步）</b>';
    existingWellList.insertAdjacentElement('afterend', title);
    title.insertAdjacentElement('afterend', wellList);
  }

  function wellPopup(well) {
    const status = well.active ? '使用中／現存' : '停用／廢站';
    return `<b>${escapeHtml(well.name)}</b><br><span class="well-source">${escapeHtml(well.source)}</span><br><b>代碼：</b>${escapeHtml(well.id || '未載明')}<br><b>狀態：</b>${escapeHtml(well.status || status)}${well.siteName ? `<br><b>場址：</b>${escapeHtml(well.siteName)}` : ''}${well.address ? `<br><b>位置：</b>${escapeHtml(well.address)}` : ''}${well.groundwaterZone ? `<br><b>地下水分區：</b>${escapeHtml(well.groundwaterZone)}` : ''}${well.depth ? `<br><b>井深：</b>${escapeHtml(well.depth)} m` : ''}<hr style="border:0;border-top:1px solid #ddd"><b>WGS84：</b>${Number(well.lat).toFixed(6)}, ${Number(well.lng).toFixed(6)}`;
  }
  function drawWellRecords(records, layer, type) {
    layer.clearLayers();
    const activeOnly = byId('activeWellsOnly')?.checked !== false;
    const enabled = type === 'regional' ? regionalToggle?.checked !== false : siteWellToggle?.checked !== false;
    if (!enabled) return;
    records.filter(record => !activeOnly || record.active).forEach(record => {
      const options = type === 'regional'
        ? { radius: 5, color: '#5e358b', fillColor: '#7d4bb3', fillOpacity: 0.82, weight: 1.5 }
        : { radius: 5, color: '#a55414', fillColor: '#db7b22', fillOpacity: 0.84, weight: 1.5 };
      L.circleMarker([record.lat, record.lng], options).bindPopup(wellPopup(record), { maxWidth: 330 }).addTo(layer);
    });
  }
  function renderMoenvWells() {
    drawWellRecords(regionalWells, regionalLayer, 'regional');
    drawWellRecords(siteWells, siteWellLayer, 'site');
    const activeOnly = byId('activeWellsOnly')?.checked !== false;
    const center = currentCenter();
    const radius = Number(byId('wellRadius')?.value || 2);
    const visible = [
      ...(regionalToggle?.checked !== false ? regionalWells : []),
      ...(siteWellToggle?.checked !== false ? siteWells : [])
    ].filter(well => !activeOnly || well.active)
      .map(well => ({ ...well, distance: distanceKm(center.lat, center.lng, well.lat, well.lng) }))
      .filter(well => well.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    wellList.innerHTML = '';
    visible.slice(0, 50).forEach(well => {
      const card = document.createElement('div');
      card.className = 'auto-well-card';
      card.innerHTML = `<strong>${escapeHtml(well.name)}</strong><span class="well-source">${escapeHtml(well.source)}</span><br><span class="auto-well-distance">距離 ${well.distance.toFixed(2)} 公里</span>${well.id ? `｜${escapeHtml(well.id)}` : ''}<br>${escapeHtml(well.address || well.siteName || '')}${well.depth ? `<br>井深：${escapeHtml(well.depth)} m` : ''}`;
      card.onclick = () => map.setView([well.lat, well.lng], 18);
      wellList.appendChild(card);
    });
    if (!visible.length) wellList.innerHTML = `<div class="small">${radius} 公里內未查得符合條件的環境部監測井。</div>`;
    const summary = byId('wellSummary');
    if (summary) summary.textContent = `環境部每日同步：區域性井 ${regionalWells.length} 筆、場置性井 ${siteWells.length} 筆；半徑內 ${visible.length} 筆。水利署井維持公開 API 直接載入。`;
  }
  async function loadPublishedWells() {
    if (moenvWellButton) { moenvWellButton.disabled = true; moenvWellButton.textContent = '載入中…'; }
    if (wellStatus) { wellStatus.className = 'status'; wellStatus.textContent = '正在載入 GitHub Actions 每日同步的環境部監測井資料…'; }
    try {
      const [regionalPayload, sitePayload] = await Promise.all([
        fetchPublishedJson('moenv-regional-wells.json'),
        fetchPublishedJson('moenv-site-wells.json')
      ]);
      regionalWells = regionalPayload.records;
      siteWells = sitePayload.records;
      if (wellStatus) {
        wellStatus.className = 'status success';
        wellStatus.textContent = `已載入環境部監測井 ${regionalWells.length + siteWells.length} 筆・同步時間 ${formatTaiwanTime(regionalPayload.updatedAt || sitePayload.updatedAt)}`;
      }
      renderMoenvWells();
    } catch (error) {
      if (wellStatus) {
        wellStatus.className = 'status error';
        wellStatus.textContent = `環境部監測井每日同步資料尚不可用：${error.message}。請確認 GitHub Secret「MOENV_API_KEY」並手動執行同步工作流程一次。`;
      }
    } finally {
      if (moenvWellButton) { moenvWellButton.disabled = false; moenvWellButton.textContent = '重新載入環境部監測井'; }
    }
  }
  if (moenvWellButton) moenvWellButton.onclick = loadPublishedWells;
  regionalToggle?.addEventListener('change', renderMoenvWells);
  siteWellToggle?.addEventListener('change', renderMoenvWells);
  byId('activeWellsOnly')?.addEventListener('change', renderMoenvWells);
  byId('wellRadius')?.addEventListener('change', renderMoenvWells);
  map.on('moveend', () => {
    if (siteRecords.length) renderSites();
    if (regionalWells.length || siteWells.length) renderMoenvWells();
  });

  const sourceStatus = byId('sourceStatus');
  if (sourceStatus) {
    sourceStatus.innerHTML = sourceStatus.innerHTML
      .replace('<b>污染場址：</b>尚未同步官方資料', '<b>污染場址：</b>GitHub Actions 每日同步環境部 EMS_S_07')
      .replace('<b>監測井：</b>水利署公開資料＋環境部 WQX_P_07／GISEPA_P_33', '<b>監測井：</b>水利署公開 API＋GitHub Actions 每日同步環境部 WQX_P_07／GISEPA_P_33');
  }

  loadPublishedSites();
  loadPublishedWells();
})();
