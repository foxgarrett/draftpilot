# Draft Pilot — Design System

A design spec for **Draft Pilot**, a browser-extension side panel that helps
Sleeper fantasy football managers export drafts and make live auction bid
decisions. This document is written for Google Stitch (and any downstream
code-gen agent) to reproduce the current look, structure, and behavior.

- **Product surface:** Chrome/Firefox side-panel (fixed width, min 300px,
  max 480px, `padding: 20px 16px 28px`). Design mobile-first — treat the
  panel as a phone-width column.
- **Voice:** Coach-like. Confident, quantitative, concise. Never breathless.
- **Personality:** Calm dark-first UI with a single electric cyan accent
  that pops on dark and inverts to deep navy on light.

---

## 1. Brand

- **Name:** Draft Pilot (two words). Not "DraftPilot".
- **Logo:** Circular mark, two variants — `logo-light-*.png` (dark mark
  for light backgrounds) and `logo-dark-*.png` (light mark for dark
  backgrounds). SVG source at `icons/src/icon.svg`. Swap via CSS var
  `--brand-logo` per theme block.
- **Hero avatar:** 140×140, centered, `background-image: var(--brand-logo);
  background-size: contain`. Sits above welcome copy.

---

## 2. Color tokens

Dark-first design, but light is a first-class peer. Every color is a CSS
custom property. **Never hardcode a color in a component** — always
reference a token. State colors (success/danger) are the ONLY tokens
allowed inside `color-mix()` for subtle tint backgrounds.

### 2.1 Light (default & `data-theme="light"`)

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#f1f5f9` | Page background |
| `--card-bg` | `#ffffff` | Card / surface |
| `--text` | `#0f172a` | Body text |
| `--text-muted` | `#64748b` | Secondary text |
| `--text-heading` | `#0f172a` | Headings |
| `--border` | `#e2e8f0` | Card / input border |
| `--divider` | `rgba(15,23,42,0.08)` | Hairline dividers, hover fills |
| `--primary-bg` | `#0f172a` | Primary button fill |
| `--primary-text` | `#ffffff` | Primary button text |
| `--primary-hover` | `#1e293b` | Primary button hover |
| `--secondary-border` | `#06b6d4` | Secondary button outline |
| `--secondary-text` | `#06b6d4` | Secondary button text |
| `--secondary-hover-bg` | `rgba(6,182,212,0.08)` | Secondary hover fill |
| `--success` | `#059669` | Positive / synced / BUY |
| `--link` | `#0284c7` | Inline text links |
| `--danger` | `#dc2626` | Errors / PASS / overpay |
| `--input-bg` | `#ffffff` | |
| `--input-border` | `#cbd5e1` | |
| `--input-focus` | `#06b6d4` | Focus ring color |
| `--shadow-card` | `0 1px 2px rgba(15,23,42,0.04)` | Card shadow |
| `--shadow-menu` | `0 8px 24px rgba(15,23,42,0.16)` | Dropdown / popover |
| `--draftday-bg` | `#0f172a` | Draft Day promo card |
| `--draftday-btn-bg` | `#22d3ee` | Draft Day CTA fill |

### 2.2 Dark (`prefers-color-scheme: dark` and `data-theme="dark"`)

| Token | Value | Notes |
|---|---|---|
| `--bg` | `#0d1524` | Deep navy, near-black |
| `--card-bg` | `#131c31` | One step lighter than bg |
| `--text` | `#f1f5f9` | |
| `--text-muted` | `#94a3b8` | |
| `--text-heading` | `#ffffff` | |
| `--border` | `#1f2a44` | |
| `--divider` | `rgba(255,255,255,0.08)` | |
| `--primary-bg` | `#22d3ee` | Cyan — inverts from light theme |
| `--primary-text` | `#0f172a` | Dark ink on cyan |
| `--primary-hover` | `#67e8f9` | |
| `--secondary-border` / `--secondary-text` | `#22d3ee` | |
| `--secondary-hover-bg` | `rgba(34,211,238,0.10)` | |
| `--success` | `#34d399` | |
| `--link` | `#22d3ee` | |
| `--danger` | `#f87171` | |
| `--input-bg` | `#1a2338` | |
| `--input-border` | `#2a3654` | |
| `--input-focus` | `#22d3ee` | |
| `--shadow-card` | `none` | Elevation is by fill on dark, not shadow |
| `--shadow-menu` | `0 8px 24px rgba(0,0,0,0.4)` | |
| `--draftday-bg` | `#22d3ee` | Card inverts to cyan on dark |

