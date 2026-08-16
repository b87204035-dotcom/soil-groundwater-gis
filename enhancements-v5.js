(() => {
  const byId = id => document.getElementById(id);
  const css = document.createElement('style');
  css.textContent = `
    .media-actions{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px}
    .media-actions button{margin:0}
    .media-gallery{display:grid;gap:8px;margin-top:8px}
    .media-card{border:1px solid #d7e3e3;border-radius:10px;padding:8px;background:#f7fafa}
    .media-card video,.media-card audio{width:100%;max-height:230px}
    .media-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px}
    .media-head button{width:auto;margin:0;padding:5px 8px;background:#b34136}
    .site-tools{display:grid;gap:7px;margin-top:8px}
    .site-list{display:grid;gap:7px;margin-top:8px;max-height:280px;overflow:auto}
    .site-card{border:1px solid #e4c9c3;border-radius:10px;padding:9px;background:#fff8f6;font-size:12px;line-height:1.45;cursor:pointer}
    .site-card strong{font-size:13px}.site-card .distance{color:#a03e32;font-weight:800}
    .official-link{display:block;margin-top:8px;color:#176b68;font-weight:700}
    .api-note{font-size:11px;color:#68777c;line-height:1.45}
    @media(max-width:520px){.media-actions{grid-template-columns:1fr}.site-list{max-height:none}}
  `;
  document.head.appendChild(css);

  // ── Sampling point name ───────────────────────────────────────────────
  const editorCard = document.querySelector('#sampleEditor .modal-card');
  const editorHead = document.querySelector('#sampleEditor .modal-head');
  const nameInput = document.createElement('input');
  nameInput.id = 'editPointName';
  nameInput.placeholder = '點位名稱，例如：油槽東側表土、機台排水溝旁';
  editorHead.insertAdjacentElement('afterend', nameInput);

  const originalCreateSamplePoint = createSamplePoint;
  createSamplePoint = function(lat, lng, accuracy) {
    originalCreateSamplePoint(lat, lng, accuracy);
    if (editingMarker) {
      const p = editingMarker.feature.properties;
      p.pointName = p.pointName || `採樣點 ${p.code}`;
      p.media = Array.isArray(p.media) ? p.media : [];
      fillEditor(editingMarker);
      editingMarker.setPopupContent(samplePopup(p));
      renderSampleList();
    }
  };

  const originalAttachSampleMarker = attachSampleMarker;
  attachSampleMarker = function(marker, properties) {
    properties.pointName = properties.pointName || `採樣點 ${properties.code || ''}`;
    properties.media = Array.isArray(properties.media) ? properties.media : [];
    return originalAttachSampleMarker(marker, properties);
  };

  const originalFillEditor = fillEditor;
  fillEditor = function(marker) {
    originalFillEditor(marker);
    const p = marker.feature.properties;
    nameInput.value = p.pointName || `採樣點 ${p.code}`;
    renderSampleMedia();
  };

  const originalSaveEditor = saveEditor;
  saveEditor = function() {
    if (editingMarker) {
      const p = editingMarker.feature.properties;
      p.pointName = nameInput.value.trim() || `採樣點 ${p.code}`;
    }
    originalSaveEditor();
  };
  byId('saveSampleBtn').onclick = saveEditor;

  samplePopup = function(p) {
    const photos = p.photos?.length || 0;
    const media = p.media?.length || 0;
    return `<div class="sample-popup"><div class="sample-popup-summary"><b>${p.pointName || `採樣點 ${p.code}`}｜${p.code}</b><span>介質：${p.medium}</span><span>分析：${p.analysis}</span><span>深度：${p.depth}</span><span>照片 ${photos}・影音／錄音 ${media}</span></div><div class="popup-actions"><button onclick="editSampleByCode('${p.code}')">編輯／媒體</button><button onclick="toggleSampleDetails(this)">座標</button></div><div class="sample-popup-details"><b>WGS84</b><br>${Number(p.wgs84Lat).toFixed(6)}, ${Number(p.wgs84Lng).toFixed(6)}<br><b>TWD97 zone ${p.twd97Zone}</b><br>E ${Number(p.twd97E).toFixed(3)} m<br>N ${Number(p.twd97N).toFixed(3)} m<br>${p.twd97Epsg}・${p.positionSource || ''}</div></div>`;
  };

  renderSampleList = function() {
    const box = byId('sampleList');
    if (!box) return;
    box.innerHTML = '';
    samples.getLayers().forEach(marker => {
      const p = marker.feature?.properties;
      if (!p) return;
      p.pointName = p.pointName || `採樣點 ${p.code}`;
      p.media = Array.isArray(p.media) ? p.media : [];
      const card = document.createElement('div');
      card.className = 'sample-card';
      card.innerHTML = `<strong>${p.pointName}</strong><br><b>${p.code}｜${p.medium}</b><br>分析：${p.analysis}<br>深度：${p.depth}<br>照片：${p.photos?.length || 0}・影音／錄音：${p.media.length}<br><span class="coord">WGS84 ${Number(p.wgs84Lat).toFixed(6)}, ${Number(p.wgs84Lng).toFixed(6)}</span><br><span class="coord">TWD97 E ${Number(p.twd97E).toFixed(3)} / N ${Number(p.twd97N).toFixed(3)}</span><span class="edit-hint">點此編輯名稱、資料與媒體</span>`;
      card.onclick = () => openSampleEditor(marker);
      box.appendChild(card);
    });
  };

  // ── IndexedDB media storage ───────────────────────────────────────────
  const DB_NAME = 'soil-gis-media-v1';
  const STORE = 'media';
  let dbPromise;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function putBlob(id, blob) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, blob });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getBlob(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result?.blob || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function deleteBlob(id) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const mediaTitle = document.createElement('h2');
  mediaTitle.textContent = '錄影與錄音';
  const mediaInputs = document.createElement('div');
  mediaInputs.innerHTML = `
    <input id="sampleVideoInput" type="file" accept="video/*" capture="environment" multiple hidden>
    <input id="sampleAudioInput" type="file" accept="audio/*" capture multiple hidden>
    <div class="media-actions">
      <button id="addSampleVideoBtn" type="button">錄影／新增影片</button>
      <button id="addSampleAudioBtn" type="button">錄音／新增音訊</button>
    </div>
    <div class="api-note">影片與錄音儲存在這支手機的瀏覽器資料庫；GeoJSON只匯出媒體名稱與時間，不包含大型影音檔。</div>
    <div id="sampleMediaGallery" class="media-gallery"></div>`;
  const photoGallery = byId('samplePhotoGallery');
  photoGallery.insertAdjacentElement('afterend', mediaInputs);
  mediaInputs.insertAdjacentElement('beforebegin', mediaTitle);

  byId('addSampleVideoBtn').onclick = () => byId('sampleVideoInput').click();
  byId('addSampleAudioBtn').onclick = () => byId('sampleAudioInput').click();

  async function importMediaFiles(files, type) {
    if (!editingMarker) return;
    const p = editingMarker.feature.properties;
    p.media = Array.isArray(p.media) ? p.media : [];
    for (const file of files) {
      const id = `${p.code}-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
      await putBlob(id, file);
      p.media.push({ id, type, name: file.name || (type === 'video' ? '現場錄影' : '現場錄音'), mime: file.type, size: file.size, createdAt: new Date().toISOString() });
    }
    p.updatedAt = new Date().toISOString();
    editingMarker.setPopupContent(samplePopup(p));
    await renderSampleMedia();
    updateCounts();
  }

  byId('sampleVideoInput').onchange = async e => {
    const button = byId('addSampleVideoBtn');
    button.disabled = true; button.textContent = '儲存影片中…';
    try { await importMediaFiles([...e.target.files], 'video'); }
    finally { button.disabled = false; button.textContent = '錄影／新增影片'; e.target.value = ''; }
  };
  byId('sampleAudioInput').onchange = async e => {
    const button = byId('addSampleAudioBtn');
    button.disabled = true; button.textContent = '儲存音訊中…';
    try { await importMediaFiles([...e.target.files], 'audio'); }
    finally { button.disabled = false; button.textContent = '錄音／新增音訊'; e.target.value = ''; }
  };

  async function renderSampleMedia() {
    const box = byId('sampleMediaGallery');
    if (!box) return;
    box.innerHTML = '';
    if (!editingMarker) return;
    const arr = editingMarker.feature.properties.media || [];
    if (!arr.length) { box.innerHTML = '<div class="small">尚未新增錄影或錄音</div>'; return; }
    for (const item of arr) {
      const card = document.createElement('div');
      card.className = 'media-card';
      const head = document.createElement('div');
      head.className = 'media-head';
      head.innerHTML = `<strong>${item.type === 'video' ? '影片' : '錄音'}｜${item.name}</strong><button type="button">刪除</button>`;
      card.appendChild(head);
      const blob = await getBlob(item.id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const el = document.createElement(item.type === 'video' ? 'video' : 'audio');
        el.controls = true; el.src = url; el.preload = 'metadata';
        card.appendChild(el);
      } else {
        const missing = document.createElement('div');
        missing.className = 'small'; missing.textContent = '這個媒體檔不在目前瀏覽器中。';
        card.appendChild(missing);
      }
      head.querySelector('button').onclick = async () => {
        await deleteBlob(item.id);
        const index = arr.findIndex(x => x.id === item.id);
        if (index >= 0) arr.splice(index, 1);
        editingMarker.setPopupContent(samplePopup(editingMarker.feature.properties));
        await renderSampleMedia();
        updateCounts();
      };
      box.appendChild(card);
    }
  }

  const oldDelete = byId('deleteSampleBtn').onclick;
  byId('deleteSampleBtn').onclick = async () => {
    if (!editingMarker) return;
    const marker = editingMarker;
    const code = marker.feature.properties.code;
    if (!confirm(`確定刪除採樣點 ${code}？`)) return;
    for (const item of marker.feature.properties.media || []) await deleteBlob(item.id);
    samples.removeLayer(marker);
    closeSampleEditor();
    updateCounts();
  };

  function totalMedia() {
    return samples.getLayers().reduce((n, m) => n + (m.feature?.properties?.photos?.length || 0) + (m.feature?.properties?.media?.length || 0), 0) + photos.getLayers().length;
  }
  updateCounts = function() {
    byId('sampleCount').textContent = samples.getLayers().length;
    byId('photoCount').textContent = totalMedia();
    byId('shapeCount').textContent = drawn.getLayers().length;
    const mediaLabel = byId('photoCount')?.parentElement?.querySelector('.small');
    if (mediaLabel) mediaLabel.textContent = '照片／影音';
    renderSampleList();
  };

  // ── Official MOENV contaminated-site data ────────────────────────────
  const syncStatus = byId('syncStatus');
  const siteTools = document.createElement('div');
  siteTools.className = 'site-tools';
  siteTools.innerHTML = `
    <input id="moenvApiKey" type="password" autocomplete="off" placeholder="環境部開放資料 API Key">
    <div class="grid2"><select id="siteRadius"><option value="0.5">0.5 公里</option><option value="1" selected>1 公里</option><option value="2">2 公里</option><option value="5">5 公里</option><option value="10">10 公里</option></select><button id="syncOfficialSitesBtn" type="button">同步官方場址</button></div>
    <div class="api-note">API Key只儲存在這支手機。取得Key後可同步環境部 EMS_S_07；也可繼續使用下方檔案匯入。</div>
    <a class="official-link" target="_blank" rel="noopener" href="https://data.moenv.gov.tw/dataset/detail/EMS_S_07">環境部污染場址資料集</a>
    <a class="official-link" target="_blank" rel="noopener" href="https://sgw.moenv.gov.tw/SgwSiteInfo/SituationMap/?SituationType=All">開啟官方公告場址查詢</a>
    <div id="officialSiteList" class="site-list"></div>`;
  syncStatus.insertAdjacentElement('afterend', siteTools);
  const keyInput = byId('moenvApiKey');
  keyInput.value = localStorage.getItem('moenv_api_key') || '';
  keyInput.onchange = () => localStorage.setItem('moenv_api_key', keyInput.value.trim());

  let officialRecords = [];
  const lowerKeys = obj => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k.toLowerCase(), v]));
  function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ['records', 'data', 'result', 'items']) {
      const v = payload?.[key];
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.records)) return v.records;
    }
    return [];
  }
  function normalizeSite(raw) {
    const r = lowerKeys(raw);
    const lat = Number(r.wgs84_lat ?? r.lat ?? r.latitude);
    const lng = Number(r.wgs84_lng ?? r.lng ?? r.lon ?? r.longitude);
    return {
      id: r.site_id || '', name: r.site_name || '污染場址', county: r.county || '', township: r.township || '',
      type: r.site_type || '', use: r.site_use || '', pollutant: r.pollutant || '', address: r.pollutantaddress || '',
      control: r.controltype || '', annoNo: r.anno_no || '', annoDate: r.anno_date || '', deannoDate: r.deanno_date || '',
      landNo: r.landno || '', area: r.sitearea || '', lat, lng
    };
  }
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function sitePopup(s) {
    return `<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.control || s.type)}<br>${escapeHtml(s.address)}<hr style="border:0;border-top:1px solid #ddd"><b>污染物：</b>${escapeHtml(s.pollutant || '未載明')}<br><b>地號：</b>${escapeHtml(s.landNo || '未載明')}<br><b>公告：</b>${escapeHtml(s.annoDate || '')} ${escapeHtml(s.annoNo || '')}${s.deannoDate ? `<br><b>解列日期：</b>${escapeHtml(s.deannoDate)}` : ''}`;
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  function currentCenter() {
    if (centerMarker) { const p = centerMarker.getLatLng(); return {lat:p.lat,lng:p.lng}; }
    const p = map.getCenter(); return {lat:p.lat,lng:p.lng};
  }
  function analyzeNearbySites() {
    const list = byId('officialSiteList');
    list.innerHTML = '';
    if (!officialRecords.length) {
      byId('nearestSite').textContent = '尚未同步環境部污染場址資料';
      return;
    }
    const c = currentCenter(), radius = Number(byId('siteRadius').value);
    const nearby = officialRecords.map(s => ({...s, distance:haversine(c.lat,c.lng,s.lat,s.lng)})).filter(s => s.distance <= radius).sort((a,b) => a.distance-b.distance);
    byId('nearestSite').textContent = nearby.length ? `${radius} 公里內有 ${nearby.length} 處官方污染場址；最近 ${nearby[0].distance.toFixed(2)} 公里：${nearby[0].name}` : `${radius} 公里內未查得官方污染場址`;
    nearby.slice(0,30).forEach(s => {
      const card = document.createElement('div');
      card.className = 'site-card';
      card.innerHTML = `<strong>${escapeHtml(s.name)}</strong><br><span class="distance">距離 ${s.distance.toFixed(2)} 公里</span>｜${escapeHtml(s.control || s.type)}<br>${escapeHtml(s.address)}<br>污染物：${escapeHtml(s.pollutant || '未載明')}`;
      card.onclick = () => map.setView([s.lat,s.lng],18);
      list.appendChild(card);
    });
  }
  byId('siteRadius').onchange = analyzeNearbySites;

  async function syncOfficialSites() {
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      syncStatus.className = 'status error';
      syncStatus.textContent = '請先輸入環境部開放資料 API Key；或點下方「官方公告場址查詢」直接查詢。';
      return;
    }
    localStorage.setItem('moenv_api_key', apiKey);
    const button = byId('syncOfficialSitesBtn');
    button.disabled = true; button.textContent = '同步中…';
    syncStatus.className = 'status'; syncStatus.textContent = '正在下載環境部 EMS_S_07…';
    try {
      let rows = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const url = new URL('https://data.moenv.gov.tw/api/v2/EMS_S_07');
        url.search = new URLSearchParams({ format:'json', offset:String(offset), limit:'1000', api_key:apiKey });
        const response = await fetch(url);
        if (!response.ok) throw new Error(`環境部 API 回應 ${response.status}`);
        const batch = extractRows(await response.json());
        rows.push(...batch);
        if (batch.length < 1000) break;
      }
      officialRecords = rows.map(normalizeSite).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat > 20 && s.lat < 27 && s.lng > 117 && s.lng < 123);
      sites.clearLayers();
      officialRecords.forEach(s => {
        const marker = L.circleMarker([s.lat,s.lng], { radius:6, color:'#a83c32', weight:2, fillColor:'#e66150', fillOpacity:.8 });
        marker.feature = { type:'Feature', properties:{ kind:'official-contaminated-site', ...s } };
        marker.bindPopup(sitePopup(s), {maxWidth:320}).addTo(sites);
      });
      syncStatus.className = 'status success';
      syncStatus.textContent = `已同步環境部官方場址 ${officialRecords.length} 筆・${new Date().toLocaleString('zh-TW')}`;
      const source = byId('sourceStatus');
      source.innerHTML = source.innerHTML.replace(/<b>污染場址：<\/b>[^<]*/, `<b>污染場址：</b>環境部 EMS_S_07，已同步 ${officialRecords.length} 筆`);
      analyzeNearbySites();
    } catch (error) {
      syncStatus.className = 'status error';
      syncStatus.textContent = `官方場址同步失敗：${error.message}。請確認 API Key，或使用官方公告場址查詢。`;
    } finally {
      button.disabled = false; button.textContent = '同步官方場址';
    }
  }
  byId('syncOfficialSitesBtn').onclick = syncOfficialSites;

  const originalSetCenter = setCenter;
  setCenter = function(...args) { originalSetCenter(...args); analyzeNearbySites(); };
  map.on('moveend', () => { if (officialRecords.length) analyzeNearbySites(); });

  if (keyInput.value) syncOfficialSites();
  updateCounts();
})();
