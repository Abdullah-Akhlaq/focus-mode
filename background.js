// Focus Lock - background service worker
const KEY = 'focus';
const LAST = 'focusLastUrl';
const COOLDOWN_MS = 2 * 60 * 1000; // wait before the quit challenge appears
const CHALLENGE_WORDS = 40;        // words you must type exactly to quit early
const TOAST_TEXT = "Focus mode is on. You can't open another tab.";

const WORDS = ('river stone window garden pencil market silver thunder paper orange bridge candle forest ' +
  'mirror anchor planet violin saddle ladder pocket button marble engine harbor lantern meadow copper ' +
  'blanket island kettle rocket shadow winter summer castle desert feather ribbon temple whistle yellow ' +
  'jungle pillow carpet spider tunnel coffee dragon fabric hammer magnet needle parrot quartz rabbit ' +
  'sunset tiger umbrella velvet walnut zipper').split(' ');

let respawning = false;

async function getState() {
  const o = await chrome.storage.local.get(KEY);
  const s = o[KEY];
  if (!s || !s.active) return null;
  if (Date.now() >= s.endsAt) { await endFocus(); return null; }
  return s;
}

async function endFocus() {
  await chrome.storage.local.remove([KEY, LAST]);
  await chrome.alarms.clear('focus-end');
  await chrome.action.setBadgeText({ text: '' });
}

async function startFocus(minutes) {
  const m = Math.min(480, Math.max(1, Number(minutes) || 60));
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { ok: false };
  const endsAt = Date.now() + m * 60000;
  await chrome.storage.local.set({
    [KEY]: { active: true, tabId: tab.id, windowId: tab.windowId, endsAt },
    [LAST]: tab.url || ''
  });
  await chrome.alarms.create('focus-end', { when: endsAt });
  // A YouTube tab that was already open has no content script yet: inject it now.
  if (/^https?:\/\/([^/]*\.)?youtube\.com\//.test(tab.url || '')) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['youtube.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['youtube.js'] });
    } catch (e) {}
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({ text: 'ON' });
  return { ok: true };
}

async function focusAllowed(s) {
  try { await chrome.windows.update(s.windowId, { focused: true }); } catch (e) {}
  try { await chrome.tabs.update(s.tabId, { active: true }); } catch (e) {}
}

async function toast(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [TOAST_TEXT],
      func: (text) => {
        const old = document.getElementById('focus-lock-toast');
        if (old) old.remove();
        const d = document.createElement('div');
        d.id = 'focus-lock-toast';
        d.textContent = text;
        d.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
          'z-index:2147483647;background:#d93025;color:#fff;padding:14px 22px;border-radius:10px;' +
          'font:600 16px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);';
        document.documentElement.appendChild(d);
        setTimeout(() => d.remove(), 4000);
      }
    });
  } catch (e) {}
}

async function block(s) {
  await focusAllowed(s);
  toast(s.tabId);
}

// A new tab (or window) was opened: close it and go back.
chrome.tabs.onCreated.addListener(async (tab) => {
  const s = await getState();
  if (!s) return;
  if (respawning) {
    respawning = false;
    s.tabId = tab.id;
    s.windowId = tab.windowId;
    await chrome.storage.local.set({ [KEY]: s });
    return;
  }
  try { await chrome.tabs.remove(tab.id); } catch (e) {}
  await block(s);
});

// Switching to an already-open tab (click, Ctrl+Tab, Ctrl+1..9, tab search).
async function enforce() {
  const s = await getState();
  if (!s || respawning) return;
  const tabs = await chrome.tabs.query({ active: true, windowId: s.windowId });
  if (tabs[0] && tabs[0].id !== s.tabId) await block(s);
}

chrome.tabs.onActivated.addListener(async (info) => {
  const s = await getState();
  if (!s || respawning || info.tabId === s.tabId) return;
  await block(s);
  setTimeout(enforce, 150); // second check in case the first switch lost a race
});

chrome.tabs.onHighlighted.addListener(() => { enforce(); });

// Chrome can swap a tab for a new one with a different id (prerender, etc.).
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const s = await getState();
  if (!s || s.tabId !== removedTabId) return;
  s.tabId = addedTabId;
  await chrome.storage.local.set({ [KEY]: s });
});

// Switching to another Chrome window.
chrome.windows.onFocusChanged.addListener(async (wid) => {
  if (wid === chrome.windows.WINDOW_ID_NONE) return;
  const s = await getState();
  if (!s || respawning || wid === s.windowId) return;
  await block(s);
});

// Allowed tab closed: reopen it. Allowed window closed: session ends.
chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  const s = await getState();
  if (!s || tabId !== s.tabId || info.isWindowClosing) return;
  const o = await chrome.storage.local.get(LAST);
  respawning = true;
  const opts = { windowId: s.windowId };
  if (o[LAST] && o[LAST].startsWith('http')) opts.url = o[LAST];
  try { await chrome.tabs.create(opts); } catch (e) { respawning = false; }
});

chrome.windows.onRemoved.addListener(async (wid) => {
  const s = await getState();
  if (s && s.windowId === wid) await endFocus();
});

// In the allowed tab: keep chrome:// pages (like the extensions page) out.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const s = await getState();
  if (!s || tabId !== s.tabId) return;
  const url = changeInfo.url;
  if (url.startsWith('http')) {
    await chrome.storage.local.set({ [LAST]: url });
  } else if (url.startsWith('chrome://') && url !== 'chrome://newtab/') {
    const o = await chrome.storage.local.get(LAST);
    if (o[LAST] && o[LAST].startsWith('http')) {
      try { await chrome.tabs.update(tabId, { url: o[LAST] }); } catch (e) {}
    }
    toast(tabId);
  }
});

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'focus-end') endFocus(); });
chrome.runtime.onStartup.addListener(endFocus);

function makeChallenge() {
  const out = [];
  for (let i = 0; i < CHALLENGE_WORDS; i++) out.push(WORDS[Math.floor(Math.random() * WORDS.length)]);
  return out.join(' ');
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    const s = await getState();
    switch (msg.type) {
      case 'start':
        send(await startFocus(msg.minutes));
        break;
      case 'requestExit':
        if (!s) { send({ ok: false }); break; }
        if (!s.exit) {
          s.exit = { requestedAt: Date.now(), cooldownMs: COOLDOWN_MS, challenge: makeChallenge() };
          await chrome.storage.local.set({ [KEY]: s });
        }
        send({ ok: true });
        break;
      case 'cancelExit':
        if (s) { delete s.exit; await chrome.storage.local.set({ [KEY]: s }); }
        send({ ok: true });
        break;
      case 'confirmExit': {
        const e = s && s.exit;
        if (e && Date.now() - e.requestedAt >= e.cooldownMs && (msg.text || '').trim() === e.challenge) {
          await endFocus();
          send({ ok: true });
        } else {
          send({ ok: false });
        }
        break;
      }
      default:
        send({ ok: false });
    }
  })();
  return true;
});
