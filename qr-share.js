(() => {
  const clientUrl = new URL('client.html', location.href).href;
  const qrUrl = new URL('fampro-espace-client-qr.png', location.href).href;
  const message = 'Découvrez FAMpro Évents et réservez votre matériel.';
  let qrFile = null;

  // Prepare the image before a tap: iOS requires navigator.share() to run
  // directly in the user gesture, without an awaited fetch first.
  fetch(qrUrl)
    .then(response => {
      if (!response.ok) throw new Error('QR indisponible');
      return response.blob();
    })
    .then(blob => {
      qrFile = new File([blob], 'FAMpro-Events-code-QR.png', { type: 'image/png' });
    })
    .catch(error => console.warn('[FAMpro QR] Préchargement impossible', error));

  const style = document.createElement('style');
  style.textContent = '.qr-share-dialog{width:min(92vw,420px);max-height:90vh;border:0;border-radius:18px;padding:22px;background:#fff;color:#242124;box-shadow:0 20px 70px #24000655}.qr-share-dialog::backdrop{background:#1d000a99}.qr-share-dialog h2{margin:0 0 7px;font-size:22px}.qr-share-dialog p{margin:0 0 15px;color:#5f5f66}.qr-share-dialog img{display:block;width:min(100%,260px);height:auto;margin:0 auto 15px}.qr-share-dialog input{width:100%;padding:11px;border:1px solid #ddd;border-radius:9px;font:inherit}.qr-share-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.qr-share-actions button,.qr-share-actions a{display:grid;place-items:center;min-height:44px;padding:10px;border:0;border-radius:9px;background:#a60713;color:#fff;font:inherit;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}.qr-share-actions .secondary{background:#f3e7e8;color:#720510}.qr-share-dialog small{display:block;margin-top:12px;color:#666;line-height:1.4}';
  document.head.append(style);

  const dialog = document.createElement('dialog');
  dialog.className = 'qr-share-dialog';
  dialog.innerHTML = '<h2>Partager l’espace client</h2><p>Envoyez le code QR ou le lien à vos clients.</p><img alt="Code QR du site client FAMpro Évents"><input aria-label="Lien du site client" readonly><div class="qr-share-actions"><button type="button" data-copy>Copier le lien</button><button type="button" data-share-link>Partager le lien</button><a data-open-qr class="secondary" target="_blank" rel="noopener">Voir le code QR</a><button type="button" data-close class="secondary">Fermer</button></div><small>Sur iPhone, ouvrez le code QR puis maintenez le doigt sur l’image pour l’enregistrer.</small>';
  dialog.querySelector('img').src = qrUrl;
  dialog.querySelector('input').value = clientUrl;
  dialog.querySelector('[data-open-qr]').href = qrUrl;
  document.body.append(dialog);

  function showQrOptions() {
    if (!dialog.open) dialog.showModal();
  }

  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('[data-copy]').onclick = async event => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(clientUrl);
      button.textContent = 'Lien copié ✓';
    } catch (_) {
      const input = dialog.querySelector('input');
      input.focus();
      input.select();
      button.textContent = 'Sélectionnez le lien';
    }
  };
  dialog.querySelector('[data-share-link]').onclick = () => {
    if (!navigator.share) return showQrOptions();
    navigator.share({ title: 'Espace client FAMpro Évents', text: message, url: clientUrl })
      .catch(error => {
        if (error.name !== 'AbortError') console.warn('[FAMpro QR] Partage du lien indisponible', error);
      });
  };

  shareCustomerQr = function () {
    if (!navigator.share || !qrFile || !navigator.canShare?.({ files: [qrFile] })) {
      showQrOptions();
      return;
    }
    navigator.share({ title: 'Espace client FAMpro Évents', text: message + ' ' + clientUrl, files: [qrFile] })
      .catch(error => {
        if (error.name !== 'AbortError') {
          console.warn('[FAMpro QR] Partage de l’image indisponible', error);
          showQrOptions();
        }
      });
  };

  // These buttons stored the previous function when the main page initialized.
  qrShareCard.onclick = shareCustomerQr;
  qrShareMenuButton.onclick = shareCustomerQr;
})();
