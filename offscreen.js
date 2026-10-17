/*
 * WHAT IT DOES
 *   Writes text to the clipboard on request from background.js.
 *
 * HOW IT WORKS
 *   Offscreen documents are never focused, so navigator.clipboard is refused here.
 *   document.execCommand('copy') on a selected <textarea> works, allowed by the
 *   "clipboardWrite" permission.
 *
 * FILES READ
 *   none
 *
 * FILES WRITTEN
 *   none (writes the system clipboard)
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'offscreen-copy') return;
  const ta = document.createElement('textarea');
  ta.value = msg.text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  sendResponse({ ok });
});
