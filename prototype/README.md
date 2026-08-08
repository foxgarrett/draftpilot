# DraftPilot analysis prototype

Standalone Node scripts for iterating on the pre-draft analysis engine
outside the extension. Once each analyzer stabilizes here, its pure logic
gets ported into `utils/analysis.js` for the extension popup and export to
consume.

## Run

```
node prototype/analyze.js <sleeper-username>
```

Defaults to `foxgarrett84` if no username is given.

## Files

- `sleeperClient.js` — same 5 endpoints the extension uses, plus a small
  in-process cache so repeated runs don't hammer the API.
- `analyzers.js` — pure functions: raw picks + league metadata → derived
  metrics. No I/O, no Sleeper-specific coupling except the input shape.
- `analyze.js` — CLI runner: fetches data, runs analyzers, prints a
  human-readable summary and writes the full JSON output to
  `prototype/out/<username>.json`.
