/*
 * WHAT IT DOES
 *   Runs the actions asked by the panel and by the keyboard shortcuts on the picker in the
 *   current tab: state, toggle, clear, mode, export. Keeps the export mode (default Text),
 *   writes the exported text to the clipboard, keeps the log (last 30 events), shows the
 *   selection count on the toolbar icon, takes screenshots for image copy.
 *
 * HOW IT WORKS
 *   Sections, in order:
 *     1. Constants
 *     2. Helpers        call the picker, write the clipboard, badge, log
 *     3. Actions        cst_fun_do: the one function that runs every action
 *     4. Entry points   keyboard shortcuts, messages from panel and picker
 *
 *   - Opening the panel or pressing a shortcut grants "activeTab" for the current tab only.
 *     With it we inject picker.js (it loads once per page) and call its methods through
 *     scripting.executeScript, which runs in the same isolated world as picker.js.
 *   - Clipboard: a service worker has no DOM and the page is not focused while the panel is
 *     open, so the write is done in an offscreen document (reason CLIPBOARD), the documented
 *     way for MV3 extensions. It is created for one write and closed.
 *   - Mode and log live in chrome.storage.session: memory only, shared by all tabs, wiped
 *     when the browser closes. Not plain variables: this service worker is stopped after ~30 s idle
 *     and would forget them.
 *   - Errors (chrome:// or brave:// pages, Web Store, PDF viewer): icon shows "ERR", tooltip
 *     shows why, and the error goes to the log.
 *
 * FILES READ
 *   picker.js (injected into the page), offscreen.html / offscreen.js (clipboard)
 *
 * FILES WRITTEN
 *   chrome.storage.session keys "mode" and "log" (memory only, not on disk); the clipboard
 */

// ================================================================ 1. Constants
const TITLE = 'Pickdown';
const MODES = { text: 'Text', markdown: 'Markdown', dom: 'Full DOM' };
const LOG_SIZE = 30;
const COMMANDS = { // shortcut name in manifest.json -> action
  'toggle-picking': 'toggle',
  'export-markdown': 'export',
  'clear-selection': 'clear',
  'cycle-mode': 'mode',
};

// ================================================================ 2. Helpers
// Calls window.__pc[method](...args) inside the tab. Returns null if picker.js is not loaded.
async function cst_fun_call(tabId, method, args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m, a) => (window.__pc ? window.__pc[m](...a) : null),
    args: [method, args || []],
  });
  return res.result;
}

async function cst_fun_clipboard(text) {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!open.length) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Write the exported selection to the clipboard',
    });
  }
  const res = await chrome.runtime.sendMessage({ type: 'offscreen-copy', text });
  await chrome.offscreen.closeDocument();
  if (!res || !res.ok) throw new Error('the browser refused the clipboard write');
}

// Badge: number of selected elements. Blue while selecting, grey when stopped.
function cst_fun_badge(tabId, count, active) {
  chrome.action.setBadgeText({ tabId, text: active || count ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: active ? '#1a73e8' : '#5f6368' });
  chrome.action.setTitle({ tabId, title: TITLE });
}

// Adds one line to the log, newest first.
async function cst_fun_log(tabId, text, isError) {
  let host = '';
  try { host = new URL((await chrome.tabs.get(tabId)).url).host; } catch (_) { /* no URL access */ }
  const { log = [] } = await chrome.storage.session.get('log');
  log.unshift({ t: new Date().toLocaleTimeString(), host, text, isError: !!isError });
  await chrome.storage.session.set({ log: log.slice(0, LOG_SIZE) });
}

// ================================================================ 3. Actions
// Runs one action on the tab. Returns { active, count, mode } and, for export, msg.
// arg: for 'mode', the mode to set; without it, the next mode.
async function cst_fun_do(tabId, cmd, arg) {
  try {
    // 1. current mode
    let { mode } = await chrome.storage.session.get('mode');
    if (!MODES[mode]) mode = 'text';

    // 2. 'state' only reads: it must not inject the picker into every page the panel opens on
    if (cmd === 'state') {
      const s = (await cst_fun_call(tabId, 'state')) || { active: false, count: 0 };
      return { ...s, mode };
    }

    // 3. new mode, if asked
    if (cmd === 'mode') {
      const keys = Object.keys(MODES);
      mode = MODES[arg] ? arg : keys[(keys.indexOf(mode) + 1) % keys.length];
      await chrome.storage.session.set({ mode });
    }

    // 4. picker loaded and told the mode (shown in its on-page hint)
    await chrome.scripting.executeScript({ target: { tabId }, files: ['picker.js'] });
    await cst_fun_call(tabId, 'setMode', [MODES[mode]]);

    // 5. the action
    let msg = '';
    let isError = false;
    switch (cmd) {
      case 'mode': {
        msg = 'Mode: ' + MODES[mode];
        await cst_fun_call(tabId, 'toast', [msg, false]);
        break;
      }
      case 'toggle': {
        const s = await cst_fun_call(tabId, 'toggle');
        msg = `Selecting ${s.active ? 'ON' : 'OFF'}, ${s.count} selected`;
        break;
      }
      case 'clear': {
        await cst_fun_call(tabId, 'clear');
        msg = 'Selection cleared';
        break;
      }
      case 'export': {
        const r = await cst_fun_call(tabId, 'exportMd', [mode]);
        if (!r.count) {
          msg = 'Nothing selected';
          isError = true;
        } else {
          await cst_fun_clipboard(r.text);
          msg = `Copied ${r.count} element(s) as ${MODES[mode]}, ${r.text.length} chars`;
          if (r.skipped) msg += `, ${r.skipped} nested in another selected skipped`;
          if (mode === 'markdown') {
            isError = r.missingCount > 0;
            msg += isError
              ? ` | ${r.missingCount} visible words NOT in output, e.g.: ${r.missing.join(' ')}`
              : ' | all visible words included';
          }
        }
        await cst_fun_call(tabId, 'toast', [msg, isError]);
        break;
      }
      default:
        throw new Error('unknown action ' + cmd);
    }

    // 6. log, and the new state for the panel
    await cst_fun_log(tabId, msg, isError);
    const s = await cst_fun_call(tabId, 'state');
    return { ...s, mode, msg: cmd === 'export' ? msg : '' };
  } catch (err) {
    chrome.action.setBadgeText({ tabId, text: 'ERR' });
    chrome.action.setTitle({ tabId, title: 'Pickdown error: ' + err.message });
    if (cmd !== 'state') await cst_fun_log(tabId, `${cmd} failed: ${err.message}`, true);
    throw err;
  }
}

// ================================================================ 4. Entry points
chrome.commands.onCommand.addListener((command, tab) => {
  if (COMMANDS[command]) cst_fun_do(tab.id, COMMANDS[command]).catch(() => { /* in badge and log */ });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // From the panel: an action
  if (msg.cmd) {
    cst_fun_do(msg.tabId, msg.cmd, msg.mode)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // answer comes asynchronously
  }
  // From the picker: a log line (image copy, Esc)
  if (msg.type === 'log') {
    cst_fun_log(sender.tab.id, msg.text, msg.isError);
    return;
  }
  // From the picker: selection or ON/OFF changed
  if (msg.type === 'count') {
    cst_fun_badge(sender.tab.id, msg.count, msg.active);
    return;
  }
  // From the picker: screenshot of the visible tab, for image copy
  if (msg.type === 'capture') {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
