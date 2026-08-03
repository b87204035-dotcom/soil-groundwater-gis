(() => {
  const byId = id => document.getElementById(id);
  if (typeof map === 'undefined' || typeof L === 'undefined') return;

  const css = document.createElement('style');
  css.textContent = `
    .filter-box{display:grid;gap:5px;padding:9px 10px;background:#f3f7f7;border-radius:10px;margin-top:8px}
    .filter-box label{margin:0;font-size:12px;display:flex;align-items:flex-start;gap:5px}
    .filter-title{font-size:12px;font-weight:800;margin-top:8px;color:#314247}
    .parcel-note{font-size:11px;color:#68777c;line-height:1.4;margin-top:5px}
    .site-count{font-weight:800;color:#a03e32}
  `;
  document.head.appendChild(css);

  // ── Separate section map and true cadastral parcel map ──────────────
  const oldCadastralCheck = byId('cadastralLayer');
  if (oldCadastralCheck) {
    const label = oldCadastralCheck.closest('label');
    if (label) label.lastChild.textContent = '段籍圖（地段界）';

    const parcelLabel = document.createElement('label');
    parcelLabel.innerHTML = '<input type="checkbox" id="parcelMapLayer">地籍圖（宗地界／地號）';
    label?.insertAdjacentElement('afterend', parcelLabel);
    const parcelNote = document.createElement('div');
    parcelNote.className = 'parcel-note';
    parcelNote.textContent = '地籍圖需放大至約 1:5,000～1:1,000 才會看到宗地界與地號；部分區域可能受國土測繪中心圖磚權限或涵蓋範圍限制。';
    parcelLabel.insertAdjacentElement('afterend', parcelNote);

    const parcelMap = L.tileLayer('https://wmts.nlsc.gov.tw/wmts/DMAPS/default/GoogleMapsCompatible/{z}/{y}/{x}', {
      maxZoom: 20,
      minZoom: 15,
      opacity: 0.88,
      attribution: '地籍圖 © 內政部國土測繪中心'
    });
    byId('parcelMapLayer').onchange = e => {
      if (e.target.checked) {
        parcelMap.addTo(map);
        if (map.getZoom() < 17) map.setZoom(17);
      } else map.removeLayer(parcelMap);
    };
  }

  // ── Contaminated-site filter UI ─────────────────────────────────────
  const syncButton = byId('syncOfficialSitesBtn');
  const siteTools = syncButton?.closest('.site-tools');
  if (!siteTools) return;

  const filters = document.createElement('div');
  filters.innerHTML = `
    <div class="filter-title">列管狀態</div>
    <div class="filter-box" id="siteStatusFilters">
      <label><input type="checkbox" value="active-control" checked>現行控制場址</label>
      <label><input type="checkbox" value="active-remediation" checked>現行整治場址</label>
      <label><input type="checkbox" value="released">解除列管／解除公告</label>
      <label><input type="checkbox" value="other-active" checked>其他現行列管類型</label>
    </div>
    <div class="filter-title">污染介質</div>
    <div class="filter-box" id="siteMediaFilters">
      <label><input type="checkbox" value="soil" checked>土壤污染</label>
      <label><input type="checkbox" value="groundwater" checked>地下水污染</label>
      <label><input type="checkbox" value="both" checked>土壤及地下水污染</label>
      <label><input type="checkbox" value="unknown" checked>未明確標示</label>
    </div>
    <div id="siteFilterSummary" class="parcel-note">同步後可依列管狀態與污染介質勾選顯示。</div>`;
  syncButton.parentElement.insertAdjacentElement('afterend', filters);

  let records = [];
  const lowerKeys = obj => Object.fromEntries(Object.entries(obj || {}).map(([k,v]) => [k.toLowerCase(), v]));
  const extractRows = payload => {
    if (Array.isArray(payload)) return payload;
    for (const key of ['records','data','result','items']) {
      const value = payload?.[key];
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.records)) return value.records;
    }
    return [];
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = raw => {
    const r = lowerKeys(raw);
    const lat = Number(r.wgs84_lat ?? r.lat ?? r.latitude);
    const lng = Number(r.wgs84_lng ?? r.lng ?? r.lon ?? r.longitude);
    const typeText = `${r.site_type || ''} ${r.site_use || ''}`;
    const controlText = `${r.controltype || ''}`;
    const released = Boolean(String(r.deanno_date || '').trim() || String(r.deanno_no || '').trim() || /解除|解列/.test(controlText + typeText));
    let statusGroup = 'other-active';
    if (released) statusGroup = 'released';
    else if (/整治/.test(controlText + typeText)) statusGroup = 'active-remediation';
    else if (/控制/.test(controlText + typeText)) statusGroup = 'active-control';
    const hasSoil = /土壤/.test(typeText + controlText);
    const hasGw = /地下水/.test(typeText + controlText);
    const mediaGroup = hasSoil && hasGw ? 'both' : hasSoil ? 'soil' : hasGw ? 'groundwater' : 'unknown';
    return {
      id:r.site_id||'', name:r.site_name||'污染場址', county:r.county||'', township:r.township||'',
      siteType:r.site_type||'', siteUse:r.site_use||'', pollutant:r.pollutant||'', address:r.pollutantaddress||'',
      control:r.controltype||'', annoNo:r.anno_no||'', annoDate:r.anno_date||'', deannoNo:r.deanno_no||'', deannoDate:r.deanno_date||'',
      landNo:r.landno||'', area:r.sitearea||'', lat, lng, statusGroup, mediaGroup, released
    };
  };
  const selected = selector => new Set([...document.querySelectorAll(`${selector} input:checked`)].map(x => x.value));
  const distanceKm = (a,b,c,d) => {
    const R=6371, p=Math.PI/180, dLat=(c-a)*p, dLon=(d-b)*p;
    const h=Math.sin(dLat/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  };
  const popup = s => `<b>${esc(s.name)}</b><br><b>列管：</b>${esc(s.control||s.siteType||'未載明')}<br><b>介質：</b>${esc(s.siteType||'未載明')}<br><b>地址：</b>${esc(s.address||'未載明')}<br><b>地號：</b>${esc(s.landNo||'未載明')}<hr style="border:0;border-top:1px solid #ddd"><b>污染物：</b>${esc(s.pollutant||'未載明')}<br><b>公告：</b>${esc(s.annoDate)} ${esc(s.annoNo)}${s.released?`<br><b>解除：</b>${esc(s.deannoDate)} ${esc(s.deannoNo)}`:''}`;

  function renderFilteredSites() {
    if (!records.length) return;
    const statuses = selected('#siteStatusFilters');
    const media = selected('#siteMediaFilters');
    const filtered = records.filter(s => statuses.has(s.statusGroup) && media.has(s.mediaGroup));
    sites.clearLayers();
    filtered.forEach(s => {
      const color = s.released ? '#66757a' : s.statusGroup === 'active-remediation' ? '#a32620' : s.statusGroup === 'active-control' ? '#e36d2f' : '#8f5e2e';
      L.circleMarker([s.lat,s.lng], {radius:6,color,weight:2,fillColor:color,fillOpacity:.78})
        .bindPopup(popup(s),{maxWidth:330}).addTo(sites);
    });
    const center = centerMarker ? centerMarker.getLatLng() : map.getCenter();
    const radius = Number(byId('siteRadius')?.value || 1);
    const nearby = filtered.map(s => ({...s,distance:distanceKm(center.lat,center.lng,s.lat,s.lng)})).filter(s => s.distance <= radius).sort((a,b)=>a.distance-b.distance);
    const list = byId('officialSiteList');
    if (list) {
      list.innerHTML='';
      nearby.slice(0,40).forEach(s => {
        const card=document.createElement('div'); card.className='site-card';
        card.innerHTML=`<strong>${esc(s.name)}</strong><br><span class="distance">距離 ${s.distance.toFixed(2)} 公里</span>｜${esc(s.control||s.siteType)}<br>${esc(s.address)}<br>${s.released?'已解除列管':'現行列管'}・${esc(s.siteType||'介質未載明')}`;
        card.onclick=()=>map.setView([s.lat,s.lng],18); list.appendChild(card);
      });
    }
    byId('siteFilterSummary').innerHTML = `共載入 ${records.length} 筆；目前顯示 <span class="site-count">${filtered.length}</span> 筆，查詢半徑內 ${nearby.length} 筆。`;
    if (byId('nearestSite')) byId('nearestSite').textContent = nearby.length ? `${radius} 公里內有 ${nearby.length} 處；最近 ${nearby[0].distance.toFixed(2)} 公里：${nearby[0].name}` : `${radius} 公里內未查得符合篩選條件的場址`;
  }

  document.querySelectorAll('#siteStatusFilters input,#siteMediaFilters input').forEach(x => x.onchange = renderFilteredSites);
  if (byId('siteRadius')) byId('siteRadius').addEventListener('change', renderFilteredSites);

  syncButton.onclick = async () => {
    const key = byId('moenvApiKey')?.value.trim();
    const status = byId('syncStatus');
    if (!key) { status.className='status error'; status.textContent='請先貼上環境部 API Key。'; return; }
    localStorage.setItem('moenv_api_key',key);
    syncButton.disabled=true; syncButton.textContent='同步中…'; status.className='status'; status.textContent='正在下載環境部 EMS_S_07…';
    try {
      let rows=[];
      for(let offset=0;offset<10000;offset+=1000){
        const url=new URL('https://data.moenv.gov.tw/api/v2/EMS_S_07');
        url.search=new URLSearchParams({format:'json',offset:String(offset),limit:'1000',api_key:key});
        const response=await fetch(url); if(!response.ok) throw new Error(`API ${response.status}`);
        const batch=extractRows(await response.json()); rows.push(...batch); if(batch.length<1000) break;
      }
      records=rows.map(normalize).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng)&&s.lat>20&&s.lat<27&&s.lng>117&&s.lng<123);
      status.className='status success'; status.textContent=`已同步環境部官方場址 ${records.length} 筆・${new Date().toLocaleString('zh-TW')}`;
      renderFilteredSites();
    } catch(e) {
      status.className='status error'; status.textContent=`官方場址同步失敗：${e.message}`;
    } finally { syncButton.disabled=false; syncButton.textContent='同步官方場址'; }
  };
})();
