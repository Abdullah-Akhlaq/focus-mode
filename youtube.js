(() => {
  // Guard: this file can be injected twice (page load + when focus starts)
  if (window.__focusLockLoaded) return;
  window.__focusLockLoaded = true;

  const root = document.documentElement;
  let active = false;

  const isActive = (s) => !!(s && s.active && Date.now() < s.endsAt);

  function killAutoplay() {
    const toggle = document.querySelector('.ytp-autonav-toggle-button');
    if (toggle && toggle.getAttribute('aria-checked') === 'true') toggle.click();
    // If the "up next" countdown is already showing, cancel it
    const cancel = document.querySelector('.ytp-autonav-endscreen-upnext-cancel-button');
    if (cancel) cancel.click();
  }

  function apply(a) {
    active = a;
    root.classList.toggle('fl-focus', a);
    if (a) killAutoplay();
  }

  chrome.storage.local.get('focus').then((o) => apply(isActive(o.focus)));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.focus) apply(isActive(changes.focus.newValue));
  });

  // When the video ends, stop YouTube from moving to the next video.
  // Playlists (URL has list=) are left alone so a course can continue.
  window.addEventListener('ended', (e) => {
    if (!active || !(e.target instanceof HTMLVideoElement)) return;
    if (location.search.includes('list=')) return;
    e.stopImmediatePropagation();
  }, true);

  let timer = null;
  new MutationObserver(() => {
    if (!active || timer) return;
    timer = setTimeout(() => { timer = null; killAutoplay(); }, 500);
  }).observe(root, { childList: true, subtree: true });
})();
