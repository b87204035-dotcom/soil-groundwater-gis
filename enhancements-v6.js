(() => {
  const byId = id => document.getElementById(id);
  const leftPanel = document.querySelector('main > aside.panel');
  if (!leftPanel || typeof map === 'undefined' || typeof L === 'undefined') return;

  const css = document.createElement('style');
  css.textContent = `
    .well-tools{display:grid;gap:8px;margin-top:8px}
    .well-source-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
    .well-source-grid button{margin:0}
    .well-layer-list{display:grid;gap:5px;padding:8px 10px;background:#f3f7f7;border-radius:10px}
    .well-layer-list label{margin:0;font-size:12px}
    .well-dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:-1px;border:2px solid #fff;box-shadow:0 0 0 1px #789}
    .well-dot.wra{background:#2878c8}.well-dot.moenv{background:#7d4bb3}.well-dot.sitewell{background:#db7b22}
    .well-list{display:grid;gap:7px;max-height:360px;overflow:auto;margin-top:8px}
    .well-card{border:1px solid #cad9e2;border-radius:10px;padding:9px;background:#f8fbfd;font-size:12px;line-height:1.48;cursor:pointer}
    .well-card:hover{background:#edf6fb}.well-card strong{font-size:13px}.well-distance{font-weight:800;color:#1f669c}
    .well-source{display:inline-block;padding:2px 6px;border-radius:999px;background:#e5eef5;font-size:10px;margin-left:4px}
    .well-links{display:flex;gap:10px;flex-wrap:wrap}.well-links a{font-size:11px;color:#176b68;font-weight:700}
    .well-note{font-size:11px;color:#68777c;line-height:1.45}
    @media(max-width:520px){.well-source-grid{grid-template-columns:1fr}.well-list{max-height:none}}
  `;
  document.head.appendChild(css);

  const section = document.createElement('section');
  section.innerHTML = `
    <h2>地下水監測井</h2>
    <div class="well-layer-list">
      <label><input id="wraWellLayerCheck" type="checkbox" checked><span class="well-dot wra"></span>經濟部水利署水位觀測井</label>
      <label><input id="moenvWellLayerCheck" type="checkbox" checked><span class="well-dot moenv"></span>環境部區域性水質監測井</label>
      <label><input id="moenvSiteWellLayerCheck" type="checkbox" checked><span class="well-dot sitewell"></span>環境部場置性監測井</label>
    </div>
    <div class="well-tools">
      <div class="well-source-grid">
        <button id="loadWraWellsBtn" type="button">載入水利署監測井</button>
        <button id="loadMoenvWellsBtn" type="button">載入環境部監測井</button>
      </div>
      <div class="grid2">
        <select id="wellRadius"><option value="0.5">0.5 公里</option><option value="1">1 公里</option><option value="2" selected>2 公里</option><option value="5">5 公里</option><option value="10">10 公里</option><option value="20">20 公里</option></select>
        <label style="display:flex;align-items:center;padding:0 8px"><input id="activeWellsOnly" type="checkbox" checked>只顯示使用中／現存井</label>
      </div>
      <div id="wellStatus" class="status">水利署監測井可直接載入；環境部監測井使用上方相同的環境部 API Key。</div>
      <div class="well-links">
        <a target="_blank" rel="noopener" href="https://data.gov.tw/dataset/32718">水利署資料來源</a>
        <a target="_blank" rel="noopener" href="https://data.moenv.gov.tw/dataset/detail/WQX_P_07">環境部區域井資料</a>
        <a target="_blank" rel="noopener" href="https://data.moenv.gov.tw/dataset/detail/GISEPA_P_33">環境部場置井資料</a>
        <a target="_blank" rel="noopener" href="https://data.moenv.gov.tw/api-term">註冊／取得 API Key</a>
      </div>
      <div id="wellSummary" class="well-note">尚未載入監測井。</div>
      <div id="wellList" class="well-list"></div>
    </div>`;
  leftPanel.appendChild(section);

  const canvasRenderer = L.canvas({ padding: 0.5 });
  const wraLayer = L.layerGroup().addTo(map);
  const moenvLayer = L.layerGroup().addTo(map);
  const moenvSiteLayer = L.layerGroup().addTo(map);
  let wraRecords = [];
  let moenvRecords = [];
  let moenvSiteRecords = [];

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const lowerKeys = object => Object.fromEntries(Object.entries(object || {}).map(([key, value]) => [key.toLowerCase(), value]));
  function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ['records', 'data', 'result', 'items']) {
      const value = payload?.[key];
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.records)) return value.records;
    }
    return [];
  }

  function tm2ToWgs84(easting, northing, zone = 121) {
    const a = 6378137;
    const f = 1 / 298.257222101;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const k0 = 0.9999;
    const x = Number(easting) - 250000;
    const y = Number(northing);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const M = y / k0;
    const e4 = e2 * e2;
    const e6 = e4 * e2;
    const mu = M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const j1 = 3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32;
    const j2 = 21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32;
    const j3 = 151 * Math.pow(e1, 3) / 96;
    const j4 = 1097 * Math.pow(e1, 4) / 512;
    const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);
    const sinFp = Math.sin(fp), cosFp = Math.cos(fp), tanFp = Math.tan(fp);
    const C1 = ep2 * cosFp * cosFp;
    const T1 = tanFp * tanFp;
    const N1 = a / Math.sqrt(1 - e2 * sinFp * sinFp);
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinFp * sinFp, 1.5);
    const D = x / (N1 * k0);
    const lat = fp - (N1 * tanFp / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
    const lon0 = zone * Math.PI / 180;
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / cosFp;
    return { lat: lat * 180 / Math.PI, lng: lon * 180 / Math.PI };
  }

  function coordinateFromValues(x, y, county = '') {
    x = Number(x); y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x >= 117 && x <= 123 && y >= 20 && y <= 27) return { lng: x, lat: y };
    if (y >= 117 && y <= 123 && x >= 20 && x <= 27) return { lng: y, lat: x };
    const zone = /金門|連江|馬祖/.test(county) ? 119 : 121;
    return tm2ToWgs84(x, y, zone);
  }

  function validTaiwan(point) {
    return point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat > 20 && point.lat < 27 && point.lng > 117 && point.lng < 123;
  }

  function parseTm2(value) {
    const numbers = String(value || '').trim().split(/[ ,，]+/).map(Number).filter(Number.isFinite);
    return numbers.length >= 2 ? { x: numbers[0], y: numbers[1] } : null;
  }

  function normalizeWraWell(raw) {
    const r = lowerKeys(raw);
    const tm2 = parseTm2(r.locationbytwd97);
    const point = tm2 ? coordinateFromValues(tm2.x, tm2.y, r.countyname || r.locationaddress) : null;
    const active = !r.disusedate || String(r.disusedate) === '99999999';
    return {
      source: '經濟部水利署', sourceCode: 'WRA', id: r.wellidentifier || '', name: r.wellname || '地下水觀測井',
      county: r.countyname || '', township: r.townname || '', address: r.locationaddress || '',
      groundwaterZone: r.groundwaterzone || '', layer: r.groundwaterlayercode || '', layerAttribute: r.layerattribute || '',
      depth: r.welldepth || r.finishdepth || '', elevation: r.wellelevation || '', waterLevel: r.waterlevel || '',
      establishDate: r.establishdate || '', disuseDate: active ? '' : r.disusedate, active,
      lat: point?.lat, lng: point?.lng
    };
  }

  function normalizeMoenvRegional(raw) {
    const r = lowerKeys(raw);
    let point = coordinateFromValues(r.twd97lon, r.twd97lat, r.county);
    if (!validTaiwan(point)) point = coordinateFromValues(r.twd97tm2x, r.twd97tm2y, r.county);
    const status = String(r.statusofuse || '');
    const active = !status || !/停用|廢|撤|不使用/.test(status);
    return {
      source: '環境部區域性水質井', sourceCode: 'MOENV-WQ', id: r.siteid || '', name: r.sitename || '區域性地下水水質監測井',
      county: r.county || '', township: r.township || '', address: r.siteaddress || '', groundwaterZone: r.ugwdistname || '',
      status, active, lat: point?.lat, lng: point?.lng
    };
  }

  function normalizeMoenvSite(raw) {
    const r = lowerKeys(raw);
    const point = coordinateFromValues(r.gis_x, r.gis_y, r.county || r.site_addr);
    const statusText = `${r.attribute || ''}`;
    const active = !/廢|停用|撤/.test(statusText);
    return {
      source: '環境部場置性監測井', sourceCode: 'MOENV-SITE', id: r.wno || '', name: r.wname || '場置性地下水監測井',
      siteName: r.site_name || '', county: r.county || '', address: r.site_addr || '', attribute: r.attribute || '', url: r.url || '',
      status: statusText, active, lat: point?.lat, lng: point?.lng
    };
  }

  function wellPopup(record) {
    const status = record.active ? '使用中／現存' : `停用／廢站${record.disuseDate ? `（${record.disuseDate}）` : ''}`;
    return `<b>${escapeHtml(record.name)}</b><br><span class="well-source">${escapeHtml(record.source)}</span><br><b>代碼：</b>${escapeHtml(record.id || '未載明')}<br><b>狀態：</b>${escapeHtml(record.status || status)}${record.siteName ? `<br><b>場址：</b>${escapeHtml(record.siteName)}` : ''}${record.address ? `<br><b>位置：</b>${escapeHtml(record.address)}` : ''}${record.groundwaterZone ? `<br><b>地下水分區：</b>${escapeHtml(record.groundwaterZone)}` : ''}${record.depth ? `<br><b>井深：</b>${escapeHtml(record.depth)} m` : ''}${record.layer ? `<br><b>含水層：</b>${escapeHtml(record.layer)} ${escapeHtml(record.layerAttribute || '')}` : ''}<hr style="border:0;border-top:1px solid #ddd"><b>WGS84：</b>${Number(record.lat).toFixed(6)}, ${Number(record.lng).toFixed(6)}`;
  }

  function markerOptions(sourceCode) {
    if (sourceCode === 'WRA') return { radius: 5, color: '#195d9c', fillColor: '#2878c8', fillOpacity: 0.82, weight: 1.5, renderer: canvasRenderer };
    if (sourceCode === 'MOENV-WQ') return { radius: 5, color: '#5e358b', fillColor: '#7d4bb3', fillOpacity: 0.82, weight: 1.5, renderer: canvasRenderer };
    return { radius: 5, color: '#a55414', fillColor: '#db7b22', fillOpacity: 0.84, weight: 1.5, renderer: canvasRenderer };
  }

  function drawRecords(records, layer) {
    layer.clearLayers();
    const activeOnly = byId('activeWellsOnly').checked;
    records.filter(record => !activeOnly || record.active).forEach(record => {
      const marker = L.circleMarker([record.lat, record.lng], markerOptions(record.sourceCode));
      marker.wellRecord = record;
      marker.bindPopup(wellPopup(record), { maxWidth: 330 });
      marker.addTo(layer);
    });
  }

  function redrawAll() {
    drawRecords(wraRecords, wraLayer);
    drawRecords(moenvRecords, moenvLayer);
    drawRecords(moenvSiteRecords, moenvSiteLayer);
    renderNearbyWells();
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function queryCenter() {
    if (typeof centerMarker !== 'undefined' && centerMarker) {
      const point = centerMarker.getLatLng();
      return { lat: point.lat, lng: point.lng };
    }
    const point = map.getCenter();
    return { lat: point.lat, lng: point.lng };
  }

  function visibleRecords() {
    const activeOnly = byId('activeWellsOnly').checked;
    const records = [];
    if (byId('wraWellLayerCheck').checked) records.push(...wraRecords);
    if (byId('moenvWellLayerCheck').checked) records.push(...moenvRecords);
    if (byId('moenvSiteWellLayerCheck').checked) records.push(...moenvSiteRecords);
    return activeOnly ? records.filter(record => record.active) : records;
  }

  function renderNearbyWells() {
    const list = byId('wellList');
    const summary = byId('wellSummary');
    const all = visibleRecords();
    if (!all.length) {
      summary.textContent = '尚未載入監測井，或目前圖層已關閉。';
      list.innerHTML = '';
      return;
    }
    const center = queryCenter();
    const radius = Number(byId('wellRadius').value);
    const nearby = all.map(record => ({ ...record, distance: haversine(center.lat, center.lng, record.lat, record.lng) }))
      .filter(record => record.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
    const countText = `已載入：水利署 ${wraRecords.length}、環境部區域井 ${moenvRecords.length}、環境部場置井 ${moenvSiteRecords.length}`;
    summary.textContent = nearby.length ? `${countText}。目前中心 ${radius} 公里內 ${nearby.length} 口；最近 ${nearby[0].distance.toFixed(2)} 公里：${nearby[0].name}` : `${countText}。目前中心 ${radius} 公里內未查得監測井。`;
    list.innerHTML = '';
    nearby.slice(0, 60).forEach(record => {
      const card = document.createElement('div');
      card.className = 'well-card';
      card.innerHTML = `<strong>${escapeHtml(record.name)}</strong><span class="well-source">${escapeHtml(record.source)}</span><br><span class="well-distance">距離 ${record.distance.toFixed(2)} 公里</span>${record.id ? `｜${escapeHtml(record.id)}` : ''}<br>${escapeHtml(record.address || record.siteName || record.groundwaterZone || '位置資料未載明')}${record.depth ? `<br>井深：${escapeHtml(record.depth)} m` : ''}`;
      card.onclick = () => {
        map.setView([record.lat, record.lng], 18);
        const layer = record.sourceCode === 'WRA' ? wraLayer : record.sourceCode === 'MOENV-WQ' ? moenvLayer : moenvSiteLayer;
        const marker = layer.getLayers().find(item => item.wellRecord?.id === record.id && item.wellRecord?.name === record.name);
        marker?.openPopup();
      };
      list.appendChild(card);
    });
  }

  function setStatus(message, className = 'status') {
    const status = byId('wellStatus');
    status.className = className;
    status.textContent = message;
  }

  async function loadWraWells() {
    const button = byId('loadWraWellsBtn');
    button.disabled = true;
    button.textContent = '載入中…';
    setStatus('正在下載經濟部水利署地下水水位觀測井井況資料…');
    try {
      const response = await fetch('https://opendata.wra.gov.tw/api/v2/3e86faea-e94a-4a91-a870-852d73e83c3d?format=JSON&sort=_importdate%20asc');
      if (!response.ok) throw new Error(`水利署 API 回應 ${response.status}`);
      const rows = await response.json();
      wraRecords = extractRows(rows).map(normalizeWraWell).filter(record => validTaiwan(record));
      drawRecords(wraRecords, wraLayer);
      setStatus(`已載入水利署監測井 ${wraRecords.length} 筆。環境部監測井需 API Key。`, 'status success');
      renderNearbyWells();
    } catch (error) {
      setStatus(`水利署監測井載入失敗：${error.message}`, 'status error');
    } finally {
      button.disabled = false;
      button.textContent = '重新載入水利署監測井';
    }
  }

  async function fetchMoenvDataset(dataId, apiKey) {
    const rows = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const url = new URL(`https://data.moenv.gov.tw/api/v2/${dataId}`);
      url.search = new URLSearchParams({ format: 'json', offset: String(offset), limit: '1000', api_key: apiKey });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${dataId} 回應 ${response.status}`);
      const batch = extractRows(await response.json());
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
    return rows;
  }

  async function loadMoenvWells() {
    const keyInput = byId('moenvApiKey');
    const apiKey = keyInput?.value.trim() || localStorage.getItem('moenv_api_key') || '';
    if (!apiKey) {
      setStatus('請先在「污染場址資料」區輸入環境部 API Key；同一把 Key 可載入環境部監測井。', 'status error');
      keyInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    localStorage.setItem('moenv_api_key', apiKey);
    const button = byId('loadMoenvWellsBtn');
    button.disabled = true;
    button.textContent = '載入中…';
    setStatus('正在下載環境部區域性與場置性地下水監測井…');
    try {
      const [regionalResult, siteResult] = await Promise.allSettled([
        fetchMoenvDataset('WQX_P_07', apiKey),
        fetchMoenvDataset('GISEPA_P_33', apiKey)
      ]);
      if (regionalResult.status === 'fulfilled') {
        moenvRecords = regionalResult.value.map(normalizeMoenvRegional).filter(record => validTaiwan(record));
        drawRecords(moenvRecords, moenvLayer);
      }
      if (siteResult.status === 'fulfilled') {
        moenvSiteRecords = siteResult.value.map(normalizeMoenvSite).filter(record => validTaiwan(record));
        drawRecords(moenvSiteRecords, moenvSiteLayer);
      }
      if (regionalResult.status === 'rejected' && siteResult.status === 'rejected') throw new Error(`${regionalResult.reason?.message || ''}；${siteResult.reason?.message || ''}`);
      const warnings = [];
      if (regionalResult.status === 'rejected') warnings.push(`區域井失敗：${regionalResult.reason?.message}`);
      if (siteResult.status === 'rejected') warnings.push(`場置井失敗：${siteResult.reason?.message}`);
      setStatus(`已載入環境部區域井 ${moenvRecords.length} 筆、場置井 ${moenvSiteRecords.length} 筆${warnings.length ? `；${warnings.join('；')}` : ''}`, warnings.length ? 'status warning' : 'status success');
      renderNearbyWells();
    } catch (error) {
      setStatus(`環境部監測井載入失敗：${error.message}。請確認 API Key。`, 'status error');
    } finally {
      button.disabled = false;
      button.textContent = '重新載入環境部監測井';
    }
  }

  byId('loadWraWellsBtn').onclick = loadWraWells;
  byId('loadMoenvWellsBtn').onclick = loadMoenvWells;
  byId('wellRadius').onchange = renderNearbyWells;
  byId('activeWellsOnly').onchange = redrawAll;
  byId('wraWellLayerCheck').onchange = event => { event.target.checked ? wraLayer.addTo(map) : map.removeLayer(wraLayer); renderNearbyWells(); };
  byId('moenvWellLayerCheck').onchange = event => { event.target.checked ? moenvLayer.addTo(map) : map.removeLayer(moenvLayer); renderNearbyWells(); };
  byId('moenvSiteWellLayerCheck').onchange = event => { event.target.checked ? moenvSiteLayer.addTo(map) : map.removeLayer(moenvSiteLayer); renderNearbyWells(); };
  map.on('moveend', renderNearbyWells);

  const priorSetCenter = setCenter;
  setCenter = function(...args) {
    priorSetCenter(...args);
    renderNearbyWells();
  };

  const sourceStatus = byId('sourceStatus');
  if (sourceStatus) {
    sourceStatus.innerHTML = sourceStatus.innerHTML.replace('<b>污染場址：</b>', '<b>監測井：</b>水利署公開資料＋環境部 WQX_P_07／GISEPA_P_33<br><b>污染場址：</b>');
  }

  loadWraWells();
  const savedKey = localStorage.getItem('moenv_api_key');
  if (savedKey) setTimeout(loadMoenvWells, 600);
})();