### 2.3 Semantic tint pattern

Muted state fills are built with `color-mix()`. Reuse this exact recipe:

```css
background: color-mix(in srgb, var(--success) 12%, transparent);
color: var(--success);
border-color: color-mix(in srgb, var(--success) 40%, var(--border));
```

Percentages by intensity:
- **Subtle background:** 10–15% of state color
- **Border tint:** 35–45% of state color, mixed with `--border`
- **Solid pill (e.g. YOUR BID):** 100% state color as `background`,
  `--card-bg` as text

### 2.4 Scarcity/severity ramp

For non-binary severity (used in scarcity levels and primary insights),
use this ramp — the two mid steps introduce yellow/orange that don't
exist as tokens but are hardcoded ONLY inside `color-mix()`:

| Level | Hue | Example |
|---|---|---|
| `is-low` | `--success` | Low urgency |
| `is-medium` | `#eab308` (amber) | Watch |
| `is-high` | `#f97316` (orange) | Warning |
| `is-critical` | `--danger` | Act now |

---

## 3. Typography

- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif`
- **Base:** 14px / 1.5
- **Antialiasing:** `-webkit-font-smoothing: antialiased` on body
- **Numerics in data tables/pills:** `font-variant-numeric: tabular-nums`

### Type scale (in use)

| Role | Size | Weight | Notes |
|---|---|---|---|
| Body | 14px | 400 | |
| Muted / meta | 12–13px | 400 | color `--text-muted` |
| Micro / label | 10–11px | 700, `text-transform: uppercase`, `letter-spacing: 0.04–0.06em` | Used for `SCARCITY`, `LIVE`, `YOUR BID`, tier badges |
| Small body | 13px | 400 | Card body |
| Card title | 16px | 700 | |
| Hero title | 20px | 700 | |
| Live section heading | 22px | 700 | e.g. "We're synced." |
| Nomination player name | 20px | 800 | The visual anchor of Live Mode |
| Big-number readouts | 24–32px | 700–900 | Bid dollar amounts |

**Rule:** No more than one 20px+ headline per visible screen at a time.
The nomination player name IS the headline when Live Mode is active.

---

## 4. Spacing & layout

Draft Pilot uses an ad-hoc but consistent scale — treat these as tokens
even though the CSS doesn't declare them as vars:

| Step | Value | Typical use |
|---|---|---|
| xs | 2px | Micro gaps inside pills |
| sm | 4px | Sub-line stack |
| md | 6–8px | Icon+text pairing, tight vertical rhythm |
| lg | 10–12px | Card internal spacing between blocks |
| xl | 16px | `margin-bottom` between cards, section padding |
| 2xl | 20–24px | Hero-level breathing room |
| 3xl | 28px | Panel bottom padding |

- **Panel padding:** `20px 16px 28px`
- **Panel width:** min 300, max 480, `margin: 0 auto`
- **Card padding:** 16px
- **Card gap:** 16px `margin-bottom`
- **Button padding:** 10px 14px (primary), 6px 12px (`.btn-tiny`)
- **Input padding:** 10px 12px

### Radius

- **Inputs, buttons, cards internal blocks:** 8px
- **Primary buttons:** 10px
- **Cards:** 12px
- **Small chips (tier badges, verdict pills):** 4–6px
- **Fully-rounded pill (status badges, "YOUR BID"):** 999px
- **Dot indicator (`.live-poll-indicator`):** 50%

### Elevation

- **Light theme:** Very subtle 1px shadow (`--shadow-card`)
- **Dark theme:** No shadow — elevation is expressed by lifting card
  background one step lighter than `--bg`
- **Menus/popovers:** Always use `--shadow-menu` (large soft drop)

---

## 5. Component patterns

### 5.1 Buttons

Three flavors, always full-width unless `.btn-tiny` is applied:

```html
<button class="btn btn-primary">Primary CTA</button>
<button class="btn btn-secondary">Secondary</button>
<button class="btn btn-inverse">Inverse (on tinted cards)</button>
```

- **Primary:** Dark navy on light, cyan on dark. `border-radius: 10px`,
  `font-weight: 600`, transition `120ms ease` on background/border/color/opacity.
- **Secondary:** Transparent fill, cyan outline + text. On hover fills
  with `--secondary-hover-bg`.
- **Inverse:** Only used on the tinted Draft Day promo card. Inverts
  the card's own accent.
- **Disabled:** `opacity: 0.6; cursor: not-allowed`.
- **Icon-only buttons (`.icon-btn`):** 28×28, `border-radius: 6px`,
  hover fills with `--divider`.
- **`.link-btn`:** Inline text button, underlined, colored `--link`.

### 5.2 Inputs

Single style. Full-width, `--input-bg` fill, 1px border, 8px radius,
120ms border transition. Focus adds a 3px ring built with
`color-mix(in srgb, var(--input-focus) 20%, transparent)` — do NOT use
the default browser outline.

### 5.3 Cards

```html
<div class="card">
  <h3 class="card-title">Title</h3>
  <p class="card-body">Muted description.</p>
  <button class="btn btn-primary">Action</button>
