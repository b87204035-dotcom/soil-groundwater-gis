(() => {
  const byId = id => document.getElementById(id);
  if (typeof map === 'undefined' || typeof L === 'undefined' || !byId('addressInput')) return;

  const style = document.createElement('style');
  style.textContent = `
    .address-verify{margin-top:8px;border:1px solid #cfdcde;border-radius:11px;padding:10px;background:#f8fbfb}
    .address-verify summary{cursor:pointer;font-weight:800;color:#23484a}
    .verify-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}
    .confidence{display:inline-block;border-radius:999px;padding:3px 8px;font-weight:800;font-size:12px;margin-right:5px}
    .confidence.high{background:#dff4e8;color:#17603d}.confidence.medium{background:#fff0c9;color:#8a5b00}.confidence.low{background:#ffe1dc;color:#9b352b}
    .verify-result{margin-top:8px;padding:10px;border-radius:10px;background:#f3f7f7;font-size:12px;line-height:1.5}
    .provider-row{border-top:1px solid #dce5e6;padding-top:6px;margin-top:6px}
    .candidate-map-dot{background:#fff;border:2px solid #176b68;border-radius:50%;width:24px;height:24px;line-height:20px;text-align:center;font-weight:800;box-shadow:0 1px 5px #0006}
    .confirm-location{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}
    .confirm-location button{margin:0}
    @media(max-width:520px){.verify-grid,.confirm-location{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const status = byId('addressStatus');
  const verify = document.createElement('details');
  verify.className = 'address-verify';
  verify.innerHTML = `
    <summary>地址自動驗證設定</summary>
    <label>公司／地標名稱（選填，用來交叉驗證）</label>
    <input id="addressPoiInput" placeholder="例如：華淵電機工業股份有限公司">
    <div class="verify-grid">
      <input id="tgosAppId" placeholder="TGOS APP ID（選填）">
      <input id="tgosApiKey" type="password" autocomplete="off" placeholder="TGOS API Key（選填）">
    </div>
    <label><input id="strictAddressCheck" type="checkbox" checked>低可信度時不視為正式定位結果</label>
    <div class="small">未填 TGOS 金鑰時，仍使用 ArcGIS、OpenStreetMap、Photon 交叉比對；填入 TGOS 後優先採用官方門牌資料。</div>
    <div id="addressVerifyResult" class="verify-result">尚未驗證</div>`;
  status.insertAdjacentElement('afterend', verify);

  byId('tgosAppId').value = localStorage.getItem('tgos_app_id') || '';
  byId('tgosApiKey').value = localStorage.getItem('tgos_api_key') || '';
  byId('tgosAppId').onchange = e => localStorage.setItem('tgos_app_id', e.target.value.trim());
  byId('tgosApiKey').onchange = e => localStorage.setItem('tgos_api_key', e.target.value.trim());

  const candidateLayer = L.layerGroup().addTo(map);

  const normalize = value => String(value || '')
    .replace(/臺/g, '台').replace(/\s+/g, '').replace(/[﹣－–—]/g, '-')
    .replace(/新竹工業區/g, '').replace(/[村里鄰]/g, '')
    .replace(/之/g, '-').toLowerCase();

  function parseAddress(raw) {
    const text = raw.replace(/臺/g, '台').replace(/\s+/g, '');
    const county = text.match(/^(.+?[縣市])/)?.[1] || '';
    const town = text.match(/[縣市](.+?(?:鄉|鎮|市|區))/)?.[1] || '';
    const road = text.match(/([^縣市鄉鎮區村里鄰]+?(?:路|街|大道)(?:[一二三四五六七八九十0-9]+段)?)/)?.[1] || '';
    const lane = text.match(/(\d+巷)/)?.[1] || '';
    const alley = text.match(/(\d+弄)/)?.[1] || '';
    const number = text.match(/(\d+(?:之\d+|-\d+)?號)/)?.[1]?.replace(/之/g, '-') || '';
    return { county, town, road, lane, alley, number };
  }

  function variantsFor(raw) {
    const base = raw.trim().replace(/臺/g, '台').replace(/\s+/g, '');
    const out = [base];
    if (/^新竹縣湖口鄉/.test(base)) {
      const rest = base.replace(/^新竹縣湖口鄉(?:新竹工業區|鳳山村|鳳凰村)?/, '');
      out.push(`新竹縣湖口鄉新竹工業區${rest}`, `新竹縣湖口鄉鳳山村${rest}`, `新竹縣湖口鄉鳳凰村${rest}`);
    }
    out.push(base.replace(/[\u4e00-\u9fff]{1,4}(?:村|里)\d*鄰?/g, ''));
    return [...new Set(out.filter(Boolean))];
  }

  function distanceMeters(a, b) {
    const R = 6371000;
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function componentMatch(label, parts) {
    const n = normalize(label);
    return {
      county: !parts.county || n.includes(normalize(parts.county)),
      town: !parts.town || n.includes(normalize(parts.town)),
      road: !parts.road || n.includes(normalize(parts.road)),
      lane: !parts.lane || n.includes(normalize(parts.lane)),
      alley: !parts.alley || n.includes(normalize(parts.alley)),
      number: !parts.number || n.includes(normalize(parts.number))
    };
  }

  const providerWeight = source => source === 'TGOS' ? 70 : source === 'ArcGIS' ? 35 : source === 'OpenStreetMap' ? 28 : 18;

  async function queryTgos(address, exactOnly = true) {
    const appId = byId('tgosAppId').value.trim();
    const apiKey = byId('tgosApiKey').value.trim();
    if (!appId || !apiKey) return [];
    localStorage.setItem('tgos_app_id', appId);
    localStorage.setItem('tgos_api_key', apiKey);
    const url = new URL('https://addr.tgos.tw/addrws/v30/QueryAddr.asmx/QueryAddr');
    url.search = new URLSearchParams({
      oAPPId: appId, oAPIKey: apiKey, oAddress: address, oSRS: 'EPSG:4326',
      oFuzzyType: '2', oResultDataType: 'JSON', oFuzzyBuffer: '100',
      oIsOnlyFullMatch: String(exactOnly), oIsLockCounty: 'true', oIsLockTown: 'true',
      oIsLockVillage: 'false', oIsLockRoadSection: 'false', oIsLockLane: 'false',
      oIsLockAlley: 'false', oIsLockArea: 'false', oIsSameNumber_SubNumber: 'true',
      oCanIgnoreVillage: 'true', oCanIgnoreNeighborhood: 'true', oReturnMaxCount: '10'
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TGOS ${response.status}`);
    let payload = await response.json();
    if (typeof payload === 'string') payload = JSON.parse(payload);
    const rows = payload.AddressList || payload.addressList || payload.records || [];
    return rows.map(row => ({
      lat: Number(row.Y ?? row.y), lng: Number(row.X ?? row.x),
      label: row.FULL_ADDR || row.full_addr || row.Address || address,
      score: exactOnly ? 100 : 85, source: 'TGOS', type: exactOnly ? 'OfficialExact' : 'OfficialFuzzy', exactOfficial: exactOnly
    })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
  }

  async function reverseArcgis(point) {
    try {
      const url = new URL('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode');
      url.search = new URLSearchParams({ location: `${point.lng},${point.lat}`, langCode: 'zh-TW', featureTypes: 'PointAddress,StreetAddress', f: 'json' });
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      return data.address?.LongLabel || data.address?.Match_addr || null;
    } catch { return null; }
  }

  async function reverseOsm(point) {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.search = new URLSearchParams({ format: 'jsonv2', lat: String(point.lat), lon: String(point.lng), zoom: '18', 'accept-language': 'zh-TW' });
      const response = await fetch(url, { headers: { 'Accept-Language': 'zh-TW' } });
      if (!response.ok) return null;
      return (await response.json()).display_name || null;
    } catch { return null; }
  }

  async function queryPoi(poi, raw) {
    if (!poi) return [];
    const context = `${poi} ${raw}`;
    const settled = await Promise.allSettled([arcgis(context), nominatim(context), photon(context)]);
    return settled.flatMap(x => x.status === 'fulfilled' ? x.value.map(r => ({ ...r, poiEvidence: true })) : []);
  }

  async function collectCandidates(raw) {
    const tasks = [];
    for (const variant of variantsFor(raw)) {
      tasks.push(arcgis(variant).then(rows => rows.map(x => ({ ...x, queryVariant: variant }))));
      tasks.push(nominatim(variant).then(rows => rows.map(x => ({ ...x, queryVariant: variant }))));
      tasks.push(photon(variant).then(rows => rows.map(x => ({ ...x, queryVariant: variant }))));
    }
    const poi = byId('addressPoiInput').value.trim() || byId('business')?.value.trim() || '';
    if (poi) tasks.push(queryPoi(poi, raw));
    if (byId('tgosAppId').value.trim() && byId('tgosApiKey').value.trim()) {
      tasks.push(queryTgos(raw, true));
      tasks.push(queryTgos(raw, false));
    }
    const settled = await Promise.allSettled(tasks);
    const rows = settled.flatMap(x => x.status === 'fulfilled' ? x.value : []);
    const seen = new Set();
    return rows.filter(x => x.lat > 20 && x.lat < 27 && x.lng > 117 && x.lng < 123).filter(x => {
      const key = `${x.source}|${x.lat.toFixed(6)}|${x.lng.toFixed(6)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function clusterCandidates(rows) {
    const clusters = [];
    for (const row of rows) {
      let cluster = clusters.find(c => distanceMeters(c.center, row) <= 150);
      if (!cluster) {
        cluster = { rows: [], center: { lat: row.lat, lng: row.lng } };
        clusters.push(cluster);
      }
      cluster.rows.push(row);
      cluster.center = {
        lat: cluster.rows.reduce((n, x) => n + x.lat, 0) / cluster.rows.length,
        lng: cluster.rows.reduce((n, x) => n + x.lng, 0) / cluster.rows.length
      };
    }
    return clusters;
  }

  function scoreCluster(cluster, parts) {
    const providers = [...new Set(cluster.rows.map(x => x.source))];
    let score = Math.max(...cluster.rows.map(x => providerWeight(x.source) + Math.min(20, Number(x.score || 0) / 5)));
    const checks = cluster.rows.map(x => componentMatch(x.label, parts));
    if (checks.some(x => x.county)) score += 5;
    if (checks.some(x => x.town)) score += 7;
    if (checks.some(x => x.road)) score += 15;
    if (checks.some(x => x.number)) score += 25;
    score += Math.max(0, providers.length - 1) * 18;
    if (cluster.rows.some(x => x.exactOfficial)) score += 30;
    if (cluster.rows.some(x => x.poiEvidence)) score += 12;
    const spread = Math.max(0, ...cluster.rows.map(x => distanceMeters(cluster.center, x)));
    if (spread > 100) score -= Math.min(30, (spread - 100) / 10);
    return { ...cluster, providers, score, spread, checks };
  }

  async function verifyAddress(raw) {
    const parts = parseAddress(raw);
    const rows = await collectCandidates(raw);
    if (!rows.length) return { level: 'low', score: 0, reason: '所有地址服務均查無結果', candidates: [] };
    const clusters = clusterCandidates(rows).map(c => scoreCluster(c, parts)).sort((a, b) => b.score - a.score);
    const top = clusters[0];
    const reverse = await Promise.all([reverseArcgis(top.center), reverseOsm(top.center)]);
    const reverseChecks = reverse.filter(Boolean).map(label => ({ label, match: componentMatch(label, parts) }));
    const reverseRoad = reverseChecks.some(x => x.match.road);
    const exactHouse = top.checks.some(x => x.road && x.number);
    const officialExact = top.rows.some(x => x.exactOfficial);
    let level = 'low';
    if ((officialExact && exactHouse) || (top.providers.length >= 2 && top.spread <= 80 && exactHouse && reverseRoad)) level = 'high';
    else if (exactHouse || officialExact || (top.providers.length >= 2 && top.spread <= 200 && reverseRoad)) level = 'medium';
    const score = Math.max(0, Math.min(100, Math.round(top.score / 1.7)));
    return { level, score, candidates: clusters, top, reverseChecks };
  }

  function showAllCandidates(clusters) {
    candidateLayer.clearLayers();
    const bounds = [];
    clusters.slice(0, 8).forEach((cluster, index) => {
      const icon = L.divIcon({ className: 'candidate-map-dot', html: String(index + 1), iconSize: [24, 24], iconAnchor: [12, 12] });
      const marker = L.marker([cluster.center.lat, cluster.center.lng], { icon }).addTo(candidateLayer);
      marker.bindPopup(`<b>候選 ${index + 1}</b><br>${cluster.rows[0]?.label || ''}<br>來源：${cluster.providers.join('、')}<br>離散：${Math.round(cluster.spread)}公尺<br><button onclick="window.acceptAddressCluster(${index})">採用這一點</button>`);
      bounds.push([cluster.center.lat, cluster.center.lng]);
    });
    window.__addressClusters = clusters;
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
  }

  window.acceptAddressCluster = index => {
    const cluster = window.__addressClusters?.[index];
    if (!cluster) return;
    setCenter(cluster.center.lat, cluster.center.lng, cluster.rows[0]?.label || `候選 ${index + 1}`, `人工選擇；來源 ${cluster.providers.join('、')}`);
    candidateLayer.clearLayers();
  };

  function renderVerification(result, raw) {
    const box = byId('addressVerifyResult');
    const label = result.level === 'high' ? '高可信度' : result.level === 'medium' ? '中可信度' : '低可信度';
    if (!result.top) {
      box.innerHTML = `<span class="confidence low">低可信度</span>${result.reason || '查無結果'}`;
      return;
    }
    const top = result.top;
    const reverseText = result.reverseChecks.length
      ? result.reverseChecks.map(x => `${x.label}${x.match.road ? '（道路吻合）' : ''}${x.match.number ? '（門牌吻合）' : ''}`).join('<br>')
      : '反查服務未回應';
    box.innerHTML = `<span class="confidence ${result.level}">${label} ${result.score}分</span><br>
      <b>建議位置：</b>${top.center.lat.toFixed(6)}, ${top.center.lng.toFixed(6)}<br>
      <b>來源：</b>${top.providers.join('、')}（${top.rows.length}筆）<br>
      <b>來源最大離散：</b>${Math.round(top.spread)}公尺<br>
      <b>門牌字串：</b>${top.rows[0]?.label || raw}<br>
      <div class="provider-row"><b>坐標反查：</b><br>${reverseText}</div>
      <div class="confirm-location"><button id="acceptVerifiedLocation" type="button">採用此位置</button><button id="showAllAddressCandidates" class="secondary" type="button">顯示全部候選</button></div>
      ${result.level === 'low' ? '<div class="small" style="color:#9b352b;margin-top:6px">低可信度結果不直接用於污染場址距離、地籍或法規判定，請選候選點或拖曳修正。</div>' : ''}`;
    byId('acceptVerifiedLocation').onclick = () => setCenter(top.center.lat, top.center.lng, top.rows[0]?.label || raw, `${label} ${result.score}分；${top.providers.join('、')}`);
    byId('showAllAddressCandidates').onclick = () => showAllCandidates(result.candidates);
  }

  async function improvedLocateAddress() {
    const raw = byId('addressInput').value.trim();
    if (!raw) {
      status.className = 'status error';
      status.textContent = '請輸入地址';
      return;
    }
    const button = byId('addressBtn');
    button.disabled = true;
    button.textContent = '查詢並驗證中…';
    status.className = 'status';
    status.textContent = '正在比對多個地址來源並反查驗證…';
    byId('addressCandidates').innerHTML = '';
    try {
      const result = await verifyAddress(raw);
      renderVerification(result, raw);
      verify.open = true;
      if (!result.top) throw new Error('查無地址');
      const strict = byId('strictAddressCheck').checked;
      if (result.level === 'low' && strict) {
        status.className = 'status warning';
        status.textContent = '找到候選位置，但可信度低，未自動視為正式定位。請按「採用此位置」、查看全部候選，或拖曳校正。';
        showAllCandidates(result.candidates);
      } else {
        const top = result.top;
        setCenter(top.center.lat, top.center.lng, top.rows[0]?.label || raw, `${result.level === 'high' ? '高' : result.level === 'medium' ? '中' : '低'}可信度 ${result.score}分；${top.providers.join('、')}`);
        status.className = `status ${result.level === 'high' ? 'success' : 'warning'}`;
        status.textContent = `已完成多來源驗證：${result.level === 'high' ? '高' : result.level === 'medium' ? '中' : '低'}可信度 ${result.score}分。`;
      }
    } catch (error) {
      status.className = 'status error';
      status.textContent = `地址驗證失敗：${error.message || '查無結果'}。請移動地圖到正確位置，再按「設為查詢中心」。`;
    } finally {
      button.disabled = false;
      button.textContent = '地址定位';
    }
  }

  locateAddress = improvedLocateAddress;
  byId('addressBtn').onclick = improvedLocateAddress;
  byId('addressInput').onkeydown = event => { if (event.key === 'Enter') improvedLocateAddress(); };
})();
