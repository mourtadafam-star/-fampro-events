(() => {
  function freshPhotoUrl(url, updatedAt) {
    if (!url) return '';
    try {
      const parsed = new URL(url, location.href);
      parsed.searchParams.set('fampro-photo', String(new Date(updatedAt || 0).getTime() || '1'));
      return parsed.href;
    } catch (_) {
      return url;
    }
  }

  function refreshMaterialPhotos() {
    const images = Array.from(document.querySelectorAll('#materialList .material-photo'));
    images.forEach((image, index) => {
      const material = data.material[index];
      if (material?.photo_url) image.src = freshPhotoUrl(material.photo_url, material.updated_at);
    });
  }

  const renderMaterialWithFreshPhotos = renderMaterial;
  renderMaterial = function () {
    renderMaterialWithFreshPhotos();
    refreshMaterialPhotos();
  };

  let lastRefresh = 0;
  let refreshRunning = false;
  async function refreshWhenActive() {
    if (document.hidden || refreshRunning || Date.now() - lastRefresh < 1500) return;
    refreshRunning = true;
    lastRefresh = Date.now();
    try {
      await loadData();
    } finally {
      refreshRunning = false;
    }
  }

  window.addEventListener('pageshow', refreshWhenActive);
  window.addEventListener('focus', refreshWhenActive);
  window.addEventListener('online', refreshWhenActive);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshWhenActive();
  });
  setInterval(refreshWhenActive, 15000);
})();
