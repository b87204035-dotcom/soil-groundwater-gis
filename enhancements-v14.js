(() => {
  const checkbox = document.getElementById('cadastralLayer');
  if (!checkbox || typeof map === 'undefined' || typeof cadastral === 'undefined') return;

  function refreshCadastral() {
    if (checkbox.checked) {
      if (!map.hasLayer(cadastral)) cadastral.addTo(map);
      try { cadastral.bringToFront(); } catch (e) {}
      try { cadastral.redraw(); } catch (e) {}
      map.invalidateSize(false);
      setTimeout(() => {
        try { cadastral.redraw(); } catch (e) {}
      }, 180);
    } else if (map.hasLayer(cadastral)) {
      map.removeLayer(cadastral);
    }
  }

  checkbox.addEventListener('change', refreshCadastral);

  if (typeof setCenter === 'function') {
    const previousSetCenter = setCenter;
    setCenter = function(...args) {
      previousSetCenter(...args);
      requestAnimationFrame(refreshCadastral);
      setTimeout(refreshCadastral, 250);
    };
  }

  map.on('zoomend moveend', () => {
    if (checkbox.checked) refreshCadastral();
  });

  refreshCadastral();
})();
