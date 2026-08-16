(() => {
  const byId = id => document.getElementById(id);
  if (typeof map === 'undefined' || typeof L === 'undefined') return;

  const css = document.createElement('style');
  css.textContent = `
    .layer-setting{margin:3px 0 8px 25px;padding:7px 9px;background:#f5f8f8;border-radius:9px;font-size:12px;color:#5f7074}
    .layer-setting input[type=range]{padding:0;margin:3px 0 0;width:100%}
    .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .field-note{font-size:11px;color:#68777c;line-height:1.45;margin-top:5px}
    .measure-result{position:absolute;z-index:950;right:12px;bottom:12px;max-width:240px;background:#fff;padding:8px 10px;border-radius:10px;box-shadow:0 2px 10px #0003;font-size:12px;display:none}
    .location-audit{margin-top:7px;padding-top:7px;border-top:1px solid #dce5e5;font-size:11px;color:#5d6f72;line-height:1.5}
  `;
  document.head.appendChild(css);

  // 1) 圖層透明度：保留原勾選邏輯，只新增透明度控制。
  function addOpacityControl(checkboxId, layer, labelText, defaultValue) {
    const checkbox = byId(checkboxId);
    if (!checkbox || !layer || checkbox.dataset.opacityControl) return;
    checkbox.dataset.opacityControl = '1';
    const label = checkbox.closest('label');
    if (!label) return;
    const box = document.createElement('div');
    box.className = 'layer-setting';
    box.innerHTML = `${labelText}透明度 <span>${defaultValue}%</span><input type="range" min="10" max="100" step="5" value="${defaultValue}">`;
    label.insertAdjacentElement('afterend', box);
    const range = box.querySelector('input');
    const value = box.querySelector('span');
    range.addEventListener('input', () => {
      value.textContent = `${range.value}%`;
      try { layer.setOpacity(Number(range.value) / 100); } catch (e) {}
    });
    try { layer.setOpacity(defaultValue / 100); } catch (e) {}
  }
  if (typeof photo !== 'undefined') addOpacityControl('photoLayer', photo, '航照／正射影像', 85);
  if (typeof cadastral !== 'undefined') addOpacityControl('cadastralLayer', cadastral, '地籍／段籍', 70);

  // 2) 量距與量面積：不取代原 Leaflet Draw，只新增快速按鈕。
  const toolbar = document.querySelector('.toolbar');
  let measureResult = byId('measureResult');
  if (toolbar && !byId('measureDistanceBtn')) {
    const distBtn = document.createElement('button');
    distBtn.id = 'measureDistanceBtn'; distBtn.type = 'button'; distBtn.textContent = '量距';
    const areaBtn = document.createElement('button');
    areaBtn.id = 'measureAreaBtn'; areaBtn.type = 'button'; areaBtn.textContent = '量面積';
    toolbar.append(distBtn, areaBtn);
    measureResult = document.createElement('div');
    measureResult.id = 'measureResult'; measureResult.className = 'measure-result';
    document.getElementById('mapWrap')?.appendChild(measureResult);

    const showMeasure = text => { measureResult.textContent = text; measureResult.style.display = 'block'; setTimeout(() => { measureResult.style.display = 'none'; }, 7000); };
    const lineLength = latlngs => latlngs.slice(1).reduce((sum, p, i) => sum + latlngs[i].distanceTo(p), 0);
    distBtn.onclick = () => {
      const drawer = new L.Draw.Polyline(map, { shapeOptions: { weight: 4 } });
      drawer.enable();
      map.once(L.Draw.Event.CREATED, e => {
        const pts = e.layer.getLatLngs();
        const m = lineLength(pts);
        e.layer.bindTooltip(m >= 1000 ? `${(m/1000).toFixed(3)} km` : `${m.toFixed(1)} m`, { permanent: true, direction: 'center' });
        if (typeof drawn !== 'undefined') drawn.addLayer(e.layer); else e.layer.addTo(map);
        showMeasure(`距離：${m >= 1000 ? (m/1000).toFixed(3) + ' km' : m.toFixed(1) + ' m'}`);
        if (typeof updateCounts === 'function') updateCounts();
      });
    };
    areaBtn.onclick = () => {
      const drawer = new L.Draw.Polygon(map, { showArea: true, shapeOptions: { weight: 3 } });
      drawer.enable();
      map.once(L.Draw.Event.CREATED, e => {
        const pts = e.layer.getLatLngs()[0];
        const area = L.GeometryUtil?.geodesicArea ? L.GeometryUtil.geodesicArea(pts) : 0;
        const text = area >= 10000 ? `${(area/10000).toFixed(3)} ha` : `${area.toFixed(1)} m²`;
        e.layer.bindTooltip(text, { permanent: true, direction: 'center' });
        if (typeof drawn !== 'undefined') drawn.addLayer(e.layer); else e.layer.addTo(map);
        showMeasure(`面積：${text}`);
        if (typeof updateCounts === 'function') updateCounts();
      });
    };
  }

  // 3) 定位來源／可信度紀錄：沿用既有查詢結果，只補稽核資訊。
  const queryResult = byId('queryTitle')?.closest('.result');
  if (queryResult && !byId('locationAudit')) {
    const audit = document.createElement('div');
    audit.id = 'locationAudit'; audit.className = 'location-audit';
    audit.textContent = '定位紀錄：尚未定位';
    queryResult.appendChild(audit);
  }
  function updateLocationAudit() {
    const title = byId('queryTitle')?.textContent || '';
    const coords = byId('queryCoords')?.textContent || '';
    const accuracy = byId('queryAccuracy')?.textContent || '';
    if (!coords || coords === '--') return;
    let source = '地圖／人工設定';
    if (/GPS|定位精度|accuracy/i.test(accuracy)) source = '裝置 GPS';
    else if (/ArcGIS|OpenStreetMap|Photon|地址|可信度|驗證/i.test(accuracy + title)) source = '地址定位／多來源驗證';
    if (/拖曳/.test(accuracy)) source += '＋人工拖曳校正';
    let confidence = '需人工確認';
    if (/高可信|高信賴|精確|門牌/.test(accuracy)) confidence = '高';
    else if (/中可信|中信賴/.test(accuracy)) confidence = '中';
    else if (/低可信|低信賴|道路|巷弄/.test(accuracy)) confidence = '低';
    const audit = byId('locationAudit');
    if (audit) audit.textContent = `定位紀錄：${source}｜可信度：${confidence}｜${new Date().toLocaleString('zh-TW')}`;
  }
  ['queryTitle','queryCoords','queryAccuracy'].forEach(id => {
    const el = byId(id); if (!el) return;
    new MutationObserver(updateLocationAudit).observe(el, { childList:true, subtree:true, characterData:true });
  });

  // 4) 採樣點現場篩測欄位：僅加到原編輯視窗。
  const editorCard = document.querySelector('#sampleEditor .modal-card');
  if (editorCard && !byId('fieldScreeningBox')) {
    const box = document.createElement('section');
    box.id = 'fieldScreeningBox';
    box.innerHTML = `
      <h2>現場篩測／量測</h2>
      <div class="field-grid">
        <input id="editXrf" inputmode="decimal" placeholder="XRF讀值／摘要">
        <input id="editPid" inputmode="decimal" placeholder="PID (ppm)">
        <input id="editPh" inputmode="decimal" placeholder="pH">
        <input id="editEc" inputmode="decimal" placeholder="EC (µS/cm)">
        <input id="editOrp" inputmode="decimal" placeholder="ORP (mV)">
        <input id="editWaterLevel" inputmode="decimal" placeholder="地下水位 (m)">
      </div>
      <textarea id="editFieldObservation" rows="2" placeholder="現場觀察：顏色、異味、油膜、染色、土質等"></textarea>
      <div class="field-note">沒有量測的項目可留白，不影響原本採樣點流程。</div>`;
    const actions = editorCard.querySelector('.editor-actions');
    if (actions) actions.insertAdjacentElement('beforebegin', box); else editorCard.appendChild(box);

    if (typeof fillEditor === 'function') {
      const oldFill = fillEditor;
      fillEditor = function(marker) {
        oldFill(marker);
        const p = marker?.feature?.properties || {};
        byId('editXrf').value = p.fieldXrf || '';
        byId('editPid').value = p.fieldPid || '';
        byId('editPh').value = p.fieldPh || '';
        byId('editEc').value = p.fieldEc || '';
        byId('editOrp').value = p.fieldOrp || '';
        byId('editWaterLevel').value = p.waterLevel || '';
        byId('editFieldObservation').value = p.fieldObservation || '';
      };
    }
    if (typeof saveEditor === 'function') {
      const oldSave = saveEditor;
      saveEditor = function() {
        if (typeof editingMarker !== 'undefined' && editingMarker) {
          const p = editingMarker.feature.properties;
          p.fieldXrf = byId('editXrf').value.trim();
          p.fieldPid = byId('editPid').value.trim();
          p.fieldPh = byId('editPh').value.trim();
          p.fieldEc = byId('editEc').value.trim();
          p.fieldOrp = byId('editOrp').value.trim();
          p.waterLevel = byId('editWaterLevel').value.trim();
          p.fieldObservation = byId('editFieldObservation').value.trim();
          p.updatedAt = new Date().toISOString();
        }
        oldSave();
      };
      const saveBtn = byId('saveSampleBtn');
      if (saveBtn) saveBtn.onclick = saveEditor;
    }
  }

  // 5) 照片／影音補上採樣點座標與時間 metadata，不改媒體儲存方式。
  function enrichSampleMediaMetadata() {
    if (typeof samples === 'undefined') return;
    samples.getLayers().forEach(marker => {
      const p = marker.feature?.properties; if (!p) return;
      const ll = marker.getLatLng();
      (p.photos || []).forEach(item => {
        if (item && typeof item === 'object') {
          item.createdAt = item.createdAt || item.capturedAt || p.createdAt || new Date().toISOString();
          item.lat = item.lat ?? ll.lat; item.lng = item.lng ?? ll.lng;
          item.sampleCode = item.sampleCode || p.code;
        }
      });
      (p.media || []).forEach(item => {
        if (item && typeof item === 'object') {
          item.createdAt = item.createdAt || new Date().toISOString();
          item.lat = item.lat ?? ll.lat; item.lng = item.lng ?? ll.lng;
          item.sampleCode = item.sampleCode || p.code;
        }
      });
    });
  }
  ['samplePhotoInput','sampleVideoInput','sampleAudioInput'].forEach(id => {
    byId(id)?.addEventListener('change', () => setTimeout(enrichSampleMediaMetadata, 900));
  });
  setInterval(enrichSampleMediaMetadata, 5000);
  enrichSampleMediaMetadata();
})();
