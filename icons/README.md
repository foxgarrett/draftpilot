# Icons

No icon assets are bundled yet. `manifest.json` intentionally omits the top-level
`icons` field so the extension loads without missing-file errors in the meantime;
Chrome and Firefox both fall back to a generic puzzle-piece icon.

Before a store submission, add:

- `icon16.png` (toolbar, favicon-size)
- `icon48.png` (extensions management page)
- `icon128.png` (Chrome Web Store / Firefox AMO listing)

and wire them into `manifest.json` under `"icons"` and `"action.default_icon"`.
