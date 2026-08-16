(() => {
  const byId = id => document.getElementById(id);
  const sectionCheck = byId('cadastralLayer');
  const parcelCheck = byId('parcelMapLayer');

  if (sectionCheck) {
    const label = sectionCheck.closest('label');
    if (label) {
      [...label.childNodes].forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.remove();
      });
      label.append(document.createTextNode('段籍圖（地段界）'));
    }
  }

  if (parcelCheck) {
    const label = parcelCheck.closest('label');
    if (label) {
      [...label.childNodes].forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.remove();
      });
      label.append(document.createTextNode('地籍圖（宗地界／地號；需國土測繪中心授權）'));
    }

    let note = label?.nextElementSibling;
    if (!note || !note.classList.contains('parcel-note')) {
      note = document.createElement('div');
      note.className = 'parcel-note';
      label?.insertAdjacentElement('afterend', note);
    }
    note.innerHTML = '目前公開版網站沒有國土測繪中心 DMAPS 地籍圖磚授權，因此此圖層可能無法顯示宗地界與地號。段籍圖仍可正常使用；取得 NLSC 地籍圖磚／地籍 API 授權後可直接接回此選項。';

    parcelCheck.addEventListener('change', () => {
      if (!parcelCheck.checked) return;
      if (typeof map !== 'undefined' && map.getZoom() < 17) map.setZoom(17);
      const status = byId('addressStatus') || byId('sourceStatus');
      if (status) {
        const msg = document.createElement('div');
        msg.className = 'status warning';
        msg.style.marginTop = '8px';
        msg.textContent = '地籍圖（宗地界／地號）為國土測繪中心需授權服務；目前公開版尚未設定 NLSC 授權憑證。';
        if (!document.getElementById('cadastralAuthNotice')) {
          msg.id = 'cadastralAuthNotice';
          status.insertAdjacentElement('afterend', msg);
        }
      }
    });
  }
})();
