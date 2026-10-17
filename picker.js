/*
 * WHAT IT DOES
 *   DevTools-style multi-element picker. While selecting is ON:
 *     click / Enter              -> add or remove the outlined element from the selection
 *     Shift+click / Shift+Enter  -> copy that element now as a PNG image (selection unchanged)
 *     ArrowUp / ArrowDown        -> outline the parent / go back to the child
 *     Esc                        -> stop selecting (selection is kept)
 *   Selected elements stay outlined in green with their number, also when selecting is OFF.
 *   Export turns the selection into one text: Text (innerText), Markdown (our converter) or
 *   Full DOM (outerHTML).
 *
 * HOW IT WORKS
 *   Injected by background.js (activeTab), once per page. Exposes window.__pc, which
 *   background.js calls: state / toggle / clear / setMode / toast / exportMd.
 *   window here is the extension's isolated world: shared DOM with the page, own JS variables.
 *
 *   Sections, in order:
 *     1. One picker per page   reuse a live picker, replace an orphaned one
 *     2. State
 *     3. UI                    outlines, label, toast (closed shadow root, inline styles)
 *     4. Drawing
 *     5. Selecting ON/OFF      the ONLY place page listeners are added or removed
 *     6. Page event handlers
 *     7. Export                Text / Full DOM / Markdown + missing-words self-check
 *     8. Image copy
 *     9. Markdown converter
 *    10. API for background.js + start
 *
 *   Orphaned picker: when the extension is reloaded, a picker already in the page keeps its
 *   listeners but loses chrome.runtime (chrome.runtime.id becomes undefined). It would keep
 *   selecting while the panel shows OFF. Every handler checks this first and, if orphaned,
 *   removes the picker completely.
 *
 * FILES READ
 *   none (reads the page DOM)
 *
 * FILES WRITTEN
 *   none (image copy writes the system clipboard)
 */

