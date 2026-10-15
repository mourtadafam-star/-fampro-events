// Double authentification (code à 6 chiffres d’une application comme Google Authenticator) pour l’administration.
// - login.html : demande le code après le mot de passe quand le compte a activé la double authentification.
// - index.html : renvoie vers la connexion si la session n’a pas été confirmée par le code.
//   La carte « Double authentification » n’est plus affichée dans Paramètres (décision du 15/10) ;
//   carteParametres reste disponible si elle doit être réactivée.
// Aucune donnée n’est insérée via innerHTML : tout est créé avec textContent.
(() => {
  'use strict';

  async function assurance(client) {
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  }

  // true si le compte a une double authentification active mais que la session ne l’a pas encore confirmée.
  async function codeRequis(client) {
    const niveau = await assurance(client);
    return niveau.nextLevel === 'aal2' && niveau.currentLevel !== 'aal2';
  }

  async function facteursActifs(client) {
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw error;
    return (data?.totp || []).filter(f => f.status === 'verified');
  }

  async function verifierCode(client, code) {
    const propre = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(propre)) throw new Error('Entrez le code à 6 chiffres affiché dans votre application.');
    const [facteur] = await facteursActifs(client);
    if (!facteur) throw new Error('Aucune double authentification active sur ce compte.');
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: facteur.id, code: propre });
    if (error) throw new Error('Code incorrect ou expiré. Réessayez avec le code actuel.');
  }

  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // Carte « Double authentification » dans Paramètres (administration).
  async function carteParametres(client, conteneur) {
    const carte = el('div', undefined, { class: 'card', id: 'mfa-card' });
    const titre = el('div', 'Double authentification', { class: 'name' });
    const etat = el('div', 'Vérification…', { class: 'meta' });
    const zone = el('div');
    carte.append(titre, etat, zone);
    conteneur.querySelector('#mfa-card')?.remove();
    const deconnexion = [...conteneur.children].find(x => x.matches?.('button.btn.full'));
    conteneur.insertBefore(carte, deconnexion || null);

    async function afficher() {
      zone.replaceChildren();
      let actifs;
      try { actifs = await facteursActifs(client); } catch (e) { etat.textContent = 'Impossible de vérifier : ' + (e.message || e); return; }
      if (actifs.length) {
        etat.textContent = '✅ Activée : un code de votre application vous est demandé à chaque connexion.';
        return;
      }
      etat.textContent = 'Non activée. Protégez l’administration avec un code à 6 chiffres en plus du mot de passe (application Google Authenticator, Microsoft Authenticator ou similaire).';
      const bouton = el('button', 'Activer la double authentification', { class: 'btn full', type: 'button', style: 'margin-top:12px' });
      bouton.onclick = demarrer;
      zone.append(bouton);
    }

    async function demarrer() {
      zone.replaceChildren(el('p', 'Préparation…', { class: 'small' }));
      try {
        // Nettoie une tentative d’activation non terminée.
        const { data: liste } = await client.auth.mfa.listFactors();
        for (const f of (liste?.all || []).filter(f => f.factor_type === 'totp' && f.status !== 'verified')) await client.auth.mfa.unenroll({ factorId: f.id });
        const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'FAMpro Évents ' + new Date().toISOString().slice(0, 10) });
        if (error) throw error;
        const qr = el('img', undefined, { alt: 'QR code à scanner avec votre application d’authentification', width: '200', height: '200', style: 'display:block;margin:12px auto;background:#fff;padding:8px;border-radius:12px' });
        qr.src = data.totp.qr_code;
        const secret = el('code', data.totp.secret, { style: 'word-break:break-all;user-select:all' });
        const code = el('input', undefined, { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: 'Code à 6 chiffres', 'aria-label': 'Code à 6 chiffres' });
        const valider = el('button', 'Confirmer et activer', { class: 'btn full', type: 'button', style: 'margin-top:10px' });
        const msg = el('p', '', { class: 'small', role: 'status', 'aria-live': 'polite' });
        const cle = el('p', 'Impossible de scanner ? Saisissez cette clé dans l’application : ', { class: 'small' });
        cle.append(secret);
        valider.onclick = async () => {
          valider.disabled = true; msg.textContent = 'Vérification…';
          try {
            const propre = code.value.replace(/\s/g, '');
            if (!/^\d{6}$/.test(propre)) throw new Error('Entrez le code à 6 chiffres affiché dans votre application.');
            const { error: e } = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: propre });
            if (e) throw new Error('Code incorrect ou expiré. Réessayez avec le code actuel.');
            await afficher();
          } catch (e) { msg.textContent = e.message || String(e); valider.disabled = false; }
        };
        zone.replaceChildren(
          el('p', '1. Ouvrez votre application d’authentification et scannez ce QR code.', { class: 'small', style: 'margin-top:12px' }),
          qr, cle,
          el('p', '2. Entrez le code à 6 chiffres affiché pour « FAMpro Évents ».', { class: 'small' }),
          code, valider, msg
        );
      } catch (e) {
        zone.replaceChildren(el('p', 'Activation impossible : ' + (e.message || e), { class: 'small' }));
      }
    }

    await afficher();
  }

  window.FamproMfa = Object.freeze({ codeRequis, verifierCode, carteParametres });

  // Administration : garde de session uniquement.
  if (typeof supabaseClient !== 'undefined' && document.getElementById('settings') !== null) {
    (async () => {
      try {
        if (await codeRequis(supabaseClient)) { location.replace('login.html?code=1'); return; }
      } catch (_) { /* session absente : les gardes existantes renvoient déjà vers login.html */ }
    })();
  }
})();
