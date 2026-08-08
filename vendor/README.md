# Vendored dependencies

Third-party libraries bundled with the extension. Kept here (rather than
loaded from a CDN) because Chrome and Firefox extensions' Content Security
Policy disallows remote script loads.

## xlsx-js-style.bundle.js

[xlsx-js-style](https://github.com/gitbrent/xlsx-js-style), version 1.2.0.

A community-maintained fork of SheetJS Community Edition (v0.18.5 base) that
adds cell-styling support -- fills, fonts, borders, alignment -- which the
upstream Community Edition dropped. Used by the popup's "Export All" flow
to build an `.xlsx` workbook with insight tabs plus one raw-picks sheet
per season. Not used anywhere else in the extension.

License: MIT (matches upstream SheetJS CE). Copyright (C) 2013-present
SheetJS LLC. See https://github.com/gitbrent/xlsx-js-style/blob/master/LICENSE.

### Provenance & reproducibility

The bundled file is the unmodified `dist/xlsx.bundle.js` distributed by the
xlsx-js-style npm package at version 1.2.0. To re-download and verify:

```
curl -sL "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js" \
  -o vendor/xlsx-js-style.bundle.js
shasum -a 256 vendor/xlsx-js-style.bundle.js
# Expected SHA-256:
# 1c7abf2993ff2cd61e508f9268e9acda0098c9796f3925d2ba0d2579072653e2
```

The bundled file above is a minified/concatenated distribution. Full
readable source is available from the upstream repository at
https://github.com/gitbrent/xlsx-js-style/tree/v1.2.0 — the entire
library lives under `src/` there and can be inspected without any
build step.

Note for AMO reviewers: no build step is applied by DraftPilot to this
vendor file. It is downloaded verbatim from jsDelivr's CDN mirror of the
xlsx-js-style npm package at the version pinned above and committed to
this repo as-is. The upstream repo link is the authoritative unminified
source.