(() => {
  // ================================================================ 1. One picker per page
  // (?.() because a picker from an older version may lack these methods)
  if (window.__pc) {
    if (window.__pc.isAlive?.()) return; // live picker already here: background.js uses it
    window.__pc.destroy?.();             // orphaned by an extension reload: replace it
  }

  // ================================================================ 2. State
  const pc = { active: false, selected: [], modeLabel: 'Text' };
  let current = null;   // element outlined in blue
  let lastHover = null; // element under the mouse; changes only when the mouse moves to another
  let downStack = [];   // children left behind with ArrowUp, for ArrowDown
  let toastTimer = 0;

  // ================================================================ 3. UI
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const marks = document.createElement('div'); // one green box per selected element
  const box = document.createElement('div');   // blue box under the mouse
  box.style.cssText = 'position:fixed;display:none;box-sizing:border-box;pointer-events:none;' +
    'border:2px solid #1a73e8;background:rgba(26,115,232,.12);';
  const label = document.createElement('div');
  const toast = document.createElement('div');
  const textCss = 'position:fixed;font:12px/1.5 monospace;background:#202124;color:#fff;' +
    'padding:2px 6px;border-radius:3px;pointer-events:none;';
  label.style.cssText = textCss + 'display:none;white-space:nowrap;';
  toast.style.cssText = textCss + 'display:none;right:12px;bottom:12px;max-width:60vw;';
  shadow.append(marks, box, label, toast);
  document.documentElement.appendChild(host);

  const HINT = 'click: select/unselect | Shift+click: copy image | Up/Down: parent/child | Esc: stop';

  // ================================================================ 4. Drawing
  function cst_fun_place(div, el) {
    const r = el.getBoundingClientRect();
    div.style.left = r.left + 'px';
    div.style.top = r.top + 'px';
    div.style.width = r.width + 'px';
    div.style.height = r.height + 'px';
    return r;
  }

  function cst_fun_draw() {
    // green numbered boxes: one per selected element
    while (marks.children.length < pc.selected.length) {
      const m = document.createElement('div');
      m.style.cssText = 'position:fixed;box-sizing:border-box;pointer-events:none;' +
        'border:2px solid #1e7e34;background:rgba(30,126,52,.10);';
      const n = document.createElement('div');
      n.style.cssText = 'position:absolute;left:0;top:0;font:bold 11px/1.4 monospace;' +
        'background:#1e7e34;color:#fff;padding:0 4px;';
      m.appendChild(n);
      marks.appendChild(m);
    }
    while (marks.children.length > pc.selected.length) marks.lastChild.remove();
    pc.selected.forEach((el, i) => {
      cst_fun_place(marks.children[i], el);
      marks.children[i].firstChild.textContent = String(i + 1);
    });

    // blue box + label: only while selecting
    if (!pc.active || !current) {
      box.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    const r = cst_fun_place(box, current);
    box.style.display = 'block';
    const id = current.id ? '#' + current.id : '';
    const cls = typeof current.className === 'string' && current.className.trim()
      ? '.' + current.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    label.textContent = `${current.localName}${id}${cls}  ${Math.round(r.width)}x${Math.round(r.height)}`;
    label.style.display = 'block';
    label.style.left = Math.max(0, r.left) + 'px';
    label.style.top = (r.top > 22 ? r.top - 22 : Math.min(r.bottom + 2, innerHeight - 22)) + 'px';
  }

  // Bottom-right line: the hint while selecting, hidden otherwise.
  function cst_fun_hint() {
    toast.style.background = '#202124';
    toast.textContent = `[${pc.modeLabel}] ${HINT}`;
    toast.style.display = pc.active ? 'block' : 'none';
  }

  // Bottom-right line: a message for a few seconds, then back to the hint.
  function cst_fun_toast(msg, isError) {
    toast.textContent = msg;
    toast.style.background = isError ? '#b3261e' : '#1e7e34';
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(cst_fun_hint, isError ? 8000 : 3000);
  }

  // false once the extension has been reloaded (this picker is orphaned)
  function cst_fun_alive() {
    return !!(chrome.runtime && chrome.runtime.id);
  }

  // Messages to background.js: badge count and log lines.
  function cst_fun_send(msg) {
    if (cst_fun_alive()) chrome.runtime.sendMessage(msg).catch(() => { /* worker restarting */ });
  }

  function cst_fun_toast_log(msg, isError) {
    cst_fun_toast(msg, isError);
    cst_fun_send({ type: 'log', text: msg, isError });
  }

  // Redraw and update the badge after any change of selection or ON/OFF.
  function cst_fun_changed() {
    cst_fun_draw();
    cst_fun_send({ type: 'count', count: pc.selected.length, active: pc.active });
  }

  // ================================================================ 5. Selecting ON/OFF
  // Page listeners exist only while selecting is ON: when OFF, the picker cannot react to
  // the mouse at all, so "OFF but still selecting" is impossible by construction.
  const PAGE_EVENTS = [
    ['mousemove', onMove], ['click', onClick], ['keydown', onKey],
    ['mousedown', onBlock], ['mouseup', onBlock], ['pointerdown', onBlock],
    ['pointerup', onBlock], ['auxclick', onBlock], ['contextmenu', onBlock],
  ];

  function cst_fun_set_active(on) {
    if (pc.active === on) return;
    pc.active = on;
    for (const [type, fn] of PAGE_EVENTS) {
      if (on) addEventListener(type, fn, true);
      else removeEventListener(type, fn, true);
    }
    current = lastHover = null;
    downStack = [];
    cst_fun_hint();
    cst_fun_changed();
  }

  // Removes everything this picker added to the page.
  function cst_fun_destroy() {
    cst_fun_set_active(false);
    removeEventListener('scroll', cst_fun_draw, true);
    removeEventListener('resize', cst_fun_draw);
    clearTimeout(toastTimer);
    host.remove();
    if (window.__pc === pc) delete window.__pc;
  }

  // ================================================================ 6. Page event handlers
  // Capture phase on window: we run before the page's own handlers and stop them, so the
  // page does not follow links or open menus while selecting.
  function cst_fun_orphaned() {
    if (cst_fun_alive()) return false;
    cst_fun_destroy();
    return true;
  }

  function onBlock(e) {
    if (cst_fun_orphaned()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMove(e) {
    if (cst_fun_orphaned()) return;
    const el = e.composedPath()[0]; // real target, also inside shadow DOM
    if (!(el instanceof Element) || el === lastHover) return;
    lastHover = el;
    current = el;
    downStack = [];
    cst_fun_draw();
  }

  function onClick(e) {
    if (cst_fun_orphaned()) return;
    onBlock(e);
    if (!current) return;
    if (e.shiftKey) cst_fun_copy_image(current);
    else cst_fun_select(current);
  }

  function onKey(e) {
    if (cst_fun_orphaned()) return;
    if (e.key === 'Escape') {
      cst_fun_set_active(false);
      cst_fun_send({ type: 'log', text: 'Selecting OFF (Esc)', isError: false });
    } else if (e.key === 'ArrowUp' && current) {
      const root = current.getRootNode();
      const parent = current.parentElement || (root instanceof ShadowRoot ? root.host : null);
      if (parent) { downStack.push(current); current = parent; cst_fun_draw(); }
    } else if (e.key === 'ArrowDown' && downStack.length) {
      current = downStack.pop();
      cst_fun_draw();
    } else if (e.key === 'Enter' && current) {
      if (e.shiftKey) cst_fun_copy_image(current);
      else cst_fun_select(current);
    } else {
      return; // any other key goes to the page
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function cst_fun_select(el) {
    const i = pc.selected.indexOf(el);
    if (i >= 0) pc.selected.splice(i, 1);
    else pc.selected.push(el);
    cst_fun_changed();
  }

  // ================================================================ 7. Export
  // mode: 'text' -> innerText (what the browser renders as text), 'dom' -> outerHTML (raw
  // HTML), anything else -> Markdown.
  function cst_fun_export(mode) {
    // Elements removed from the page are dropped; an element inside another selected one
    // would be exported twice, so it is skipped.
    const pieces = pc.selected.filter((el) => el.isConnected &&
      !pc.selected.some((o) => o !== el && o.contains(el)));
    if (!pieces.length) return { count: 0 };
    const skipped = pc.selected.length - pieces.length;

    if (mode === 'text') {
      const body = pieces.map((el) => (el.innerText || '').trim()).join('\n\n---\n\n');
      return { text: `Source: ${document.title} - ${location.href}\n\n${body}\n`, count: pieces.length, skipped };
    }
    if (mode === 'dom') {
      const body = pieces.map((el) => el.outerHTML).join('\n\n<!-- ---------- -->\n\n');
      return { text: `<!-- Source: ${location.href} -->\n${body}\n`, count: pieces.length, skipped };
    }

    const md = pieces.map((el) => cst_fun_clean(cst_fun_md(el))).join('\n\n---\n\n');
    // Self-check: words the browser renders (innerText) that are not in the Markdown.
    const norm = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    // Link and image targets "](url)" are removed first: glued to the text ("[link](url).")
    // they would turn "link" into one long token and report it as missing.
    const have = new Set(md.replace(/\]\([^)]*\)/g, '] ').split(/\s+/).map(norm));
    const missing = new Set();
    for (const el of pieces) {
      for (const w of (el.innerText || '').split(/\s+/)) {
        const n = norm(w);
        if (n && !have.has(n)) missing.add(w);
      }
    }
    return {
      text: `Source: [${document.title}](${location.href})\n\n${md}\n`,
      count: pieces.length,
      skipped,
      missingCount: missing.size,
      missing: [...missing].slice(0, 8),
    };
  }

  // ================================================================ 8. Image copy
  function cst_fun_copy_image(el) {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
    const x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) {
      cst_fun_toast_log('ERROR: element is not in view, scroll to it first', true);
      return;
    }
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      cst_fun_toast_log('ERROR: image copy needs an https page', true);
      return;
    }
    host.style.display = 'none'; // our outlines must not end up in the screenshot

    // ClipboardItem accepts a Promise: the write starts now, inside the user gesture,
    // and the PNG is produced afterwards (screenshot round trip to background.js).
    const png = (async () => {
      // two frames: let the browser repaint without our outlines before the screenshot
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const res = await chrome.runtime.sendMessage({ type: 'capture' });
      host.style.display = '';
      if (!res || res.error) throw new Error(res ? res.error : 'no answer from background');
      const bytes = Uint8Array.from(atob(res.dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
      const shot = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const scale = shot.width / innerWidth; // device pixels per CSS pixel (DPI and zoom)
      const w = Math.round((x1 - x0) * scale), h = Math.round((y1 - y0) * scale);
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(shot, Math.round(x0 * scale), Math.round(y0 * scale), w, h, 0, 0, w, h);
      return canvas.convertToBlob({ type: 'image/png' });
    })();
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => png.then((b) => cst_fun_toast_log(`Copied image: ${Math.round(b.size / 1024)} KB`, false)),
      (err) => { host.style.display = ''; cst_fun_toast_log('ERROR copying image: ' + err.message, true); },
    );
  }

  // ================================================================ 9. Markdown converter
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'svg',
    'input', 'option', 'datalist']);

  function cst_fun_block(s) { return '\n\n' + s.trim() + '\n\n'; }

  // Puts **, * around the text but keeps the surrounding spaces outside the markers.
  function cst_fun_wrap(s, mark) {
    const t = s.trim();
    if (!t) return s;
    return (/^\s/.test(s) ? ' ' : '') + mark + t + mark + (/\s$/.test(s) ? ' ' : '');
  }

  function cst_fun_clean(s) {
    return s
      .replace(/[ \t]+$/gm, '')    // trailing spaces
      .replace(/\n{3,}/g, '\n\n')  // at most one empty line
      .trim();
  }

  // Inline text of a subtree on one line (for links, headings, table cells).
  function cst_fun_line(el) {
    return cst_fun_children(el).replace(/\s+/g, ' ').trim();
  }

  // Every child node is converted: this is the recursion over the whole subtree.
  function cst_fun_children(el) {
    let kids = el.childNodes;
    const sr = (chrome.dom && chrome.dom.openOrClosedShadowRoot(el)) || el.shadowRoot;
    if (sr) {
      kids = sr.childNodes;                 // shadow tree is what is rendered
    } else if (el.localName === 'slot') {
      const assigned = el.assignedNodes({ flatten: true });
      if (assigned.length) kids = assigned; // light-DOM nodes shown through this slot
    } else if (el.localName === 'iframe') {
      try { kids = el.contentDocument ? [el.contentDocument.body] : []; } catch (_) { kids = []; }
    }
    let out = '';
    for (const k of kids) out += cst_fun_md(k);
    return out;
  }

  function cst_fun_md(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const p = node.parentElement;
      if (p && getComputedStyle(p).visibility === 'hidden') return '';
      return node.data.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    const tag = el.localName;
    if (el === host || SKIP.has(tag)) return '';

    // Not checkVisibility(): it returns false for display:contents, whose children ARE shown.
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.contentVisibility === 'hidden') return '';
    const r = el.getBoundingClientRect();
    // Screen-reader-only boxes: 1x1px, clipped. In the DOM but not on screen.
    if (r.width <= 1 && r.height <= 1 && (style.overflow === 'hidden' || style.clip !== 'auto')) return '';

    if (/^h[1-6]$/.test(tag)) {
      const t = cst_fun_line(el);
      return t ? cst_fun_block('#'.repeat(+tag[1]) + ' ' + t) : '';
    }
    switch (tag) {
      case 'br': return '\n';
      case 'hr': return cst_fun_block('---');
      case 'pre': return cst_fun_block('```\n' + el.innerText.replace(/\n+$/, '') + '\n```');
      case 'code': return '`' + el.textContent + '`';
      case 'strong': case 'b': return cst_fun_wrap(cst_fun_children(el), '**');
      case 'em': case 'i': return cst_fun_wrap(cst_fun_children(el), '*');
      case 'select': return el.selectedOptions.length ? ' ' + el.selectedOptions[0].text + ' ' : '';
      case 'canvas': return cst_fun_block(`[canvas ${el.width}x${el.height}: Shift+click it to copy as image]`);
      case 'video': return cst_fun_block('[video]');
      case 'img': {
        const src = el.currentSrc || el.src || '';
        if (!src || src.startsWith('data:')) return el.alt ? `[image: ${el.alt}]` : '';
        return `![${el.alt || ''}](${src})`;
      }
      case 'a': {
        const t = cst_fun_line(el);
        let href = '';
        try { href = new URL(el.getAttribute('href') || '', document.baseURI).href; } catch (_) { /* invalid href */ }
        if (!t) return '';
        if (!el.getAttribute('href') || href.startsWith('javascript:')) return t;
        return `[${t}](${href})`;
      }
      case 'blockquote':
        return cst_fun_block(cst_fun_clean(cst_fun_children(el)).split('\n').map((l) => '> ' + l).join('\n'));
      case 'ul': case 'ol': {
        // <li> gets a marker; any other child (invalid HTML, but common) is kept as is.
        let n = el.start || 1;
        const items = [];
        for (const child of el.childNodes) {
          if (child.localName !== 'li') {
            const t = cst_fun_clean(cst_fun_md(child));
            if (t) items.push(t);
            continue;
          }
          if (getComputedStyle(child).display === 'none') continue;
          const marker = tag === 'ol' ? `${n++}. ` : '- ';
          const pad = ' '.repeat(marker.length);
          const lines = cst_fun_clean(cst_fun_children(child)).split('\n');
          items.push(marker + lines.map((l, i) => (i === 0 || !l ? l : pad + l)).join('\n'));
        }
        return items.length ? cst_fun_block(items.join('\n')) : '';
      }
      case 'table': {
        const rows = [];
        for (const tr of el.rows) {
          if (getComputedStyle(tr).display === 'none') continue;
          rows.push(Array.from(tr.cells, (c) => cst_fun_line(c).replace(/\|/g, '\\|')));
        }
        if (!rows.length) return '';
        const cols = Math.max(...rows.map((x) => x.length));
        const fmt = (x) => '| ' + Array.from({ length: cols }, (_, i) => x[i] || '').join(' | ') + ' |';
        const out = [fmt(rows[0]), fmt(Array(cols).fill('---')), ...rows.slice(1).map(fmt)];
        return cst_fun_block(out.join('\n'));
      }
    }
    // Everything else: decided by how it is rendered.
    const inner = cst_fun_children(el);
    if (style.display.startsWith('inline') || style.display === 'contents') return inner;
    if (style.display === 'table-cell') return inner + ' ';
    return cst_fun_block(inner);
  }

  // ================================================================ 10. API + start
  pc.isAlive = cst_fun_alive;
  pc.destroy = cst_fun_destroy;
  pc.state = () => ({ active: pc.active, count: pc.selected.length });
  pc.toggle = () => { cst_fun_set_active(!pc.active); return pc.state(); };
  pc.clear = () => { pc.selected = []; cst_fun_changed(); return pc.state(); };
  pc.setMode = (modeLabel) => { pc.modeLabel = modeLabel; cst_fun_hint(); };
  pc.toast = cst_fun_toast;
  pc.exportMd = cst_fun_export;

  // Selected boxes must follow the page also while selecting is OFF.
  addEventListener('scroll', cst_fun_draw, true);
  addEventListener('resize', cst_fun_draw);
  window.__pc = pc;
})();