</div>
```

- Default card: `--card-bg`, 1px `--border`, 12px radius, 16px padding.
- **`.card-placeholder`:** dashed border, used for coming-soon slots.
- **`.card-draft-day`:** Filled with `--draftday-bg`. Contents use
  `--draftday-title` / `--draftday-body` / `--draftday-btn-*`. The card
  visibly INVERTS between themes (navy in light, cyan in dark).
- **`.card-error`:** Border swapped for `--danger`.

### 5.4 Badges & pills

- **`.beta-badge`:** 1px outlined pill in `--primary-bg`, 10px uppercase,
  `border-radius: 4px`. Sits inline next to feature labels.
- **Live status badge (`.live-status-badge`):** 999px pill, 11px uppercase,
  tinted per state: `is-live` (success), `is-pre` (muted), `is-done` (muted).
- **Tier badge (`.live-nomination-tier`):** Micro-pill, muted default,
  `is-elite` variant uses the success tint recipe.
- **Verdict pill (`.live-pick-verdict`):** Retrospective bid quality.
  `is-bargain` = success tint, `is-overpay` = danger tint, default = muted.
- **YOUR BID pill:** Solid `--success` background, `--card-bg` text — the
  ONLY solid state pill in the system. Reserved for "you currently own
  the top bid".

### 5.5 Menus & popovers

- Anchored dropdown, positioned `top: calc(100% + 6px)`, `min-width: 200px`,
  10px radius, `--shadow-menu`, 6px padding.
- Items are 8px 10px, 6px radius, hover fills with `--divider`.
- Section labels: 11px uppercase, `letter-spacing: 0.5px`, `--text-muted`.
- Dividers: 1px `--divider`, 4px vertical margin.
- `role="menuitemradio"` items show a check via `.menu-check` (opacity
  toggled by `aria-checked="true"`).

### 5.6 Status lines

`<p class="status ...">` — 12px, `min-height: 16px` to prevent layout
shift. Modifiers: `.subtle`, `.error`, `.success`.

### 5.7 Lists

- **Draft list (`.draft-list`):** Row cards with 12px padding, 10px
  radius, 8px between rows. Each row is `flex; gap: 12px`.
- **Live pick log (`.live-pick-log`):** 3-col grid
  (`auto 1fr auto`), 8px gap, 8px vertical padding, hairline
  bottom-border between rows. Newest picks animate with
  `.is-new` → `live-pick-flash` (1.2s ease-out fade from success tint).

---

## 6. Motion

Deliberately restrained. Everything is either a 120ms hover transition or
a purposeful "something happened" flash.

| Animation | Duration | Use |
|---|---|---|
| Hover state transitions | 120ms ease | All buttons, links, menu items |
| `live-pulse` | 1.8s ease-in-out infinite | Poll indicator dot (opacity + scale) |
| `spin` | 800ms linear infinite | Re-sync icon while loading |
| `live-pick-flash` | 1.2s ease-out | New pick lands in the log |

**Rules:**
- No decorative motion. If it moves, it's confirming a state change.
- Never animate layout properties that cause reflow.
- Reduce-motion queries not currently gated — future addition.

---

## 7. Iconography

- **Source:** Inline SVGs, 10–16px, `stroke="currentColor"`,
  `stroke-width="2"` (`"3"` for check marks). Style consistent with
  Lucide/Feather.
- **Sizes:** 10px (menu affordances), 12px (menu links), 16px (icon
  buttons).
- `aria-hidden="true"` on decorative icons.

---

## 8. Theming behavior

Follow this pattern exactly — a settings menu overrides the OS preference:

1. `:root` — light tokens (default).
2. `@media (prefers-color-scheme: dark) { :root { ... } }` — dark
   fallback for system-dark users who haven't chosen.
3. `:root[data-theme="light"]` — explicit light override.
4. `:root[data-theme="dark"]` — explicit dark override.

Every token that changes across themes must be redefined in ALL FOUR
places. Never define a color only inside the media block or only inside
`[data-theme]` — it will lose in one of the four states.

`color-scheme: light dark;` on `:root` so form controls follow suit.

---

## 9. Accessibility

- All interactive controls have visible focus states — either the input's
  3px focus ring, the button's transition on background/border, or the
  menu item's `--divider` fill.
- Menus use `role="menu"` / `role="menuitem"` / `role="menuitemradio"`
  with `aria-expanded` and `aria-checked` synced by JS.
- Status regions use `role="status"`.
- Decorative SVGs use `aria-hidden="true"`; branded imagery uses
  `role="img"` + `aria-label`.
- Global `[hidden] { display: none !important; }` prevents class rules
  from beating the `hidden` attribute.
- Text contrast: all body/heading tokens meet WCAG AA on their paired
  backgrounds.

---

## 10. Content patterns

Draft Pilot is **information-dense but never noisy**. When designing new
surfaces:

- Lead with **one recommendation** (BUY / CAUTION / PASS or a headline
  number). Supporting evidence lives underneath.
- Show ONE "primary insight" at a time — the dominant reason. If a second
  insight matters, demote it visually (smaller, muted).
- Prefer inline pills for at-a-glance state (`WR T1 · +$8`) over
  separate rows.
- Numbers get `tabular-nums`. Dollar deltas show explicit sign
  (`+$8`, `-$4`, `at value`).
- Uppercase micro-labels (`SCARCITY`, `LIVE`, `YOUR BID`) are the only
  place letter-spacing goes above 0.03em.

---

## 11. Do / Don't

**Do:**
- Use `color-mix()` with the exact percentages above for state tints.
- Keep card radius (12) > button radius (10) > input radius (8) — this
  hierarchy is deliberate.
- Let cyan (`#22d3ee`) be the ONLY accent in dark mode.
- Match every dark token change with an explicit `data-theme` override.

**Don't:**
- Introduce a third accent color or a gradient.
- Use drop shadows on dark theme cards (`--shadow-card` is `none` there
  on purpose — dark elevation is by fill).
- Animate anything for decoration.
- Add another typeface — the system stack is intentional.
- Hardcode colors in component CSS. If a value isn't a token, promote
  it to one first.
