(() => {
  const byId = id => document.getElementById(id);
  const countyOld = byId('county');
  const townOld = byId('district');
  const sectionOld = byId('section');
  const parcelNo = byId('parcelNo');
  const parcelBtn = byId('parcelBtn');
  if (!countyOld || !townOld || !sectionOld || !parcelNo || !parcelBtn) return;

  const css = document.createElement('style');
  css.textContent = `
    .parcel-select-note{margin-top:7px;padding:8px 10px;border-radius:9px;background:#f3f7f7;color:#63777a;font-size:11px;line-height:1.45}
    .parcel-select-loading{opacity:.65}
  `;
  document.head.appendChild(css);

  const counties = [
    ['A','臺北市'],['F','新北市'],['H','桃園市'],['O','新竹市'],['J','新竹縣'],['K','苗栗縣'],
    ['B','臺中市'],['N','彰化縣'],['M','南投縣'],['P','雲林縣'],['I','嘉義市'],['Q','嘉義縣'],
    ['D','臺南市'],['E','高雄市'],['T','屏東縣'],['G','宜蘭縣'],['U','花蓮縣'],['V','臺東縣'],
    ['C','基隆市'],['X','澎湖縣'],['W','金門縣'],['Z','連江縣']
  ];

  function makeSelect(id, placeholder) {
    const select = document.createElement('select');
    select.id = id;
    select.innerHTML = `<option value="">${placeholder}</option>`;
    return select;
  }

  const county = makeSelect('countySelect','請選擇縣市');
  const town = makeSelect('districtSelect','請先選擇縣市');
  const section = makeSelect('sectionSelect','請先選擇鄉鎮市區');
  countyOld.replaceWith(county);
  townOld.replaceWith(town);
  sectionOld.replaceWith(section);

  counties.forEach(([code,name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    option.dataset.name = name;
    county.appendChild(option);
  });

  const note = document.createElement('div');
  note.className = 'parcel-select-note';
  note.textContent = '縣市、鄉鎮市區及地段資料由內政部國土測繪中心地政代碼服務即時載入。地段選項會隨鄉鎮市區連動更新。';
  parcelBtn.insertAdjacentElement('afterend', note);

  function textOf(node, names) {
    for (const name of names) {
      const found = node.querySelector(name);
      if (found?.textContent?.trim()) return found.textContent.trim();
    }
    return '';
  }

  async function fetchXml(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`服務回應 ${response.status}`);
    const xml = new DOMParser().parseFromString(await response.text(),'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('資料格式錯誤');
    return xml;
  }

  function setLoading(select, text) {
    select.disabled = true;
    select.classList.add('parcel-select-loading');
    select.innerHTML = `<option value="">${text}</option>`;
  }

  function finishLoading(select, placeholder) {
    select.disabled = false;
    select.classList.remove('parcel-select-loading');
    if (!select.options.length) select.innerHTML = `<option value="">${placeholder}</option>`;
  }

  async function loadTowns() {
    const countyCode = county.value;
    section.innerHTML = '<option value="">請先選擇鄉鎮市區</option>';
    section.disabled = true;
    if (!countyCode) {
      town.innerHTML = '<option value="">請先選擇縣市</option>';
      town.disabled = true;
      return;
    }
    setLoading(town,'載入鄉鎮市區中…');
    try {
      const xml = await fetchXml(`https://api.nlsc.gov.tw/other/ListTown/${encodeURIComponent(countyCode)}`);
      const rows = [...xml.querySelectorAll('town, row, item')];
      town.innerHTML = '<option value="">請選擇鄉鎮市區</option>';
      rows.forEach(row => {
        const code = textOf(row,['towncode','towncode01','code']);
        const name = textOf(row,['townname','name']);
        if (!code || !name) return;
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        option.dataset.name = name;
        town.appendChild(option);
      });
      if (town.options.length === 1) throw new Error('查無鄉鎮市區');
      finishLoading(town,'請選擇鄉鎮市區');
    } catch (error) {
      town.innerHTML = `<option value="">鄉鎮市區載入失敗</option>`;
      town.disabled = false;
      note.textContent = `鄉鎮市區載入失敗：${error.message}。請稍後重試。`;
    }
  }

  async function loadSections() {
    const countyCode = county.value;
    const townCode = town.value;
    if (!countyCode || !townCode) {
      section.innerHTML = '<option value="">請先選擇鄉鎮市區</option>';
      section.disabled = true;
      return;
    }
    setLoading(section,'載入地段中…');
    try {
      const xml = await fetchXml(`https://api.nlsc.gov.tw/other/ListLandSection/${encodeURIComponent(countyCode)}/${encodeURIComponent(townCode)}`);
      const rows = [...xml.querySelectorAll('sect, landsection, row, item')];
      section.innerHTML = '<option value="">請選擇地段</option>';
      rows.forEach(row => {
        const code = textOf(row,['sectcode','sectioncode','code']);
        const name = textOf(row,['sectstr','sectname','sectionname','name']);
        const office = textOf(row,['office','officecode']);
        if (!code || !name) return;
        const option = document.createElement('option');
        option.value = code;
        option.textContent = `${name}${office ? `（${office}）` : ''}`;
        option.dataset.name = name;
        section.appendChild(option);
      });
      if (section.options.length === 1) throw new Error('查無地段');
      finishLoading(section,'請選擇地段');
      note.textContent = `已載入 ${section.options.length - 1} 個地段。`;
    } catch (error) {
      section.innerHTML = '<option value="">地段載入失敗</option>';
      section.disabled = false;
      note.textContent = `地段載入失敗：${error.message}。請稍後重試。`;
    }
  }

  county.onchange = loadTowns;
  town.onchange = loadSections;
  town.disabled = true;
  section.disabled = true;

  parcelBtn.onclick = () => {
    const countyName = county.selectedOptions[0]?.dataset.name || '';
    const townName = town.selectedOptions[0]?.dataset.name || '';
    const sectionName = section.selectedOptions[0]?.dataset.name || '';
    const number = parcelNo.value.trim();
    if (!countyName || !townName || !sectionName || !number) {
      note.textContent = '請依序選擇縣市、鄉鎮市區、地段，並輸入地號。';
      note.style.background = '#ffe7e2';
      return;
    }
    note.style.background = '#e7f6ef';
    const title = `${countyName}${townName}${sectionName}${number}地號`;
    byId('queryTitle').textContent = title;
    byId('queryCoords').textContent = `地政代碼：${county.value}/${town.value}/${section.value}；等待宗地定位服務定位`;
    note.textContent = `已建立地號查詢：${title}`;
  };
})();