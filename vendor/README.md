# Vendored dependencies

Third-party libraries bundled with the extension. Kept here (rather than
loaded from a CDN) because Chrome extensions' Content Security Policy
disallows remote script loads.

## xlsx-js-style.bundle.js

[xlsx-js-style](https://github.com/gitbrent/xlsx-js-style), version 1.2.0.

A community-maintained fork of SheetJS Community Edition (v0.18.5 base) that
adds cell-styling support -- fills, fonts, borders, alignment -- which the
upstream Community Edition dropped. Used by the popup's "Export All" flow
to build an `.xlsx` workbook with insight tabs plus one raw-picks sheet
per season. Not used anywhere else in the extension.

License: MIT (matches upstream SheetJS CE). Copyright (C) 2013-present
SheetJS LLC. See https://github.com/gitbrent/xlsx-js-style/blob/master/LICENSE.

Downloaded from `https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js`.
