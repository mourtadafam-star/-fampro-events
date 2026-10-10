// Navigation shared by the public client pages only.
(() => {
  const page = location.pathname.split('/').pop() || 'client.html';
  const isHome = page === 'client.html';
  const isConfirmation = page === 'confirmation-client.html';
  const fallback = isConfirmation ? 'client.html#mon-espace' : 'client.html#services';
  const servicePages = new Set(['location-tentes.html', 'location-mobilier.html', 'decoration-evenementielle.html']);
  const pageIsPublic = isHome || isConfirmation || servicePages.has(page);
  if (!pageIsPublic) return;
  if (isHome) document.querySelector('.services')?.setAttribute('id', 'services');

  const storage = (key, value) => {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      sessionStorage.setItem(key, value);
    } catch (_) { return null; }
  };
  const samePublicOrigin = value => {
    if (!value) return false;
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin &&
        (url.pathname.endsWith('/client.html') || url.pathname.endsWith('/confirmation-client.html') ||
          [...servicePages].some(name => url.pathname.endsWith('/' + name)));
    } catch (_) { return false; }
  };
  const referrerIsPublic = samePublicOrigin(document.referrer) && new URL(document.referrer).pathname !== location.pathname;
  if (!history.state?.famproNav) {
    history.replaceState({ ...(history.state || {}), famproNav: true,
      returnUrl: referrerIsPublic ? document.referrer : null }, '', location.href);
  }

  const style = document.createElement('style');
  style.textContent = '.client-context-back{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:42px;padding:9px 13px;border:1px solid #ffffff91;border-radius:11px;background:#7c0611;color:#fff;font:700 14px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px #3c030824}.client-context-back:focus-visible{outline:3px solid #ffb4bb;outline-offset:3px}.client-context-back[hidden]{display:none!important}.client-context-back.is-floating{position:fixed;top:calc(env(safe-area-inset-top) + 12px);left:calc(env(safe-area-inset-left) + 12px);z-index:30}#services,#materiel,#reserver,#mon-espace,#publicite{scroll-margin-top:70px}@media(max-width:700px){.client-context-back{min-height:44px;font-size:13px}.client-context-back.is-floating{top:calc(env(safe-area-inset-top) + 8px);left:calc(env(safe-area-inset-left) + 8px)}}';
  document.head.append(style);
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'client-context-back' + (isHome ? ' is-floating' : '');
  back.textContent = '← Retour';
  back.setAttribute('aria-label', 'Revenir à la rubrique précédente');
  if (isHome) document.body.append(back);
  else (document.querySelector('header') || document.querySelector('main') || document.body).prepend(back);

  const showBack = () => {
    back.hidden = isHome && (!location.hash || location.hash === '#accueil');
  };
  const scrollToCurrent = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
    else if (!id) window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const fallbackForHome = () => {
    if (location.hash && location.hash !== '#accueil') {
      history.replaceState({ famproNav: true, returnUrl: null }, '', '#accueil');
      scrollToCurrent();
      showBack();
    }
  };
  const openPanel = () => document.querySelector('.recovery-panel:not([hidden])');
  const closePanel = panel => {
    if (!panel) return;
    panel.hidden = true;
    if (panel.querySelector('#reset-password')) document.getElementById('portal-auth').hidden = false;
  };
  const goBack = () => {
    if (isHome && openPanel()) {
      closePanel(openPanel());
      return;
    }
    const openViewer = document.querySelector('.material-photo-viewer[open]');
    if (isHome && openViewer) {
      window.famproClientNavigation.closeModal(openViewer);
      return;
    }
    if (history.state?.returnUrl && samePublicOrigin(history.state.returnUrl) && history.length > 1) {
      history.back();
      return;
    }
    if (!isHome && referrerIsPublic && history.length > 1) {
      history.back();
      return;
    }
    if (isHome) fallbackForHome();
    else location.replace(fallback);
  };
  back.addEventListener('click', goBack);
  showBack();

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin || !samePublicOrigin(destination.href)) return;
    if (isHome && destination.pathname === location.pathname && destination.hash && destination.hash !== location.hash) {
      const target = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
      if (!target) return;
      event.preventDefault();
      history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '', location.href);
      history.pushState({ famproNav: true, returnUrl: location.href }, '', destination.href);
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      showBack();
      return;
    }
    storage('fampro-client-scroll:' + location.pathname + location.hash, String(window.scrollY));
  });
  if (isHome) document.addEventListener('click', event => {
    const add = event.target.closest('[data-catalog-item]');
    if (!add || add.disabled || location.hash === '#reserver') return;
    history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '', location.href);
    history.pushState({ famproNav: true, returnUrl: location.href }, '', '#reserver');
    showBack();
  }, true);

  window.addEventListener('popstate', event => {
    if (isHome) document.querySelectorAll('.recovery-panel').forEach(panel => {
      const panelId = panel.querySelector('#reset-password') ? 'password-reset' : 'recovery-request';
      if (event.state?.famproPanel === panelId) panel.hidden = false;
      else if (!panel.hidden) {
        panel.hidden = true;
        if (panelId === 'password-reset') document.getElementById('portal-auth').hidden = false;
      }
    });
    const viewer = document.querySelector('.material-photo-viewer');
    if (viewer?.open && !event.state?.famproModal) viewer.close();
    else if (viewer && !viewer.open && event.state?.famproModal && typeof window.openClientMaterialPhoto === 'function') {
      window.openClientMaterialPhoto(event.state.photoIndex, true);
    }
    showBack();
    if (isHome && !event.state?.famproModal) requestAnimationFrame(() => {
      if (Number.isFinite(event.state?.scrollY)) window.scrollTo({ top: event.state.scrollY, behavior: 'instant' });
      else scrollToCurrent();
    });
  });
  window.addEventListener('hashchange', showBack);
  window.addEventListener('pageshow', event => {
    if (!isHome) return;
    showBack();
    if (event.persisted) return;
    if (performance.getEntriesByType('navigation')[0]?.type === 'back_forward') {
      const saved = Number(storage('fampro-client-scroll:' + location.pathname + location.hash));
      if (Number.isFinite(saved) && saved >= 0) setTimeout(() => window.scrollTo(0, saved), 50);
    } else if (location.hash) setTimeout(scrollToCurrent, 0);
  });

  if (isHome) {
    document.querySelectorAll('.recovery-panel').forEach(panel => {
      const panelId = panel.querySelector('#reset-password') ? 'password-reset' : 'recovery-request';
      const panelBack = document.createElement('button');
      panelBack.type = 'button';
      panelBack.className = 'client-context-back';
      panelBack.textContent = '← Retour';
      panelBack.style.marginBottom = '12px';
      panel.prepend(panelBack);
      panelBack.addEventListener('click', () => closePanel(panel));
      new MutationObserver(() => {
        if (!panel.hidden && history.state?.famproPanel !== panelId) {
          history.pushState({ famproNav: true, famproPanel: panelId, returnUrl: location.href }, '', location.href);
        } else if (panel.hidden && history.state?.famproPanel === panelId) history.back();
      }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    });
    // The booking form already keeps its own draft. Preserve only the catalogue view here.
    const search = document.getElementById('catalog-search');
    const categoryButtons = document.querySelectorAll('[data-category]');
    if (search && categoryButtons.length) {
      const savedSearch = storage('fampro-client-catalog-search');
      const savedCategory = storage('fampro-client-catalog-category');
      if (savedSearch !== null) search.value = savedSearch;
      const category = [...categoryButtons].find(button => button.dataset.category === savedCategory);
      if (category) category.click();
      if (typeof window.renderClientCatalog === 'function') window.renderClientCatalog();
      const refreshPhotoLinks = () => queueMicrotask(() => window.renderClientCatalog?.());
      search.addEventListener('input', refreshPhotoLinks);
      search.addEventListener('input', () => storage('fampro-client-catalog-search', search.value));
      categoryButtons.forEach(button => button.addEventListener('click', () => {
        storage('fampro-client-catalog-category', button.dataset.category);
        refreshPhotoLinks();
      }));
    }
  }

  window.famproClientNavigation = {
    modalOpened(dialog) {
      if (dialog?.open && !history.state?.famproModal) {
        history.pushState({ famproNav: true, famproModal: true,
          photoIndex: dialog.dataset.photoIndex, returnUrl: location.href }, '', location.href);
      }
    },
    closeModal(dialog) {
      if (!dialog?.open) return;
      if (history.state?.famproModal) history.back();
      else dialog.close();
    }
  };

  if (isHome) {
    const viewer = document.querySelector('.material-photo-viewer');
    if (viewer && typeof window.openClientMaterialPhoto === 'function') {
      const originalOpen = window.openClientMaterialPhoto;
      window.openClientMaterialPhoto = function (index, fromHistory = false) {
        originalOpen(index);
        if (!fromHistory) window.famproClientNavigation.modalOpened(viewer);
      };
      const modalStyle = document.createElement('style');
      modalStyle.textContent = '.material-photo-viewer .client-photo-nav{position:absolute;top:10px;left:10px;right:10px;display:flex;justify-content:space-between;z-index:5;pointer-events:none}.material-photo-viewer .client-photo-nav button{pointer-events:auto;min-height:44px;border:1px solid #ffffff88;border-radius:10px;background:#3c0308df;color:#fff;padding:8px 12px;font:800 14px system-ui,sans-serif;cursor:pointer}.material-photo-viewer .client-photo-nav [data-photo-close]{min-width:44px;font-size:24px;line-height:1}.material-photo-viewer .client-photo-nav button:focus-visible{outline:3px solid #ffb4bb;outline-offset:2px}.material-photo-viewer .material-photo-zoom{top:64px}';
      document.head.append(modalStyle);
      const nav = document.createElement('div');
      nav.className = 'client-photo-nav';
      nav.innerHTML = '<button type="button" data-photo-back>← Retour</button><button type="button" data-photo-close aria-label="Fermer la photo">×</button>';
      viewer.prepend(nav);
      nav.addEventListener('click', event => {
        if (event.target.closest('button')) window.famproClientNavigation.closeModal(viewer);
      });
      viewer.querySelector('[data-viewer-close]').textContent = 'Retour au catalogue';
      viewer.addEventListener('close', () => {
        if (history.state?.famproModal) history.back();
      });
    }
  }
})();
