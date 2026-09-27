(() => {
  const fallbackPhoto = '092508DF-3780-43EC-8976-384F9EF65BE0.png';
  let latestRequest = 0;
  let lastAutomaticRefresh = 0;

  const catalogHead = document.querySelector('.catalog-head');
  const syncStatus = document.createElement('p');
  syncStatus.className = 'catalog-sync-status';
  syncStatus.setAttribute('role', 'status');
  syncStatus.setAttribute('aria-live', 'polite');
  catalogHead?.append(syncStatus);

  const syncStyle = document.createElement('style');
  syncStyle.textContent = '.catalog-sync-status{margin:7px 0 0!important;color:var(--muted);font-size:12px}.catalog-sync-status.error{color:#b00020}';
  document.head.append(syncStyle);

  function freshPhotoUrl(url, updatedAt) {
    const source = url || fallbackPhoto;
    try {
      const parsed = new URL(source, location.href);
      parsed.searchParams.set('fampro-photo', String(new Date(updatedAt || 0).getTime() || '1'));
      return parsed.href;
    } catch (_) {
      return source;
    }
  }

  async function syncCatalog() {
    const request = ++latestRequest;
    syncStatus.textContent = 'Actualisation du matériel…';
    syncStatus.classList.remove('error');

    const result = await client
      .from('materiel')
      .select('id,nom,categorie,quantite_totale,quantite_disponible,photo_url,unite,notes,updated_at')
      .order('nom', { ascending: true });

    if (request !== latestRequest) return;
    if (result.error) {
      console.warn('[catalogue] Synchronisation impossible', result.error.message);
      syncStatus.textContent = 'Synchronisation momentanément indisponible. Réessayez dans un instant.';
      syncStatus.classList.add('error');
      return;
    }

    catalogItems = (result.data || []).map(item => {
      const unit = item.unite === 'm²' || /gazon/i.test(item.nom) ? 'm²' : 'unité';
      const available = Number(item.quantite_disponible) || 0;
      const total = Number(item.quantite_totale) || available;
      const detail = unit === 'm²'
        ? `${available} m² disponibles`
        : `${item.categorie || 'Matériel événementiel'} · ${available > 0 ? 'Disponible' : 'Indisponible'}`;
      return [
        freshPhotoUrl(item.photo_url, item.updated_at),
        item.nom,
        detail,
        available > 0,
        item.id,
        unit,
        available,
        total,
        { category: item.categorie || 'Matériel événementiel', notes: item.notes || '' }
      ];
    });

    renderClientCatalog();
    syncStatus.textContent = `Matériel à jour · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function refreshMaterialState() {
    if (document.hidden) return;
    lastAutomaticRefresh = Date.now();
    await syncCatalog();
    const selectedDate = document.getElementById('date')?.value;
    if (selectedDate) await refreshDateAvailability(selectedDate);
  }

  loadClientCatalogFromSupabase = syncCatalog;
  window.addEventListener('pageshow', refreshMaterialState);
  window.addEventListener('focus', refreshMaterialState);
  window.addEventListener('online', refreshMaterialState);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastAutomaticRefresh > 1500) refreshMaterialState();
  });
  setInterval(() => {
    if (!document.hidden) refreshMaterialState();
  }, 15000);

  refreshMaterialState();
  setTimeout(refreshMaterialState, 800);
})();
