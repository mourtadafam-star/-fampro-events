// Client-only passwordless entry point. The existing password sign-in and recovery stay available.
(() => {
  const oldSignup = document.getElementById('signup-form');
  const signIn = document.getElementById('signin-form');
  const authArea = document.getElementById('portal-auth');
  if (!oldSignup || !signIn || !authArea || typeof client === 'undefined') return;

  const knownSections = new Set(['accueil', 'services', 'materiel', 'reserver', 'mon-espace', 'publicite']);
  const pendingKey = 'fampro-client-email-auth';
  const sendKey = 'fampro-client-email-send-times';
  const cooldownMs = 60_000;
  const sendWindowMs = 15 * 60_000;
  const maxSends = 5;
  const maxChecks = 5;
  let pending = null;
  let checks = 0;
  let inFlight = false;

  const style = document.createElement('style');
  style.textContent = '.email-auth-note{font-size:13px;line-height:1.45;color:#ffe3e6;margin:8px 0 0}.email-auth-code{border:1px solid #ebd5d8;border-radius:14px;padding:18px;margin:17px 0;background:#fff8f8}.email-auth-code[hidden],.oauth-confirm[hidden]{display:none!important}.email-auth-code h3{margin:0 0 6px}.email-auth-code p{margin:0 0 11px;color:var(--muted);font-size:14px}.email-auth-code label{display:block;font-size:13px;font-weight:800;margin:8px 0 5px}.email-auth-code input{width:100%;max-width:240px;padding:12px;border:1px solid #d8c8cb;border-radius:9px;font:inherit;font-size:18px;letter-spacing:.16em}.email-auth-code .btn{margin-top:10px}.email-auth-code button:disabled,.email-link-button:disabled{opacity:.55;cursor:wait}.email-auth-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:11px}.email-auth-actions button,.email-link-button{border:0;background:transparent;color:var(--red);font:inherit;font-size:13px;font-weight:800;cursor:pointer;padding:7px 0}.email-link-button{display:block;margin-top:7px}.oauth-signup .oauth-buttons{display:grid;gap:10px;margin-top:18px}.oauth-signup .oauth-buttons button{width:100%;min-height:48px;border:1px solid #e9d5d8;border-radius:10px;background:#fff;color:#272026;padding:12px;font:800 15px system-ui,sans-serif;cursor:pointer}.oauth-signup .oauth-buttons button:focus-visible{outline:3px solid #ffb4bb}.oauth-signup .privacy-note{margin-top:14px}.oauth-email-fallback{margin-top:12px}.oauth-email-fallback summary{cursor:pointer;color:var(--red);font-size:13px;font-weight:800;padding:8px}.oauth-email-fallback .signup-card{margin-top:8px}.oauth-confirm{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:18px;background:#18050ac7}.oauth-confirm>div{width:min(100%,420px);padding:24px;border-radius:18px;background:#fff;box-shadow:0 20px 60px #0004}.oauth-confirm h3{margin:0 0 8px}.oauth-confirm p{margin:0 0 14px;line-height:1.5;overflow-wrap:anywhere}.oauth-confirm .btn{width:100%}.oauth-confirm button[data-change-account]{display:block;margin:12px auto 0;border:0;background:none;color:var(--red);font:700 13px system-ui;cursor:pointer}@media(max-width:700px){.email-auth-code{padding:15px}.email-auth-code input,.email-auth-code .btn{max-width:none;width:100%}}';
  document.head.append(style);

  const signup = document.createElement('form');
  signup.id = 'email-signup-form';
  signup.className = 'signup-card';
  signup.innerHTML = '<h3>Créer mon compte</h3><p class="form-lead">Sans mot de passe : confirmez votre adresse e-mail.</p><label for="email-signup-name">Nom complet</label><input id="email-signup-name" required maxlength="120" autocomplete="name" placeholder="Ex. Awa Diagne"><label for="email-signup-phone">Téléphone</label><input id="email-signup-phone" required maxlength="30" inputmode="tel" autocomplete="tel" placeholder="77 123 45 67"><label for="email-signup-address">Adresse e-mail</label><input id="email-signup-address" required type="email" maxlength="254" autocomplete="email" placeholder="vous@exemple.com"><p class="email-auth-note">Gmail, Outlook, iCloud Mail et autres adresses e-mail acceptés.</p><button class="btn" type="submit">Créer mon espace client →</button><p class="privacy-note"><span>🔒</span><span>Un code ou un lien sécurisé sera envoyé à cette adresse. Aucun mot de passe n’est nécessaire.</span></p>';
  oldSignup.replaceWith(signup);

  const linkButton = document.createElement('button');
  linkButton.type = 'button';
  linkButton.className = 'email-link-button';
  linkButton.textContent = 'Me connecter par e-mail, sans mot de passe';
  signIn.querySelector('button[type="submit"]').insertAdjacentElement('afterend', linkButton);
  signIn.querySelector('p').textContent = 'Utilisez votre mot de passe habituel ou recevez un code ou un lien par e-mail.';
  authArea.querySelector('.signin-tip').textContent = 'Après validation du code ou du lien, votre espace client s’ouvre automatiquement.';

  const codeArea = document.createElement('section');
  codeArea.className = 'email-auth-code';
  codeArea.hidden = true;
  codeArea.innerHTML = '<h3>Vérifiez votre e-mail</h3><p id="email-auth-instructions"></p><form id="email-code-form"><label for="email-auth-token">Code à 6 chiffres reçu par e-mail</label><input id="email-auth-token" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"><button class="btn" type="submit">Valider le code</button></form><div class="email-auth-actions"><button id="email-auth-resend" type="button">Renvoyer le code ou le lien</button><button id="email-auth-change" type="button">Changer d’adresse e-mail</button></div><p class="message" id="email-auth-message" role="status" aria-live="polite"></p>';
  authArea.querySelector('.portal-grid').insertAdjacentElement('afterend', codeArea);
  const codeMessage = codeArea.querySelector('#email-auth-message');
  const resendButton = codeArea.querySelector('#email-auth-resend');
  const codeForm = codeArea.querySelector('#email-code-form');
  const oauthSignup = document.createElement('section');
  oauthSignup.className = 'signup-card oauth-signup';
  oauthSignup.innerHTML = '<h3>Créer mon compte ou me connecter</h3><p class="form-lead">Choisissez votre compte Google ou Apple. Aucune autre information ni mot de passe ne vous sera demandé.</p><div class="oauth-buttons"></div><p class="privacy-note"><span>🔒</span><span>Google ou Apple vérifie votre identité avant l’ouverture de votre espace client.</span></p>';
  const oauthConfirm = document.createElement('div');
  oauthConfirm.className = 'oauth-confirm';
  oauthConfirm.hidden = true;
  oauthConfirm.setAttribute('role', 'dialog');
  oauthConfirm.setAttribute('aria-modal', 'true');
  oauthConfirm.setAttribute('aria-label', 'Confirmer votre adresse');
  oauthConfirm.innerHTML = '<div><h3>Votre adresse est vérifiée</h3><p>Continuer avec <strong id="oauth-confirm-email"></strong> ?</p><button type="button" class="btn" data-confirm-account>Continuer avec cette adresse</button><button type="button" data-change-account>Choisir un autre compte</button></div>';
  document.body.append(oauthConfirm);

  const readJSON = (key, fallback) => {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? fallback; }
    catch (_) { return fallback; }
  };
  const saveJSON = (key, value) => {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  };
  const sectionFrom = value => {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      const section = decodeURIComponent(url.hash.slice(1));
      return url.origin === location.origin && knownSections.has(section) ? section : null;
    } catch (_) { return null; }
  };
  const returnSection = () => {
    const query = new URLSearchParams(location.search).get('auth_return');
    if (query && knownSections.has(query)) return query;
    return sectionFrom(history.state?.returnUrl) || sectionFrom(location.href) || 'mon-espace';
  };
  const returnUrl = section => {
    const url = new URL('/client.html', location.origin);
    url.searchParams.set('auth_return', knownSections.has(section) ? section : 'mon-espace');
    return url.href;
  };
  const oauthReturnUrl = (section, provider) => {
    const url = new URL('https://famproevents.com/client.html');
    url.searchParams.set('auth_return', knownSections.has(section) ? section : 'mon-espace');
    url.searchParams.set('auth_provider', provider);
    return url.href;
  };
  const frenchError = error => {
    const code = String(error?.code || '').toLowerCase();
    const status = Number(error?.status);
    if (status === 429 || code.includes('rate_limit') || code.includes('over_email')) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    if (code.includes('expired')) return 'Ce code ou ce lien a expiré. Demandez-en un nouveau.';
    if (code.includes('invalid') || code.includes('otp')) return 'Code incorrect ou déjà utilisé. Vérifiez le dernier e-mail reçu.';
    if (code.includes('email_not_confirmed')) return 'Confirmez d’abord votre adresse avec le dernier e-mail reçu.';
    if (code.includes('validation')) return 'Vérifiez votre adresse e-mail et réessayez.';
    return 'Impossible de terminer cette étape pour le moment. Réessayez dans quelques minutes.';
  };
  const showCodeArea = () => {
    if (!pending?.email) return;
    codeArea.hidden = false;
    codeArea.querySelector('#email-auth-instructions').textContent = `Consultez ${pending.email} (y compris les courriers indésirables). Vous pouvez saisir le code ici ou ouvrir le lien sécurisé reçu.`;
    updateResend();
  };
  const recentSends = () => readJSON(sendKey, []).filter(time => Number.isFinite(time) && Date.now() - time < sendWindowMs);
  const updateResend = () => {
    const sends = recentSends();
    const wait = Math.max(0, cooldownMs - (Date.now() - (sends.at(-1) || 0)));
    resendButton.disabled = inFlight || wait > 0 || sends.length >= maxSends;
    resendButton.textContent = sends.length >= maxSends ? 'Limite atteinte : réessayez plus tard' : wait > 0 ? `Renvoyer dans ${Math.ceil(wait / 1000)} s` : 'Renvoyer le code ou le lien';
  };
  setInterval(() => { if (!codeArea.hidden) updateResend(); }, 1000);

  async function sendEmail(email, metadata = {}) {
    const sends = recentSends();
    if (sends.length >= maxSends || Date.now() - (sends.at(-1) || 0) < cooldownMs) {
      throw { code: 'over_email_send_rate_limit', status: 429 };
    }
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: pending.createUser, emailRedirectTo: returnUrl(pending.section), data: metadata }
    });
    if (error) throw error;
    saveJSON(sendKey, [...sends, Date.now()]);
    saveJSON(pendingKey, pending);
    checks = 0;
    showCodeArea();
    codeMessage.className = 'message success';
    codeMessage.textContent = 'E-mail demandé. Utilisez le dernier code ou lien reçu.';
  }
  async function begin(email, metadata = {}, button, createUser = false) {
    if (inFlight) return;
    inFlight = true;
    button.disabled = true;
    pending = { email: email.trim().toLowerCase(), section: returnSection(), createUser, createdAt: Date.now() };
    codeMessage.className = 'message';
    codeMessage.textContent = 'Envoi en cours…';
    try { await sendEmail(pending.email, metadata); }
    catch (error) {
      showCodeArea();
      codeMessage.className = 'message error';
      codeMessage.textContent = frenchError(error);
    } finally {
      inFlight = false;
      button.disabled = false;
      updateResend();
      requestAnimationFrame(() => codeArea.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }
  signup.addEventListener('submit', event => {
    event.preventDefault();
    const email = signup.querySelector('#email-signup-address').value;
    const nom = signup.querySelector('#email-signup-name').value.trim();
    const telephone = signup.querySelector('#email-signup-phone').value.trim();
    begin(email, { nom, telephone }, event.submitter, true);
  });
  linkButton.addEventListener('click', () => {
    const email = signIn.querySelector('#signin-email');
    if (!email.reportValidity()) return;
    begin(email.value, {}, linkButton);
  });
  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!pending?.email || inFlight) return;
    if (checks >= maxChecks) {
      codeMessage.className = 'message error';
      codeMessage.textContent = 'Trop d’essais. Demandez un nouveau code après le délai indiqué.';
      return;
    }
    const token = codeForm.querySelector('#email-auth-token').value.trim();
    if (!/^[0-9]{6}$/.test(token)) return;
    inFlight = true;
    event.submitter.disabled = true;
    codeMessage.className = 'message';
    codeMessage.textContent = 'Vérification…';
    try {
      const { error } = await client.auth.verifyOtp({ email: pending.email, token, type: 'email' });
      if (error) throw error;
      codeForm.reset();
      await finishAuth();
    } catch (error) {
      checks++;
      codeMessage.className = 'message error';
      codeMessage.textContent = frenchError(error);
    } finally { inFlight = false; event.submitter.disabled = false; }
  });
  resendButton.addEventListener('click', async () => {
    if (!pending?.email || inFlight || resendButton.disabled) return;
    inFlight = true;
    updateResend();
    try { await sendEmail(pending.email); }
    catch (error) {
      codeMessage.className = 'message error';
      codeMessage.textContent = frenchError(error);
    } finally { inFlight = false; updateResend(); }
  });
  codeArea.querySelector('#email-auth-change').addEventListener('click', () => {
    pending = null;
    codeArea.hidden = true;
    codeForm.reset();
    try { sessionStorage.removeItem(pendingKey); } catch (_) {}
    signup.querySelector('#email-signup-address').focus();
  });

  let finishing = false;
  let oauthConfirmed = false;
  oauthConfirm.querySelector('[data-confirm-account]').addEventListener('click', () => {
    oauthConfirmed = true;
    oauthConfirm.hidden = true;
    finishAuth();
  });
  oauthConfirm.querySelector('[data-change-account]').addEventListener('click', async () => {
    oauthConfirm.hidden = true;
    pending = null;
    try { sessionStorage.removeItem(pendingKey); } catch (_) {}
    await client.auth.signOut();
    portalHome.hidden = true;
    authArea.hidden = false;
  });
  async function finishAuth() {
    if (finishing) return;
    finishing = true;
    const { data: { session } } = await client.auth.getSession();
    if (!session) { finishing = false; return; }
    const hasReturnQuery = new URLSearchParams(location.search).has('auth_return');
    if (!pending && !hasReturnQuery) { finishing = false; return; }
    const provider = pending?.provider || new URLSearchParams(location.search).get('auth_provider');
    if (['google', 'apple'].includes(provider) && !oauthConfirmed && session.user?.email) {
      oauthConfirm.querySelector('#oauth-confirm-email').textContent = session.user.email;
      oauthConfirm.hidden = false;
      oauthConfirm.querySelector('[data-confirm-account]').focus();
      finishing = false;
      return;
    }
    const section = hasReturnQuery ? returnSection() : pending.section;
    codeArea.hidden = true;
    pending = null;
    try { sessionStorage.removeItem(pendingKey); } catch (_) {}
    const url = new URL(location.href);
    url.searchParams.delete('auth_return');
    url.searchParams.delete('auth_provider');
    url.hash = '#' + (knownSections.has(section) ? section : 'mon-espace');
    history.replaceState({ ...(history.state || {}), famproNav: true }, '', url.pathname + url.search + url.hash);
    await loadPortal();
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }));
    finishing = false;
  }
  pending = readJSON(pendingKey, null);
  const callbackQuery = new URLSearchParams(location.search);
  if ((pending?.provider || callbackQuery.has('auth_provider')) && callbackQuery.has('error')) {
    pending = null;
    try { sessionStorage.removeItem(pendingKey); } catch (_) {}
    authArea.querySelector('#portal-message').textContent = 'Connexion annulée ou refusée. Choisissez de nouveau votre compte.';
    authArea.querySelector('#portal-message').className = 'message error';
    const cleanUrl = new URL(location.href);
    for (const key of ['error', 'error_code', 'error_description', 'auth_return', 'auth_provider']) cleanUrl.searchParams.delete(key);
    history.replaceState(history.state, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  }
  if (pending && Date.now() - pending.createdAt < 60 * 60_000) {
    if (pending.email) showCodeArea();
  } else pending = null;
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_IN') setTimeout(finishAuth, 0);
  });
  client.auth.getSession().then(finishAuth).catch(() => {});

  // Only expose working providers. Keep email signup available until one is configured.
  fetch(`${client.supabaseUrl}/auth/v1/settings`, { headers: { apikey: client.supabaseKey } })
    .then(response => response.ok ? response.json() : null)
    .then(settings => {
      const providers = ['google', 'apple'].filter(provider => settings?.external?.[provider] === true);
      if (!providers.length) return;
      const methods = document.createElement('div');
      methods.id = 'client-signup-methods';
      const fallback = document.createElement('details');
      fallback.className = 'oauth-email-fallback';
      fallback.innerHTML = '<summary>Utiliser plutôt une adresse e-mail</summary>';
      signup.replaceWith(methods);
      fallback.append(signup);
      methods.append(oauthSignup, fallback);
      for (const provider of providers) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `Continuer avec ${provider === 'google' ? 'Google' : 'Apple'}`;
        button.addEventListener('click', async () => {
          button.disabled = true;
          oauthConfirmed = false;
          const section = returnSection();
          pending = { provider, section, createdAt: Date.now() };
          saveJSON(pendingKey, pending);
          try {
            const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: oauthReturnUrl(section, provider) } });
            if (error) throw error;
          } catch (error) {
            pending = null;
            try { sessionStorage.removeItem(pendingKey); } catch (_) {}
            authArea.querySelector('#portal-message').textContent = frenchError(error);
            authArea.querySelector('#portal-message').className = 'message error';
            button.disabled = false;
          }
        });
        oauthSignup.querySelector('.oauth-buttons').append(button);
      }
    }).catch(() => {});
})();
