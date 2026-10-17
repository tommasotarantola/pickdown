/*
 * WHAT IT DOES
 *   The panel: mode switch (Text / Markdown / Full DOM), Selecting switch, selection counter,
 *   Copy and Clear buttons, the current keyboard shortcut next to each, and the log of the
 *   last 30 events (collapsed) with a "Copy log" button.
 *
 * HOW IT WORKS
 *   Sections, in order:
 *     1. Elements
 *     2. Shortcuts      read live from chrome.commands.getAll(), so they show what you set
 *                       in chrome://extensions/shortcuts
 *     3. Log            rendered from chrome.storage.session, re-rendered on every change
 *     4. Actions        every button sends { cmd, tabId, mode } to background.js, the same
 *                       path the keyboard shortcuts use; the answer is the new state
 *
 *   Copy log runs here, not in background.js: the panel is the focused page and the click is
 *   a user gesture, so navigator.clipboard is allowed.
 *
 * FILES READ
 *   chrome.storage.session key "log" (written by background.js)
 *
 * FILES WRITTEN
 *   none (Copy log writes the system clipboard)
 */

// ================================================================ 1. Elements
const MODE_LABELS = { text: 'Text', markdown: 'Markdown', dom: 'Full DOM' };
const toggle = document.getElementById('toggle');
const count = document.getElementById('count');
const msg = document.getElementById('msg');
const btnExport = document.getElementById('export');
const btnClear = document.getElementById('clear');
const btnCopyLog = document.getElementById('copy-log');
const modeButtons = document.querySelectorAll('[data-mode]');
const logBox = document.getElementById('log');
const logCount = document.getElementById('log-n');

// ================================================================ 2. Shortcuts
chrome.commands.getAll().then((cmds) => {
  for (const c of cmds) {
    const el = document.getElementById('k-' + c.name);
    if (el) el.textContent = c.shortcut || 'not set';
  }
});
document.getElementById('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ================================================================ 3. Log
// Built with textContent: page titles and messages are never parsed as HTML.
async function cst_fun_render_log() {
  const { log = [] } = await chrome.storage.session.get('log');
  logBox.replaceChildren(...log.map((e) => {
    const row = document.createElement('div');
    if (e.isError) row.className = 'err';
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = `${e.t} ${e.host} `;
    row.append(when, e.text);
    return row;
  }));
  logCount.textContent = String(log.length);
}
cst_fun_render_log();
chrome.storage.session.onChanged.addListener((changes) => { if (changes.log) cst_fun_render_log(); });

// Plain text, oldest first (reads top to bottom like a story), with version and browser on top.
btnCopyLog.addEventListener('click', async (e) => {
  e.preventDefault(); // the button sits in <summary>: do not open/close the log
  const { log = [] } = await chrome.storage.session.get('log');
  const lines = log.slice().reverse()
    .map((x) => `${x.t} ${x.isError ? 'ERR ' : ''}${x.host} ${x.text}`);
  const head = `Pickdown ${chrome.runtime.getManifest().version} | ${navigator.userAgent}`;
  await navigator.clipboard.writeText([head, ...lines].join('\n') + '\n');
  btnCopyLog.textContent = 'Copied';
  setTimeout(() => { btnCopyLog.textContent = 'Copy log'; }, 1500);
});

// ================================================================ 4. Actions
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  async function cst_fun_ask(cmd, mode) {
    const res = await chrome.runtime.sendMessage({ cmd, tabId: tab.id, mode });
    if (!res.ok) {
      msg.textContent = 'Cannot run on this page: ' + res.error;
      toggle.disabled = btnExport.disabled = btnClear.disabled = true;
      modeButtons.forEach((b) => { b.disabled = true; });
      return;
    }
    const s = res.state;
    toggle.checked = s.active;
    count.textContent = String(s.count);
    modeButtons.forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
    btnExport.textContent = 'Copy as ' + MODE_LABELS[s.mode];
    if (s.msg) msg.textContent = s.msg;
  }

  modeButtons.forEach((b) => b.addEventListener('click', () => cst_fun_ask('mode', b.dataset.mode)));
  toggle.addEventListener('change', () => cst_fun_ask('toggle'));
  btnExport.addEventListener('click', () => cst_fun_ask('export'));
  btnClear.addEventListener('click', () => cst_fun_ask('clear'));
  cst_fun_ask('state');
});
