(() => {
  if (!("serviceWorker" in navigator)) return;

  const controlledAtLoad = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtLoad || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(registration => registration.update())
    .catch(error => console.warn("Mise à jour PWA indisponible", error));
})();
