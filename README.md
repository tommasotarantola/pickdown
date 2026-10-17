# Pickdown

Point at parts of a web page, select as many as you want, copy them all in one go.
Output as plain text, Markdown (links, headings, lists, tables) or raw HTML.
Charts, maps and canvases can be copied as a PNG image.

Built to manually feed pages to an AI chat when the site blocks bots. Works for anything else too.

## Usage

1. Click the toolbar icon to open the panel and pick a mode: Text (default), Markdown, Full DOM.
2. Turn on "Selecting". A blue outline follows the mouse.
3. Click elements to select them; they get a green numbered box. Click again to unselect.
4. Up arrow selects the parent element, Down arrow goes back. Enter works like a click.
5. Click "Copy as ..." in the panel. Everything goes to the clipboard, in selection order.
6. Shift+click copies a single element as an image, right away.

| Shortcut     | Action                                   |
|--------------|------------------------------------------|
| Alt+Shift+S  | Start / stop selecting (Esc also stops)  |
| Alt+Shift+E  | Copy the selection in the current mode   |
| Alt+Shift+D  | Clear the selection                      |
| Alt+Shift+M  | Switch mode                              |

- The icon badge counts the selected elements: blue while selecting, grey when stopped.
- In Markdown mode, the copy message tells you if any visible word is missing from the output.
- The panel has a log of the last 30 events, with a "Copy log" button for bug reports.

## Install

1. Open `chrome://extensions` (`brave://extensions` in Brave), turn on "Developer mode".
2. Click "Load unpacked" and pick this folder. Pin the icon to see the badge.
3. Shortcuts can be changed in `chrome://extensions/shortcuts`.

Any Chromium browser from version 116. In Brave, avoid Alt+Shift with C P X Z W T B A R N.

## How it works

- `picker.js` runs inside the page: outlines, selection, conversion, image crop.
- `background.js` routes panel buttons and shortcuts to the picker, owns badge and log.
- `popup.html/js` is the panel. `offscreen.html/js` is a hidden page that writes the clipboard.
- `activeTab` permission: the extension touches only the tab you act on, only when you act.
- Also `scripting`, `offscreen`, `clipboardWrite`, `storage` (mode and log, memory only).
- No network code, no libraries, no data leaves the browser.
- The Markdown converter walks every node, including shadow DOM and same-origin iframes.
- Hidden content (`display:none`, `visibility:hidden`, screen-reader-only boxes) is skipped.
- `icons/make_icons.py` (Pillow) draws the icon.

## Limits

- Browser pages, the Web Store and the built-in PDF viewer are off limits for any extension.
- Iframes from other sites cannot be picked inside: pick the iframe, or copy it as an image.
- Image copy needs https and covers only the part visible on screen.
- Reloading the page clears the selection.
- Full DOM does not include shadow DOM content (`outerHTML` does not serialize it).
- Canvas content is pixels: it can only be copied as an image, never as text.
