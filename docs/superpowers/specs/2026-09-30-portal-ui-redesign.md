# Client portal UI redesign: final build spec ("Quiet precision")

Date: 2026-09-30. Branch: `client-portal`. Scope: every page under `portal/`.

Inputs: the user request ("ramp up the actual User Interface ... a left panel with tabs such as Assignments (graded, review, archived), Tasks, Calendar"), four research briefs (dashboard patterns, calendar UI, codebase map, design skill rules), three candidate specs (A "Quiet precision", B "Homeroom", C "Bright clarity") and three judge verdicts. Direction A won all three judges (24 vs 19 vs 18.5). This document is Spec A with the judges' grafts adopted and every `must_fix` resolved. It is the only spec the build follows. Where it is silent, follow the research briefs; where they conflict with this document, this document wins.

Not in scope: `index.html`, `styles.css`, `/theme.js`, `script.js`, `i18n.js`, `translations.js` and every other landing asset. None of them change. The database schema does not change.

---

## 0. Decisions at a glance

Every open question from the specs and judges, answered. The "why" column is the tie-breaker when judges disagreed.

| Question | Decision | Why |
|---|---|---|
| Visual direction | A, "Quiet precision": cool neutrals, one pine-teal accent, hairlines, Geist + Geist Mono. Three deliberate richness points: the inset framed content panel, the "Due next" double bezel with a date block, Mono figures with a 30px display title tier. | Won every lens. The richness points answer the "looks very plain" risk judge 2 raised without adding a second accent or decoration. |
| Scroll model | Document scroll at every width. The sidebar is `position: sticky; height: 100dvh`. The framed look at 1024px and up is drawn with a sticky top-bar strip plus side and bottom borders on `main`, not an inner scroller. | One scroll container keeps sticky headers, IntersectionObserver roots and back-button scroll simple (judge 3) while keeping the framed panel judge 2 valued. |
| Active nav item | Lifted pill: `--nav-active` fill, 1px inset hairline, a faint shadow in light mode, accent icon, label `--text` 600. | A's accent-soft tint measured 1.01:1 against the sidebar. |
| Theme control | Two options, Light and Dark. No "System". | `vb-theme` is shared with the unchanged landing page, whose `/theme.js` only understands `dark` or no value. A third value would make the two surfaces disagree. |
| First Assignments sub-tab name | "To do". | It contains overdue work; "Upcoming" would be wrong for those rows. |
| Archived rule | Derived, no schema change. Archived = latest submission's grade released more than 21 days ago ("Graded"), or no submission and due more than 30 days ago ("Not turned in"). | The user asked for Archived; this bounds the Overdue group (judge 1, B, C) better than a collapsed "Missed" group (judge 2) because Archived already exists for exactly this, and the drawer still accepts late work. |
| "Completed with no submission" branch | Dropped. Assignments with no submission are To do or Archived by due date only; `completed_at` is ignored for them. | No UI or RPC path can produce it (`set_task_done` only works on `kind='task'`). |
| Detail view | A native `<dialog>` drawer for assignments and tasks, all roles, opened by an `open=<taskId>` hash parameter over any view. Tutors grade on a full review page `#/review/<submissionId>`. | The drawer keeps list context; grading needs the space. `open=` lets Overview, Calendar and Today open the drawer too (B graft). |
| Create and edit | The same drawer, `open=new&kind=...&due=...` for create, an in-drawer mode switch for edit. | Specified fully in 5.7 (judge 1 must-fix). |
| Releasing a grade | No confirm dialog. Release writes immediately and shows a shell-level toast with a 10 second Undo that survives navigation. Enter never releases. | Tutors work through a queue; Undo is faster than a confirm every time, and the Enter gate plus `type="button"` already prevent accidents. |
| AI draft vs Due soon | Both warning tone. AI draft and "Edited, not released" pills add a 1px dashed border and a pencil icon. No sixth hue. | Keeps five status hues (rejects C's violet "AI purple"). Shape tells them apart (B graft). |
| "New" markers | A small text pill "New", never a dot. Counts are numbers only. The rail and tab bar show numbers only. | Never mix dots and numbers in one nav. |
| Tutor student navigation | One scope switcher at the top of a "Student" nav group, plus the Students page. Students are not listed in the sidebar. | Keeps nav at two levels and the sidebar short; review load is visible in the switcher list, the Students page, Today and the Review queue badge. |
| Phone navigation | Top bar plus a five-slot bottom tab bar; "More" opens a sheet with the full nav. Staff get a Workspace mode and a Student mode of the tab bar. | Defines the tutor-on-a-phone path judge 1 found missing. |
| Switching student or child | `history.pushState` with the new `?student=`/`?child=` and the view's hash. Normalizing a bad id uses `replaceState`. | Back returns to the previous student. The id still lives in the URL, as today. |
| Due-date time zone | Business zone `America/Los_Angeles` for storing, bucketing and display. `dueDateToIso` and `isoToDateInput` keep their signatures but convert in that zone. A time is shown only when the due time is not 11:59 pm Pacific; " PT" is added when the viewer's zone differs. | Fixes the next-day bug and the "Pacific time" claim judge 3 flagged; C's display rule. |
| "This week" | A rolling window: today plus the next 6 days, everywhere (lede counts, strip, parent metric, Today). | One definition. A Sunday-to-Saturday strip would show six past days on a Saturday. |
| Stylesheets | `portal/css/app.css` (foundation) plus one stylesheet per build unit. Portal pages stop loading `/styles.css`, `/portal/portal.css` and `/theme.js`. | Lets units build in parallel without editing one shared file. |
| Fonts | Geist 400/500/600 and Geist Mono 400/500 only. | One family pair, on Google Fonts, allowed by the CSP. |
| Calendar for staff | One calendar route. `scope=all` shows every student; without it, the selected student. A "This student / All students" segmented control appears when a student is selected. | Same data, two scopes. |

---

## 1. Direction

**Quiet precision.** A calm, well-lit workspace. Cool neutral surfaces, one pine-teal accent used sparingly, 1px hairlines instead of resting shadows. Type does the organizing: Geist at 14px, tabular numerals and Geist Mono for scores, counts and dates so they line up like an instrument. The accent means "you are here" or "do this"; status hues only ever mean status. Dense enough for a tutor, plain enough for a parent.

The three places where the design spends its boldness:
1. **The framed panel.** At 1024px and up the content sits in a rounded, bordered panel inset 8px from a slightly darker frame that also holds the sidebar.
2. **Due next.** The student Overview opens with a double-bezel card that holds a 72px date block, the next assignment and a direct "Submit work" button.
3. **Figures.** Scores, metrics and calendar numbers in Geist Mono; Overview and Today titles in a 30px display tier.

References: Linear 2026 (dimmed sidebar, soft dividers, status glyphs), Vercel dashboard (scope switcher, framed panel), Stripe Dashboard (metric groups, tabular figures), Things 3 (checkbox feel), Notion Calendar (month grid with "+N more").

---

## 2. Tokens

All tokens live on `:root` in `portal/css/app.css`. Dark values live under `:root[data-theme="dark"]`. Each block sets `color-scheme`. Components never use raw hex values.

### 2.1 Neutrals and accent

| Token | Role | Light | Dark |
|---|---|---|---|
| `--frame` | behind sidebar and panel; sidebar surface | `#EEEFF2` | `#0B0C0E` |
| `--canvas` | main panel, page background below 1024px | `#FAFAFB` | `#131519` |
| `--surface` | cards, inputs, rows | `#FEFEFE` | `#181A1F` |
| `--surface-2` | wells, skeletons, segmented track, score chip | `#F2F3F5` | `#1F2227` |
| `--raised` | drawer, dialog, menus, popovers | `#FEFEFE` | `#23262C` |
| `--weekend` | calendar weekend cells | `#F5F6F8` | `#16181C` |
| `--hover` | row and nav hover | `#16181D0D` | `#FFFFFF0F` |
| `--line` | hairlines | `#E6E7EB` | `#272A30` |
| `--line-strong` | card borders, outline chips, badges | `#D5D7DC` | `#353941` |
| `--control` | input, select and checkbox borders (3:1) | `#7B818D` | `#6E7580` |
| `--text` | primary | `#16181D` | `#E6E8EC` |
| `--text-2` | secondary, inactive nav | `#454A54` | `#B3B8C1` |
| `--text-3` | meta, placeholders, other-month days | `#5E6470` | `#8F959F` |
| `--text-4` | disabled and decorative only, never on focusable text | `#9A9FA9` | `#5C626C` |
| `--accent` | primary button, links, focus ring, today | `#0F6E66` | `#5EC2B4` |
| `--accent-hover` | hover on accent fills | `#0B5B54` | `#7AD0C4` |
| `--accent-soft` | selected calendar day cell, drag-over dropzone, staff avatar fill, "New" pill fill | `#E3F1EE` | `#12332E` |
| `--accent-text` | text and icons on accent-soft; active nav icon | `#0B5E57` | `#7FD3C7` |
| `--on-accent` | text on accent | `#F6FBFA` | `#062320` |
| `--nav-active` | active nav pill fill | `#FEFEFE` | `#23262C` |
| `--seg-thumb` | selected segment | `#FEFEFE` | `#30343B` |
| `--inverse` / `--on-inverse` | toasts, tooltips | `#1D2026` / `#EEF0F3` | `#E6E8EC` / `#16181D` |
| `--inverse-action` | action text inside toasts | `#7FD3C7` | `#0B5E57` |
| `--scrim` | behind modal dialogs | `#10121647` | `#0000008F` |

`meta[name=theme-color]`: `#EEEFF2` light, `#0B0C0E` dark.

**Accent whitelist.** The accent family appears only on: primary buttons; the active nav icon and the 2px tree guide beside the active sub-item; links; the focus ring; today's date marker; the selected calendar day ring and cell; the "New" pill; staff avatars in the updates feed; toast action text; the dropzone while a file is dragged over it. Nowhere else, and never on large areas.

### 2.2 Status tones

Five tones. A status always shows tone + icon + words. Pills use bg and text; glyphs, dots and chart marks use solid.

| Tone | Meaning | Light bg / text / solid | Dark bg / text / solid |
|---|---|---|---|
| neutral | To do, Not turned in, Done, Family only | `#EEF0F3` / `#454A54` / `#7B818D` | `#22262C` / `#B3B8C1` / `#7A818C` |
| info | Submitted, Grading, Grading now | `#E6F0FB` / `#1D5E9A` / `#2F78BD` | `#16283B` / `#8EC0F0` / `#4C95DB` |
| warning | Due soon; AI draft and Edited, not released (staff, dashed) | `#FBF1D9` / `#855600` / `#AD7A00` | `#30270F` / `#F0C46A` / `#E0A82E` |
| danger | Overdue, Needs attention, Could not grade | `#FCEBEA` / `#A12A26` / `#D23D35` | `#361B1C` / `#F29B94` / `#E5534B` |
| success | Graded, Released | `#E8F3EA` / `#2D6A3A` / `#358C4B` | `#172B1E` / `#8FD19E` / `#4BAE65` |

- **Danger solid button** (confirm dialogs only): `#B3261E` with `#FDF6F5` text (light), `#E5534B` with `#1A0A09` text (dark).
- **Dashed variant:** `.pill.is-dashed` sets `border: 1px dashed currentColor` on the warning pill. Used only for "AI draft" and "Edited, not released", both staff-only.
- **Scores are never colored by value.**
- **Due text** in rows uses the tone *text* value: warning within 48 hours, danger when overdue, otherwise `--text-3`.
- `labels.js` tones map as: `done` to success, `wait` to info, `draft` to warning (dashed), `alert` to danger.

### 2.3 Verified contrast (computed for this spec)

Every pairing below was computed with the WCAG formula. Re-run the foundation's contrast script (section 11, F2) after any token change.

| Pair | Light | Dark | Need |
|---|---|---|---|
| `--text-3` on `--frame` / `--surface-2` / `--raised` / `--weekend` | 5.17 / 5.35 / 5.89 / 5.50 | 6.49 / 5.29 / 5.03 / 5.90 | 4.5 |
| `--control` on `--canvas` / `--surface` / `--surface-2` | 3.75 / 3.88 / 3.52 | 3.93 / 3.75 / 3.43 | 3 |
| `--accent` on `--frame` / `--canvas` / `--surface-2` | 5.31 / 5.85 / 5.49 | 9.18 / 8.57 / 7.48 | 4.5 |
| `--on-accent` on `--accent` / `--accent-hover` | 5.84 / 7.62 | 7.76 / 9.18 | 4.5 |
| `--accent-text` on `--accent-soft` | 6.57 | 7.83 | 4.5 |
| `--text-3` on `--accent-soft` | 5.12 | 4.53 | 4.5 |
| Pill text on pill bg: neutral / info / warning / danger / success | 7.79 / 5.84 / 5.61 / 6.34 / 5.70 | 7.63 / 7.82 / 9.00 / 7.44 / 8.41 | 4.5 |
| Status solid on `--surface`: neutral / info / warning / danger / success | 3.88 / 4.58 / 3.74 / 4.67 / 4.16 | 4.43 / 5.50 / 8.13 / 4.70 / 6.25 | 3 |
| Warning text / danger text on `--surface` (due labels) | 6.26 / 7.24 | 10.62 / 8.20 | 4.5 |
| Toast text / toast action on `--inverse` | 14.29 / 9.36 | 14.48 / 6.22 | 4.5 |
| Danger button text | 6.12 | 5.20 | 4.5 |

Surface-on-surface pairs that carry no text still need a visible edge. Rules that make them visible, independent of luminance:
- Active nav pill: `box-shadow: inset 0 0 0 1px var(--line), 0 1px 2px #16181D14` (light); `inset 0 0 0 1px #FFFFFF14` (dark).
- Count badges: `--surface` fill with a 1px `--line-strong` border (on the active row: `--surface-2` fill).
- Segmented thumb: `--seg-thumb` with a 1px `--line-strong` border; the selected label is `--text` 500, unselected `--text-3`.
- Framed panel: always a 1px `--line` border in both themes.

### 2.4 Typography

- One request: `https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap`, with `preconnect` to `https://fonts.googleapis.com` and `https://fonts.gstatic.com` (crossorigin).
- Stacks: `--font-ui: "Geist", ui-sans-serif, system-ui, sans-serif`; `--font-mono: "Geist Mono", ui-monospace, monospace`.

| Token | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `--t-caption` | 12 / 16 | 500 | 0 | pills, badges, weekday headers, tab bar labels |
| `--t-meta` | 13 / 18 | 400 | 0 | row meta, breadcrumbs, hints |
| `--t-ui` | 14 / 20 | 400, 500 | 0 | base; row titles and nav at 500 |
| `--t-read` | 15 / 24 | 400 | 0 | instructions, feedback, updates; 16/24 below 768px |
| `--t-h3` | 16 / 24 | 600 | -0.005em | section titles |
| `--t-h2` | 20 / 28 | 600 | -0.01em | drawer titles, calendar month, Due next title |
| `--t-h1` | 24 / 32 | 600 | -0.015em | page titles |
| `--t-display` | 30 / 36 (26 / 32 below 768px) | 600 | -0.02em | Overview, Today and parent Overview h1 only |
| `--t-figure` | 30 / 36 | Mono 500 | -0.02em | big score, metrics |
| `--t-date` | 28 / 32 | Mono 500 | -0.02em | Due next date block day number |

- `.num { font-variant-numeric: tabular-nums }` on counts, badges, dates and calendar numbers. Scores and metrics use `--font-mono`.
- Headings `text-wrap: balance`; paragraphs `text-wrap: pretty`; reading text max 65ch.
- Inputs 16px below 768px (prevents iOS zoom).
- Sentence case everywhere; no uppercase or wide-tracked labels.

### 2.5 Space, radius, elevation, focus, motion

- **Space:** 4px grid: 4, 8, 12, 16, 20, 24, 32, 40, 48 (`--s-1` ... `--s-12`).
- **Radius lock** (only these five):
  - `--r-xs` 6: calendar chips, segmented thumb, skeleton bars, checkbox
  - `--r-sm` 8: buttons, inputs, nav rows, avatars, Due next inner card
  - `--r-md` 12: cards, framed panel, dropzone, Due next outer bezel, toasts, menus
  - `--r-lg` 16: drawer, dialogs, sheets
  - `--r-pill` 999: pills, badges, count bubbles
  The bezel math: outer 12, padding 4, inner 8.
- **Elevation:** resting surfaces get a 1px border and no shadow. Only floating layers get shadows:
  - `--shadow-pop` (menus, toasts, popovers, tooltips): `0 1px 2px #16181D0F, 0 12px 32px -12px #16181D2E`
  - `--shadow-sheet` (drawer, dialogs, sheets): `0 24px 64px -16px #16181D3D`
  - Dark mode: both become `0 0 0 1px #FFFFFF14` on `--raised`.
- **Focus:** `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`. Use `outline-offset: -2px` inside the sidebar, on full-width rows and on calendar day buttons. Inputs: accent border plus the outline. Never remove an outline without this replacement.
- **Motion:**
  - `--dur-1` 120ms (hover, label fade), `--dur-2` 180ms (press, checkbox, pills, toasts), `--dur-3` 240ms (drawer, sheets, dialogs).
  - `--ease-out: cubic-bezier(.16,1,.3,1)`; `--ease-sheet: cubic-bezier(.32,.72,0,1)`.
  - Press: `transform: translateY(1px)`.
  - Animate only `transform`, `opacity`, `color`, `background-color`, `border-color`, `box-shadow`. Name properties explicitly. Never `transition: all`. Never animate width or height.
  - The sidebar rail switch is instant; only the labels fade over 120ms.
  - View entry: only when the view changes (not on a refresh re-render), the first 8 rows or cards fade up 6px over 180ms with a 40ms stagger via `el.style.setProperty('--i', n)`.
  - `prefers-reduced-motion: reduce`: durations 0.01ms, no transforms, dialogs only fade, skeleton shimmer and check-draw stop.

---

## 3. App shell

### 3.1 Page head (app pages: student, parent, staff, people)

```
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#EEEFF2">
<meta name="robots" content="noindex">
<title>Overview | VP Education Group</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="/portal/js/theme-boot.js"></script>
<link rel="stylesheet" href="/portal/css/app.css?v=1">
<link rel="stylesheet" href="/portal/css/<unit>.css?v=1">   (one line per unit sheet, same list on every app page)
(the exact pinned supabase-js SUPABASE_TAG from tests/unit/portal-pages.test.js)
<script type="module" src="/portal/js/<entry>.js"></script>
```

`theme-boot.js` stays a synchronous classic script and does not change. Pages no longer load `/styles.css`, `/portal/portal.css` or `/theme.js`.

### 3.2 Body markup (static in every app page, so the first paint is never blank)

```
body.app-body
  a.skip-link[href="#main"]  "Skip to content"
  div.app#app
    div.sidebar#sidebar
      div.sidebar-head        brand link, collapse/expand button #rail-toggle
      div#scope-slot          scope switcher or static child block (filled by JS)
      nav#portal-nav[aria-label="Portal"]   5 skeleton bars in static HTML
      div.sidebar-foot        #theme-control, #portal-user, #sign-out
    div.panel
      div.topbar-wrap
        header.topbar         #nav-open (768 to 1023 only), #breadcrumb (ol), #topbar-actions
      main#main[tabindex="-1"]
        div.scroll-sentinel[aria-hidden="true"]
        div#view[aria-busy="true"]   4 skeleton rows + span.visually-hidden "Loading…"
    nav.tabbar#tabbar[aria-label="Shortcuts"]   below 768px only
  div.toasts#toasts[aria-live="polite"]
  p.visually-hidden#route-announcer[aria-live="polite"]
  dialog.drawer#drawer
  dialog.confirm#confirm
  dialog.sheet#nav-sheet      More sheet (phones) and full-sidebar overlay (768 to 1023)
  dialog.switcher#switcher    scope switcher popover / sheet
```

The shell fills the sidebar, tab bar and switcher once `requireRole` resolves and the scope is known. Views render into a fresh child of `#view` (section 4.1).

### 3.3 Layout and scroll model

- `.app` is a grid: `grid-template-columns: var(--nav-w) minmax(0, 1fr)`, `min-height: 100dvh`. `--nav-w` is 248px expanded, 64px rail, 0 below 768px.
- The **document** scrolls at every width. `.sidebar` is `position: sticky; top: 0; height: 100dvh; overflow-y: auto; overscroll-behavior: contain`, with the footer pinned at its bottom (flex column, nav `flex: 1; overflow-y: auto`).
- **1024px and up (framed):** body and sidebar are `--frame`.
  - `.topbar-wrap`: `position: sticky; top: 0; z-index: 20; padding: 8px 8px 0 0; background: var(--frame)`.
  - `.topbar`: 52px, `border: 1px solid var(--line); border-bottom-color: transparent; border-radius: 12px 12px 0 0`, background `--canvas` at 85% with `backdrop-filter: blur(12px)` inside `@supports`, solid `--canvas` otherwise.
  - `main`: `margin: 0 8px 8px 0; border: 1px solid var(--line); border-top: 0; border-radius: 0 0 12px 12px; background: var(--canvas); min-height: calc(100dvh - 68px)`.
  - Content scrolls under the opaque 8px frame strip, so the framed panel's top corners stay put while its side borders run the full height.
- **Below 1024px:** no frame. Body is `--canvas`; `.topbar` is sticky at `top: 0` with no radius; the sidebar (rail) has a 1px `--line` right border.
- **Scrolled hairline:** an IntersectionObserver (root: viewport, `rootMargin: -61px 0 0 0`) watches `.scroll-sentinel`; when it leaves, `.topbar` gets `.is-scrolled`, which sets `border-bottom-color: var(--line)`.
- **Scroll position:** a view change scrolls to the top. A refresh re-render (after a write or `visibilitychange`) keeps `scrollY`. Back and forward scroll to the top.

### 3.4 Sidebar (1024px and up; 248px)

- **Frame:** `--frame`, padding 12px 8px.
- **Brand row (48px):** a 28px `--text` square (radius 8) with "VP" in 12/600 `--frame`; "VP Education Group" in 14/600 over a 12px `--text-3` line: "Student portal", "Family portal", "Tutor workspace" or "Admin workspace". The lockup links to the page's default route. Right side: `#rail-toggle`, a 32px ghost icon button (`sidebar-simple`), `aria-label="Collapse sidebar"` / `"Expand sidebar"`, `aria-expanded`, `aria-controls="sidebar"`. Saves `localStorage['vb-sidebar'] = 'rail'` or removes the key (try/catch; if storage throws, default expanded).
- **Group label:** 12/500 `--text-3`, sentence case, 28px tall, 16px space above, not interactive (`<h2 class="nav-group">` inside the nav, visually small).
- **Nav row:** `<a>` 32px tall, padding 0 8px, 10px gap, radius 8. 16px icon in `--text-3`, label 14/500 `--text-2`, badge right-aligned. Hover: `--hover`, 120ms.
- **Active row** (`aria-current="page"`): lifted pill (`--nav-active`, inset hairline, faint shadow in light), label `--text` 600, icon `--accent-text`.
- **Assignments sub-items:** always expanded (no caret; they are the user's requested tabs). 30px rows, 13/500, no icon, text aligned with the parent label (padding-left 34px). A 1px `--line` guide runs at x = 16px from the parent icon down the sub-items; beside the active sub-item it becomes 2px `--accent`. The active sub-item gets the pill; its parent label turns `--text` 600 without a pill.
- **Badges:** 18px min-width pill, 12/500 `.num`, `--text-2` on `--surface` with 1px `--line-strong` border (`--surface-2` fill on the active row). Hidden at 0; "99+" above 99. The To do badge switches to the danger tone (danger bg/text, no border) when any To do item is overdue; it still shows the To do total. Each badge has visually hidden context, for example "4 to do, 1 overdue".
- **"New" pill:** 12/500 `--accent-text` on `--accent-soft`, text "New", only on Graded and Updates, only for students and parents (section 4.6). A row never shows both a count and "New".
- **Footer:** 1px `--line` top border, 12px padding.
  - Theme control: segmented Light / Dark with `sun` / `moon` icons, `role="group" aria-label="Theme"`, buttons with `aria-pressed`.
  - User row (44px): 32px avatar, name 13/500 (ellipsis), role 12 `--text-3` ("Student", "Parent", "Tutor", "Admin"), and `#sign-out`, a 32px icon button (`sign-out`), `aria-label="Sign out"`, with a tooltip.

### 3.5 Rail (64px) and the 768 to 1023 overlay

- At 1024px and up the user may collapse to the rail. From 768 to 1023 the rail is the only inline mode.
- Rail rows are 44x44 centered icon buttons. Labels stay in the DOM as visually hidden text (clip pattern, never `display: none`), so the accessible name is unchanged. A tooltip (`span.tip`, `aria-hidden="true"`, `--inverse` surface, 12/500) shows on `:hover` and `:focus-visible` after a 400ms `transition-delay`, positioned to the right.
- Sub-items and group labels are hidden (group labels become 1px `--line` separators). The scope switcher becomes a 40px avatar button. The footer becomes an avatar button that opens a small popover (a `<dialog>`) holding the theme control and Sign out.
- Counts become 18px number bubbles at the icon's top-right (12/500 text, same tone rules). No "New" pills on the rail.
- Switching between expanded and rail is instant; labels fade in over 120ms. No width animation.
- **768 to 1023:** `#rail-toggle` reads "Open menu" and opens `#nav-sheet` via `showModal()` as a left overlay, 280px wide, `--frame`, full height, radius 0 16px 16px 0, `--shadow-sheet`, scrim behind. It contains the full expanded sidebar (rendered from the same nav model). Escape, the close button, a backdrop click or any route change closes it and returns focus to `#rail-toggle`.

### 3.6 Navigation by role

Nav is built from a pure model (`nav-model.js`, section 11) so every surface (sidebar, rail, overlay, tab bar, More sheet) shows the same items and counts.

| Role | Sidebar |
|---|---|
| Student | Overview (`house`) `#/overview`; Assignments (`clipboard-text`) `#/assignments/todo` with To do [count], In review [count], Graded [New], Archived; Tasks (`check-square`) `#/tasks` [open count]; Calendar (`calendar-blank`) `#/calendar`; Updates (`chat-circle-text`) `#/updates` [New] |
| Parent | Child block (switcher when 2+ children, static block for one); then the Student items, same routes, read-only |
| Tutor | Group "Workspace": Today (`house`) `#/today`; Review queue (`tray`) `#/review` [count]; Students (`users-three`) `#/students`; Calendar (`calendar-blank`) `#/calendar?scope=all`. Group "Student": scope switcher; then, once a student is selected: Overview (`chart-line-up`) `#/overview`; Assignments with the four sub-items (In review count = actionable groups, section 5.5); Tasks [open count]; Calendar `#/calendar`; Updates |
| Admin | Tutor items, plus group "Admin": People (`identification-badge`) `/portal/people.html#/pending` [pending sign-ups count] |

- For staff, `?student=` persists across Workspace routes so the Student group stays visible; Workspace views ignore it.
- The Workspace Calendar item is current when `scope=all`; the Student Calendar item is current otherwise.
- On `people.html` there is no Student group.
- Before a student is chosen, the Student group shows only the switcher, reading "Choose a student".

### 3.7 Scope switcher (staff; parents with 2+ children)

- **Button:** 44px, `--surface`, 1px `--line`, radius 8: 24px avatar, name 14/500 (ellipsis), `caret-up-down`. `aria-haspopup="dialog"`, `aria-expanded`. A parent with one child sees the same block without the caret and without button semantics (a `div`), so it is always clear whose work is on screen.
- **Popover:** `dialog#switcher` opened with `showModal()`.
  - 768px and up: 280px wide, max-height 60dvh, positioned under the button by setting `dialog.style.top/left` from `getBoundingClientRect()` (JS style properties are allowed), `--raised`, radius 12, `--shadow-pop`, a transparent `::backdrop`.
  - Below 768px: a bottom sheet (full width, radius 16 16 0 0, max-height 80dvh, `padding-bottom: env(safe-area-inset-bottom)`).
- **Contents:** a visually hidden h2 ("Choose a student" / "Choose a child"); a labelled search field ("Find a student"), shown when there are more than 6 entries and focused on open; a `ul` of links. Each link: 24px avatar, name, and for staff a count bubble with hidden text "3 submissions to review". The current entry has `aria-current="true"`.
- **Hrefs:** staff `?student=<id>` plus the current hash if it is a student-scoped route, else `#/overview`. Parent `?child=<id>` plus the current hash. Clicking is intercepted and handled by `app.switchScope(id)` (pushState, abort current view, reload scope data, remount).
- **Keys:** ArrowDown from the search field moves to the first link; ArrowUp/ArrowDown move between links; Home/End jump; typing filters (case-insensitive on name and email); Enter follows; Escape closes (native `cancel`) and focus returns to the button.
- **Invalid ids:** a `?student=` not in the staff member's list is removed with `replaceState`, the route goes to `#/today`, and a toast says "That student isn’t in your list." A `?child=` that isn't linked falls back to the first child (replaceState), matching today.

### 3.8 Top bar and view header

- **Top bar (768px and up):** left, the breadcrumb `ol` in 13/500: ancestors are `--text-3` links, separators are 12px `caret-right` icons in `--text-3` (aria-hidden), the current crumb is `--text` with `aria-current="page"`. Examples: "Assignments / To do" (student); "Maya Chen / Assignments / In review" (parent, staff); "Review queue / Maya Chen / Algebra worksheet 3". Right, `#topbar-actions`: used only by the review page pager.
- **View header:** h1 (`tabindex="-1"`), optional one-line lede in 15/24 `--text-2`, primary action(s) on the right; 24px below. Below 768px the actions wrap under the lede and are full width.
- **Assignments sub-tabs** appear under the view header whenever the sidebar sub-items are not visible: below 1024px, and at 1024px and up while the rail is collapsed. Link tabs, 40px, 14/500, inactive `--text-3`, active `--text` with a 2px `--text` underline and `aria-current="page"`, count shown in `.num`. The row scrolls horizontally inside its own container.
- **Content:** max width 1120px, centered (the calendar view opts out and uses the full panel width). Padding 32px at 1280 and up, 24px from 768 to 1279, 16px below 768 (bottom padding 96px plus `env(safe-area-inset-bottom)` for the tab bar). Overviews use a 12-column grid with 24px gaps and span classes `.span-4 .span-5 .span-7 .span-8 .span-12`; below 1024 every span is 12.
- Titles in rows and cards get `min-width: 0` plus an ellipsis or a 2-line clamp.

### 3.9 Phone layout (below 768px)

- **Top bar** (56px, sticky, `--canvas` 88% with blur under `@supports`, solid otherwise, hairline when scrolled): left, the 28px brand mark (link to default route), or for staff in Student mode a 44px back button (`caret-left`, `aria-label="Back to students"`, to `#/students`); then the view title 16/600 (ellipsis). Right: the scope chip (a 36px pill with a 24px avatar and first name that opens `#switcher` as a bottom sheet) for staff in Student mode and parents with 2+ children.
- **Bottom tab bar:** 64px plus `env(safe-area-inset-bottom)`, `--frame` at 92% with blur, solid fallback, 1px `--line` top border. Five equal link slots, each a 20px icon over a 12/500 label; the active slot gets a 56x28 `--nav-active` pill with an inset hairline and `--accent-text` icon, and `aria-current="page"`. Count bubbles as on the rail.

| Role and mode | Slots |
|---|---|
| Student | Overview, Assignments, Tasks, Calendar, More (Updates) |
| Parent | Overview, Assignments, Calendar, Updates, More (Tasks) |
| Tutor, Workspace mode | Today, Review, Students, Calendar, More |
| Tutor, Student mode | Overview, Assignments, Tasks, Calendar, More (Updates, Today, Review queue, Students) |
| Admin, Workspace mode | Today, Review, Students, People, More (Calendar) |
| Admin, Student mode | Tutor Student mode, More adds People |

  Student mode is active when `?student=` is set and the route is a student-scoped route (overview, assignments, tasks, calendar without `scope=all`, updates).
- **More** opens `#nav-sheet` as a bottom sheet with the full nav model for the role, the theme control, the user row and Sign out.

### 3.10 Theme

`portal/js/theme.js` (new, module) replaces `/theme.js` for the portal:
- `getTheme()` reads `document.documentElement.dataset.theme`.
- `setTheme('light' | 'dark')`: sets `data-theme`, writes `vb-theme` exactly as the landing page does (`'dark'`, or `removeItem` for light), updates `meta[name=theme-color]`, updates `aria-pressed` on every theme control. All storage access in try/catch.
- Listens to the `storage` event so other open portal or landing tabs follow.
- `themeControl()` returns the segmented Light/Dark control.

---

## 4. Routing, data and derived state

### 4.1 Router

Hash grammar: `#/<view>[/<sub>][/<id>][?key=value&...]`. The entity stays in the query string (`?student=`, `?child=`).

- `parseHash('#/assignments/graded?open=12')` returns `{ view: 'assignments', sub: 'graded', id: null, params: { open: '12' } }`. For `#/review/481` it returns `{ view: 'review', sub: null, id: '481', params: {} }`. Each page's route table declares whether the second segment is a `sub` or an `id`.
- `buildHash(route)` is the inverse; params are sorted for stable URLs.
- **Drawer params** are `open`, `focus`, `kind`, `due`. `sameView(a, b)` compares view, sub, id and all non-drawer params.
- The runtime listens to `hashchange` (link clicks) and `popstate` (back/forward, pushState scope switches). Both call one idempotent `sync()` that diffs the new location against the last applied state, so a double event renders once.
- On `sync()`:
  1. If the scope (`?student`/`?child`) changed: abort the current view, close any open dialog, remount.
  2. Else if `sameView` is false: close any open dialog (no history change), abort the current view, mount the new view into a fresh `div.view` that replaces the old one (this replaces `freshSlot`/`freshHost`), scroll to top, set `document.title`, focus the h1 unless this is the first load, announce.
  3. Else (only drawer params differ): open, switch or close the drawer. Never remount the view, never refocus the h1.
- Unknown views, bad subs, and student-scoped routes without a scope normalize with `replaceState` to the page default. Staff student-scoped routes without `?student` go to `#/students`.
- **History:** nav links and row links push. Opening the drawer pushes (the app records `drawerPushed = true`). Closing by Escape, the Close button or a backdrop click calls `history.back()` when `drawerPushed`, otherwise `replaceState` without the drawer params, then closes. Filters that refine the same view (calendar `view`/`m`/`d`, review `filter`, people `role`) use `replaceState`. Scope switches push.
- **Stale work:** each mount gets an `AbortController`. `ctx.signal` aborts on unmount or scope change; views check `ctx.alive()` after every `await` and stop if false. Object URLs, observers and listeners are released in `signal`'s abort handler.

### 4.2 Routes by page

| Page | Routes (default first) |
|---|---|
| `student.html` | `#/overview`; `#/assignments/todo` (default sub) `in-review`, `graded`, `archived`; `#/tasks`; `#/calendar?view=month\|list&m=YYYY-MM&d=YYYY-MM-DD`; `#/updates` |
| `parent.html?child=<id>` | Same routes, read-only. No linked child: only `#/overview` (welcome). |
| `staff.html[?student=<id>]` | Workspace: `#/today` (default without a student), `#/review?filter=all\|draft\|failed\|edited`, `#/review/<submissionId>?filter=...`, `#/students`, `#/calendar?scope=all&view=...&m=...&d=...`. Student-scoped (need `?student`): `#/overview` (default with a student), `#/assignments/<sub>`, `#/tasks`, `#/calendar`, `#/updates?compose=1` |
| `people.html` | `#/pending` (default when anyone is pending), `#/everyone?role=all\|student\|parent\|tutor\|admin` (default otherwise). Search text is never put in the URL. |

Drawer params work on every route that lists items: `open=<taskId>` (detail), `open=<taskId>&focus=submit` (detail scrolled to and focusing the upload section), and for staff `open=new&kind=assignment|task[&due=YYYY-MM-DD]` (create).

Links from outside: People's "Open workspace" is `/portal/staff.html?student=<id>#/overview`. `HOME` in `session.js` is unchanged; a page with no hash gets its default route via `replaceState`.

### 4.3 Titles and announcements

- `document.title` = "<view title> | VP Education Group", with the scope name for staff and parents: "Graded assignments, Maya Chen | VP Education Group". View titles: Overview, To do assignments, Assignments in review, Graded assignments, Archived assignments, Tasks, Calendar, Updates, Today, Review queue, "Review: <assignment title>", Students, Waiting for approval, Everyone.
- After a view change and its first data render, the view calls `ctx.announce(text)`, which writes to `#route-announcer`, for example "Graded assignments, 4 items" or "Review queue, 7 submissions". Refresh re-renders never announce.

### 4.4 Data store (`store.js`)

One cache per scope; every list, badge, calendar and overview reads from it, so counts never disagree with lists.

- `getStudentData(studentId)` returns a cached promise of `{ studentId, loadedAt, tasks, submissions, subsByTask }`.
  - `tasks.select('id, student_id, kind, title, details, due_at, completed_at, created_at, created_by').eq('student_id', studentId)`
  - `submissions.select('id, task_id, student_id, file_type, note, status, error, attempts, status_changed_at, created_at, grade:grades(score, feedback, reviewed_by, reviewed_at, released_at)').eq('student_id', studentId).order('created_at', { ascending: false })`, with `grade` normalized through `one()`.
  - RLS returns a null grade to students and parents for unreleased work, so the same derivation serves every role.
- `getUpdates(studentId)` wraps the existing `loadUpdates`; `staffNames()` stays memoized in `updates-feed.js`.
- `getWorkspace()` (staff only): `{ students, tasks, submissions }`.
  - `profiles.select('id, full_name, email').eq('role', 'student')` (RLS limits tutors to their students)
  - `tasks.select('id, student_id, kind, title, due_at, completed_at, created_at')` (no `details`)
  - `submissions.select('id, task_id, student_id, file_type, status, error, attempts, status_changed_at, created_at, grade:grades(score, reviewed_at, released_at)').order('created_at', { ascending: false })`
  - Loaded once at staff/people page start; it feeds the switcher, Students, Today, the Review queue, the all-students calendar and the Review queue badge. Revisit if a tutor ever has more than 2,000 tasks.
- `getChildren(parentId)` (parent): the existing `parent_students` then `profiles.in(...)` pair.
- `getPendingCount()` (admin): `profiles.select('id', { count: 'exact', head: true }).eq('role', 'pending')`.
- `invalidate(studentId)` clears that student's data and updates cache and the workspace cache, then emits `change`. `invalidateAll()` clears everything.
- `onChange(fn)` returns an unsubscribe. The app subscribes once: on `change` it recomputes nav counts and re-renders the current view as a **refresh** (no entry animation, no h1 focus, no announcement, keeps `scrollY`, restores focus by `data-focus-key`, section 4.8).
- `visibilitychange` to visible: if `loadedAt` is older than 5 minutes, invalidate the current scope; otherwise re-render with a fresh `now` if the business-zone day changed or a minute boundary affects due states.

### 4.5 Assignment buckets (`buckets.js`, pure)

Constants (exported): `ARCHIVE_GRADED_AFTER_DAYS = 21`, `ARCHIVE_MISSED_AFTER_DAYS = 30`, `DUE_SOON_HOURS = 48`, `MAX_SUBMISSIONS = 5`, `DONE_RECENT_DAYS = 14`, `GRADED_RECENT_DAYS = 7`.

For each `kind = 'assignment'` task: `subs` sorted newest first by `created_at` (tie: higher id first); `latest = subs[0]`.

```
no submissions:
  due_at set and now - due_at > 30 days          -> 'archived' (reason 'missed', label "Not turned in")
  otherwise                                      -> 'todo'
latest.grade?.released_at is null                -> 'in-review'   (includes a resubmission after an earlier release)
now - latest.grade.released_at > 21 days         -> 'archived' (reason 'graded')
otherwise                                        -> 'graded'
```

- Elapsed thresholds (21 days, 30 days, 48 hours) are durations and use milliseconds. Calendar stepping never does (section 4.7).
- `completed_at` is ignored for assignments (section 0).
- Late work is always accepted: a student may submit to any assignment with fewer than 5 submissions, including archived "Not turned in" ones, which then move to In review.
- `previousScore`: when the latest submission is unreleased and an earlier one was released, the earlier released score (shown as "Previous score 86").

**Due state** (`dueState`): assignment with any submission, or task with `completed_at`: `done`. Else `due_at` null: `undated`; `due_at < now`: `overdue`; `due_at - now <= 48h`: `soon`; else `upcoming`.

**Groups:**
- To do (and open Tasks): Overdue, Today (due later today, business zone), Next 7 days (tomorrow through today + 6), Later, No due date (a collapsed `<details>` with its count). Sort with `byDue`. Empty groups are omitted.
- In review, families: one flat list, newest submission first.
- In review, staff: four groups by the latest submission's `staffStatus`, in this order: Could not grade, Ready for review (AI draft), Edited, not released, Grading now (Submitted and Grading; a collapsed `<details>`). Oldest submission first within a group.
- Graded: This week (released within 7 days), Earlier (7 to 21 days); newest release first.
- Archived: grouped by month of `released_at` (graded) or `due_at` (missed), newest first.
- Tasks done: "Done" (completed within 14 days, collapsed `<details>`), then a "Show older (N)" button that reveals the rest in place.

**Counts** (`navCounts`): `todo` = To do rows; `todoOverdue` = Overdue group rows; `inReview` = In review rows (families) or rows in the three actionable staff groups (staff; the "Grading now" group shows its own count in its header and is not in the badge); `tasksOpen` = open tasks. The staff **Review queue** badge counts submissions (section 5.8), not assignments; both labels say what they count.

### 4.6 Status (`status.js`, pure)

One function decides every pill, row glyph, chip and accessible label.

`itemStatus(item, { audience })`, `audience` is `'family'` (students and parents) or `'staff'`:

| Bucket / state | Family label | Staff label | Tone | Icon |
|---|---|---|---|---|
| todo, upcoming or undated | To do | To do | neutral | `circle` |
| todo, soon | Due soon | Due soon | warning | `clock` |
| todo, overdue | Overdue | Overdue | danger | `warning-circle` |
| in-review, latest pending or grading | Submitted | Submitted / Grading | info | `hourglass-medium` |
| in-review, latest ai_graded, not reviewed | Submitted | AI draft (dashed) | family info, staff warning | `hourglass-medium` / `pencil-simple-line` |
| in-review, reviewed, not released | Submitted | Edited, not released (dashed) | family info, staff warning | `hourglass-medium` / `note-pencil` |
| in-review, latest failed | Needs attention if `sub.error`, else Submitted (per `familyStatus`) | Could not grade | danger / info | `x-circle` / `hourglass-medium` |
| graded | Graded | Released | success | `check-circle` |
| archived, graded | Graded | Released | success (row glyph is `archive` in neutral solid) | `check-circle` |
| archived, missed | Not turned in | Not turned in | neutral | `minus-circle` |
| task open | To do / Due soon / Overdue | same | as above | as above |
| task done | Done | Done | neutral, title struck through | `check-circle` |

- "Submitted" is the single family word for pending work, used in pills, the drawer, calendar labels and the parent overview. The explanation "Waiting for your tutor to review it." appears once, under the pill in the drawer. `familyStatus` in `labels.js` keeps its signature and tests; its text is no longer shown verbatim.
- `submissionStatus(sub, grade, { audience })` gives the same result for a single attempt (drawer history, review page).
- Students and parents never see "AI draft", "Grading", "Edited", draft scores or `ai_graded`.

### 4.7 Dates (`dates.js`, pure)

- `BUSINESS_TZ = 'America/Los_Angeles'`, `WEEK_START = 0` (Sunday).
- `dayKey(dateOrIso)`: `YYYY-MM-DD` in the business zone via `Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })` `formatToParts`. Never `iso.slice(0, 10)`, never `new Date('YYYY-MM-DD')`.
- Day arithmetic on keys uses UTC calendar math only: `addDays(key, n)` builds `new Date(Date.UTC(y, m - 1, d + n))` and reads `getUTC*`. No local `Date` is ever stepped by 86,400,000 ms.
- `zonedIso(key, 'HH:MM')`: the ISO instant of that wall time in the business zone (guess the UTC instant, read its business-zone wall time with `formatToParts`, correct by the difference, check once more for DST edges).
- `format.js` changes behavior, not signatures: `dueDateToIso(value)` returns `zonedIso(value, '23:59')`; `isoToDateInput(iso)` returns `dayKey(iso)`. The existing round-trip test keeps passing; new tests cover `2026-03-08` (to `2026-03-09T06:59:00.000Z`), `2026-10-14` (to `2026-10-15T06:59:00.000Z`) and `2026-11-01` (to `2026-11-02T07:59:00.000Z`), and must pass under `TZ=Asia/Tokyo` and `TZ=America/New_York`.
- `dueLabel(dueIso, now)` returns `{ text, full, tone }`:
  - Day difference `diff = daysBetween(todayKey(now), dayKey(due))`.
  - Not overdue: 0 "Due today", 1 "Due tomorrow", 2 to 6 "Due Thursday", otherwise "Due Oct 14" (adds ", 2027" when not the current year).
  - Overdue: diff 0 "Due earlier today", -1 "Due yesterday", less than -1 "3 days overdue".
  - A time is appended ("at 3:00 pm") only when the business-zone wall time is not 23:59. When the viewer's zone differs from the business zone at that instant, the time is always appended with " PT" ("Due tomorrow at 11:59 pm PT").
  - `full` (for `title` and accessible labels): "Due Wednesday, October 14 at 11:59 pm Pacific time".
  - `tone`: `'danger'` when overdue, `'warning'` within 48 hours, else `null`.
- `relativeTime(iso, now)`: "Just now", "5 minutes ago", "2 hours ago", "Yesterday", "3 days ago" (to 6 days), then "Oct 5" (plus year when different). `full`: "October 5, 2026 at 4:12 pm". Rendered as `<time datetime title>`.
- `dayHeading(key, today)`: "Today, Wed Oct 14", "Tomorrow, Thu Oct 15", "Fri, Oct 16". `longDate(key)`: "Wednesday, October 14". `monthTitle('2026-10')`: "October 2026".

### 4.8 Focus rules

- Route change (not first load): focus the view h1.
- Refresh re-render: before replacing the view, the app reads `document.activeElement.dataset.focusKey`; after the new view mounts it focuses `[data-focus-key="<key>"]` if present. Views put `data-focus-key` on row links (`row-<taskId>`), task checkboxes (`task-<taskId>`), submission links (`sub-<id>`) and primary buttons that trigger writes.
- Drawer open: focus the drawer title (`h2[tabindex=-1]`), or the dropzone input when `focus=submit`. Drawer close: focus `[data-focus-key="row-<taskId>"]` if present, else the element that was focused before opening, else the h1.
- Confirm dialog: Cancel is autofocused; focus returns to the invoking control.

### 4.9 "New" markers (`seen.js`)

- Keys: `vb-seen-graded-<viewerId>-<studentId>` and `vb-seen-updates-<viewerId>-<studentId>`, storing an ISO timestamp. All access in try/catch; if storage fails, no "New" shows.
- Graded shows "New" when any Graded row's `released_at` is later than the stored timestamp; opening `#/assignments/graded` stores `now`. Updates likewise with `created_at`, stored when `#/updates` opens.
- Students and parents only. Staff never see "New". First visit (no key) shows "New" only for items within the last 7 days.

---

## 5. Views

### 5.1 Shared states

- **Loading:** skeleton rows shaped like the real rows (`--surface-2` bars, radius 6, 1.4s shimmer that stops under reduced motion). The container has `aria-busy="true"` and a visually hidden "Loading…". Never spinners (a busy button shows its "…" label only).
- **Empty:** a dashed 1px `--line-strong` box, radius 12, 40px padding (24px on phones); a 20px icon in a 40px `--surface-2` square (radius 8); one sentence in `--text-2` (max 48ch); one action if there is one.
- **Error:** a callout with `role="alert"`: danger `warning-circle` icon, title 14/600, the fix in `--text-2`, and a "Try again" button that invalidates the scope and re-renders. Copy 10.
- **Rows** (`itemRow`, foundation): full-row `<a>` to the drawer (`open=<taskId>`), 52px min (64px on phones), grid `16px minmax(0,1fr) auto auto 16px`, 12px 16px padding, hairline between rows only (inset 16px). Columns: status glyph (tone solid), title 14/500 (one line, ellipsis) over a 13px `--text-3` meta line, due label (13/500 `.num`, tone-colored only when soon or overdue, `title` = `full`), pill (or score chip for graded), `caret-right` in `--text-3`. Hover `--hover`. The row whose drawer is open gets `--surface-2` and `aria-current="true"`. On phones the grid becomes `16px minmax(0,1fr) 16px`; the title clamps to 2 lines at 15px and the due label and pill wrap under the meta line.
- **Group headers:** 13/600 `--text-2` with the count in `--text-3` `.num`, 32px tall, sticky under the top bar (`top: 60px` framed, `top: 52px` or `56px` otherwise), `--canvas` background. The Overdue header uses danger text and a `warning-circle` icon.

### 5.2 Student Overview (`#/overview`)

- **Header:** h1 in `--t-display`: "Good afternoon, Maya" (morning 5:00 to 11:59, afternoon 12:00 to 16:59, evening otherwise; viewer's local hour). No exclamation mark, no emoji.
- **Lede** (from `overview-model.js`, section 11): work sentence then grade sentence.
  - overdue and due: "1 assignment is overdue and 2 are due this week."
  - overdue only: "1 assignment is overdue." / "2 assignments are overdue."
  - due only: "2 assignments are due this week."
  - neither: "Nothing is due this week."
  - plus, if any Graded row is "New": "1 new grade is ready." / "2 new grades are ready."
- **Row 1** (`.span-8` + `.span-4`):
  - **Due next** (the signature element). Outer bezel: `--surface-2`, radius 12, 4px padding, 1px `--line`. Inner card: `--surface`, radius 8, 20px padding, grid `72px minmax(0,1fr)` with 16px gap.
    - Date block: 72x72, radius 8, month 12/500 `--text-2` ("Oct") over the day in `--t-date`. Fill `--surface-2`; warning bg with warning text when due soon; danger bg with danger text when overdue. Undated: `calendar-blank` icon over "No date" (12/500).
    - Body: pill; title `--t-h2` (2-line clamp); due label; instructions in 15/24 clamped to 2 lines (or omitted); actions.
    - Actions: primary "Submit work" (`open=<id>&focus=submit`) when the student can still submit, with ghost "View details" (`open=<id>`). At the 5-attempt cap: primary "Open assignment" only.
    - Which item: the first To do assignment by `byDue` (oldest overdue first, then soonest, then undated).
    - Below the inner card, still inside the bezel: "After that" (13/600 `--text-2`) and up to 2 compact rows (title, due label), each opening its drawer.
    - Empty: the bezel holds a `check-circle` icon and "Nothing due. Enjoy the break."
  - **Latest grade** card: score in `--t-figure` with "/100" in `--text-3`; the title; "Graded Oct 5"; feedback clamped to 2 lines; "Read feedback" link (`open=<id>`); "New" pill when applicable. Empty: "No grades yet. Grades appear here after your tutor reviews your work."
- **Row 2, This week** (`.span-12`): seven equal columns starting today (rolling). Each column is a link to `#/calendar?view=month&m=<month>&d=<key>`: weekday 12/500 `--text-3`, date 16/600 `.num` (today in a 24px accent circle with `--on-accent`), up to 2 mini chips (section 5.10 chip styles, 20px), then "+N". Its `aria-label` repeats the calendar day label. Phones: a "Next 7 days" list of only the days that have items, each a `dayHeading` over rows; if none, "Nothing due in the next 7 days."
- **Row 3** (`.span-7` + `.span-5`): **Tasks**: up to 5 open tasks with working checkboxes (`taskCheck`), "See all tasks" link; empty "No open tasks." **From your tutor**: the latest 2 updates (`updateItem`, compact), "See all updates"; empty "No notes from your tutor yet."

### 5.3 Parent Overview (`#/overview`)

1. **Header:** h1 `--t-display` "Maya’s week"; lede from `parentSummary`: "Maya has 2 assignments due this week and 1 overdue." / "Maya has 1 overdue assignment." / "Maya has 2 assignments due this week." / "Maya is all caught up."
2. **Progress panel** (`progressPanel`, one card, three metrics separated by 1px vertical hairlines; stacked with horizontal hairlines below 768px). Each metric: 13/500 `--text-2` label, value in `--t-figure`, one supporting line in 13 `--text-2`.
   - "Average score, last 30 days": the rounded average of released scores in the last 30 days. Supporting line: `trend-up`/`trend-down` icon in `--text-2` with "Up 4 from the 30 days before" / "Down 3 from the 30 days before" / "Same as the 30 days before", only when the previous window has a grade; otherwise "Based on 3 grades". No grades ever: value "No grades yet". None in 30 days: value "None this month", line "Last grade Sep 2".
   - "On time": "9 of 10" from `completionStats(tasks).onTime` / `.judged`; line "finished by the due date". Nothing judged yet: "Nothing due yet".
   - "Due this week": "3"; line "1 overdue" in danger text with `warning-circle` when overdue > 0, else "Nothing overdue".
   - Below the metrics, the score chart (section 6) across all released grades; fewer than 2 points: "The chart appears after two graded assignments."
3. **Overdue** (only when overdue > 0): group header in danger text, read-only rows.
4. **Row** (`.span-7` + `.span-5`): **From your tutor**: latest 3 updates, header meta "Last update 2 days ago", "See all updates". **Recently graded**: 3 rows with score chip and the first line of feedback as meta; each opens the read-only drawer.
5. **Coming up** (`.span-12`): the next 7 days as agenda rows under `dayHeading`s.
- When nothing is overdue, nothing is due in 7 days and nothing is new, items 3 and 5 collapse into one calm empty state: "All caught up. Maya has nothing due this week." (copy 7). Recently graded empty: "No graded work yet."
- **No linked child:** nav shows only Overview; the child block is hidden; the view is a full empty state (`envelope-simple` icon): "Your account is ready. Once we link your child’s account, their work shows up here." The tab bar shows Overview and More only.
- Parents never see disabled controls; read-only states are glyphs plus text.

### 5.4 Staff Today (`#/today`) and staff student Overview (`#/overview`)

**Today:**
- h1 `--t-display` "Today"; lede "4 submissions need review across 3 students." or "Nothing needs review right now."
- Admin only, when pending sign-ups > 0: a neutral callout row at the top, "3 people are waiting for approval", button "Review sign-ups" (`/portal/people.html#/pending`).
- Row 1 (`.span-8` + `.span-4`): **Needs review**: the first 5 queue rows (queue order, section 5.8) and "Open review queue (7)". **Due this week**: open items across all students, rolling 7 days, each row with a 24px student avatar and the student's name in the meta line; opens the drawer.
- Row 2 (`.span-12`): **Recently released**: the last 5 releases within 14 days (student, assignment, score chip, "Released 2 days ago").
- Empty (no students): tutor "No students are assigned to you yet."; admin "No students yet. Approve one on the People page."

**Student Overview (staff):**
- Header: 40px avatar, the student's name as h1 (`--t-h1`), email in 13 `--text-3`. Actions: "New assignment" (primary, `open=new&kind=assignment`) and "Post update" (secondary, `#/updates?compose=1`).
- Progress panel (same component and states as the parent).
- Row (`.span-8` + `.span-4`): **Needs review** (this student's queue rows) and **Coming up** (next 7 days).
- **Latest updates**: the 3 newest, with "See all updates".

### 5.5 Assignment lists (`#/assignments/<sub>`)

- h1 is the sub-tab name ("To do", "In review", "Graded", "Archived"); breadcrumb "Assignments / To do". Staff: primary "New assignment" in the header.
- **To do:** groups per 4.5. Meta: the first line of instructions, or "No instructions". Empty (copy 1).
- **In review:** families get a flat list with the lede "Work you’ve submitted waits here until your tutor grades it." (parent: "Work Maya has submitted waits here until the tutor grades it."). Meta: "Attempt 2 of 5, submitted Tue" plus ", previous score 86" when applicable. Staff get the four groups; the staff meta adds a "Draft 84" chip (Mono 12/500 on `--surface-2`) for AI drafts. Empty (copy 2).
- **Graded:** This week / Earlier. Score chip replaces the pill; staff also see the "Released" pill. Meta: first line of feedback. Due column shows "Graded Oct 5". Empty (copy 3).
- **Archived:** always opens with a quiet note (`info` icon, 13 `--text-2`): "Graded work moves here 3 weeks after it’s graded. Work that wasn’t turned in moves here 30 days after it was due." Then groups by month. Leading glyph `archive`; titles in `--text-2` at full opacity. Empty: "Nothing archived yet."
- Rows animate in only on view change.

### 5.6 Item drawer (`open=<taskId>`)

**Container:**
- `dialog#drawer` opened with `showModal()`: focus trap, Escape, inert background for free.
- 1024px and up: 480px wide, full height minus 16px, floating 8px from the top, right and bottom edges, radius 16, `--raised`, `--shadow-sheet`. 768 to 1023: 440px. Below 768: full-screen sheet (radius 0, slides up).
- Enter: `@starting-style { opacity: 0; transform: translateX(24px) }` (phones `translateY(24px)`), 240ms `--ease-sheet`, with `transition-behavior: allow-discrete` on `display` and `overlay`; `::backdrop` fades `--scrim`. Browsers without `@starting-style` open and close instantly. Reduced motion: opacity only.
- Close paths: the Close button (`x` icon, `aria-label="Close"`), Escape (the `cancel` event is prevented and routed to the app's close), and a backdrop click (`click` where `event.target === dialog`; the content wrapper fills the dialog box so inner clicks never match). Each goes through the history rule in 4.1.
- The drawer loads from `getStudentData(scope)`. If the task isn't in the current scope and the viewer is staff (all-students calendar, Today), it finds `student_id` in the workspace data and loads that student. Unknown id: the drawer shows "This assignment isn’t available. It may have been deleted." with a Close button.

**Header (sticky, 56px row):** pill (and "Draft 84" chip for staff) and, for staff, a `dots-three` menu ("More actions for <title>": Edit, Mark done / Mark not done (tasks only), Delete) and Close. Below: kind label 12/500 `--text-3` ("Assignment" / "Task"), title `--t-h2` (`tabindex="-1"`), due line (`dueLabel.full` visible text, tone-colored relative part), "Assigned Oct 2" in 13 `--text-3`. For families with in-review work, under the pill: "Waiting for your tutor to review it."

**Sections** (24px apart, each with an h3):
1. **Instructions:** 15/24 `white-space: pre-wrap`, max 65ch, or "No extra instructions."
2. **Grade** (when the latest released grade exists; staff see the latest grade in any state here as read-only with its pill): a `--surface-2` well, radius 12, 16px padding: score in `--t-figure` "/100", feedback 15/24 pre-wrap, "Graded by Varun on Oct 5" (`reviewed_by` through `staffNames()`, falling back to "Graded Oct 5").
3. **Submit your work** (students only, attempts < 5); titled "Submit another version" when there are earlier attempts:
   - **Dropzone:** a `<label class="dropzone">` 120px tall, 1.5px dashed `--control`, radius 12, `upload-simple` icon, "Choose a file or drop it here", hint "PDF, photo (JPG or PNG) or text file, up to 20 MB." The `<input type="file" accept={ACCEPT}>` inside is visually hidden (clip pattern, not `display: none`) so it stays keyboard-focusable; the label shows the focus ring via `:focus-within`. `dragover` adds `.is-over` (accent border, `--accent-soft` fill); `drop` calls `preventDefault`, assigns `input.files = event.dataTransfer.files` and dispatches `change`, so dropped and chosen files take the same path.
   - **Chosen file:** a row with a file icon, name (ellipsis), size, and a ghost "Remove" button (clears the input, focus back to the input).
   - "Note for your tutor" textarea (optional, 2 rows, maxlength 1000).
   - Primary "Submit work" (`data-focus-key="submit-<taskId>"`), beside it "Attempt 3 of 5" in 13 `--text-3`. While busy: label "Uploading…", `aria-busy`, fixed width, and a 2px indeterminate bar along the top of the section (static bar under reduced motion).
   - **Order is unchanged:** `validateUpload`, `prepareUpload`, `storagePath(studentId, type)`, `storage.upload(..., { contentType, upsert: false })`, `submissions.insert({ task_id, storage_path, file_type, note }).select('id').single()`, `startGrading(id, { keepalive: true })` not awaited, then `invalidate` (redraw), then the success message.
   - **Errors unchanged:** validation messages as returned; errors starting "This photo" pass through; everything else "Your work could not be submitted. Try again, or email it to your tutor." Shown inline in the section with `role="alert"`.
   - **Success:** the drawer stays open and re-renders; an inline success callout (`role="status"`) at the top of Submission history: "Work submitted. Your tutor will review it soon." (copy 5).
   - **At the cap:** a neutral callout replaces the section (copy 6). The reason is always stated.
4. **Submission history** ("Your submissions (2 of 5)" / "Submissions (2 of 5)"): newest first; each entry shows a file icon (`file-pdf`, `image-square`, `file-text`), "Attempt 2", `FILE_LABELS` text, relative time, the status pill (`submissionStatus`), the note (quoted, 13 `--text-2`), and for families with `Needs attention`, the `error` text. Families get no file links. Staff entries are links to `#/review/<submissionId>` with the "Draft 84" chip where relevant.

**By role:** parents see sections 1, 2 and 4. Tasks (kind `task`) show Instructions and, for students, a large checkbox "Mark as done" (`taskCheck`); parents see the done glyph and text.

### 5.7 Create and edit (drawer)

- Opened by `open=new&kind=assignment|task[&due=YYYY-MM-DD]` (staff only; others are normalized away) or by the "Edit" menu item (an in-drawer mode switch, no URL change).
- **Fields:**
  - Type: a radio group styled as a segmented control, "Assignment" / "Task", required; disabled when editing.
  - Student: a select, shown only when there is no selected student (all-students calendar, Today); required.
  - Title: required, maxlength 200.
  - Instructions: textarea, 6 rows, maxlength 5000, optional.
  - Due date: `<input type="date">`, optional, helper "Due at 11:59 pm Pacific time on this date." Prefilled from `due=`; converted with `dueDateToIso`, read back with `isoToDateInput`.
- **Footer** (sticky): Cancel (ghost) and the primary "Create assignment" / "Create task" / "Save changes". Enter in a text field submits.
- **Validation:** empty title shows "Add a title." under the field (`aria-invalid`, `aria-describedby`), focus moves to it. Database errors show inline in a danger callout above the footer.
- **Writes:** `tasks.insert({ kind, title, details, due_at, student_id })`; `tasks.update({ title, details, due_at }).eq('id', id)`. On success: invalidate, toast "Assignment created." / "Task created." / "Changes saved.", then create closes the drawer (history rule) and edit returns to detail mode.
- **Delete** (menu): `confirmDialog` (copy 11, danger "Delete"); `tasks.delete().eq('id', id)`; error code `23503` shows "This assignment has submitted work, so it cannot be deleted." inline in the drawer; success closes the drawer with the toast "Deleted “Algebra worksheet 3”."
- **Mark done / not done** (staff, tasks only): `tasks.update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id)`. Staff never call `set_task_done` (it raises `P0002` for non-students).

### 5.8 Review queue (`#/review`)

- h1 "Review queue" with a count badge; lede "Oldest first. Releasing a grade shows it to the student and their family."
- Segmented filter (`replaceState` on `filter`): All (N), Draft ready (N), Could not grade (N), Edited (N).
- **Needs review** (`needsReview`, unchanged from staff.js): status `ai_graded` or `failed`, and no released grade. These rows are exactly the three groups: Could not grade, Draft ready, Edited, not released (the `staffStatus` partition). The nav badge equals their total.
- Order: groups in that order; oldest submission first within each.
- **Row:** 32px student avatar; student name 14/500 over the assignment title in `--text-2`; meta "Attempt 2 of 5" plus "Newer attempt submitted" when a later submission exists for the task; "Waiting 2 days" (13 `.num`, warning text after 48 hours); "Draft 84" chip when a draft score exists; the pill; `caret-right`. The row links to `#/review/<id>?filter=<current>`.
- **Still grading (N):** a collapsed `<details>` after the groups, listing pending and grading submissions with "Try grading again" buttons where `canRetry` allows (`startGrading`, then invalidate, toast "Grading started." or the returned message in an inline error).
- Empty (copy 9).

### 5.9 Review page (`#/review/<submissionId>`)

- **Data:** `submissions.select('id, task_id, student_id, storage_path, file_type, note, status, error, attempts, status_changed_at, created_at, student:profiles(full_name, email), task:tasks(title, details, due_at), grade:grades(score, feedback, reviewed_by, reviewed_at, released_at)').eq('id', id).maybeSingle()`, plus the task's other attempts from `getStudentData(student_id)`.
- **Top bar:** breadcrumb "Review queue / Maya Chen / Algebra worksheet 3"; right, "3 of 7" (`.num`) with previous and next icon buttons ("Previous submission", "Next submission"), position within the current filter's queue. Hidden when the submission is not in the queue (already released).
- **Layout:** 1280px and up `minmax(0,1fr) 400px`, 24px gap, the editor sticky at `top: 76px`. Narrower: one column, editor last. Phones: the two editor buttons live in a sticky bottom bar above the safe area (the tab bar hides on this route).
- **File panel** (`--surface-2` frame, radius 12): `storage.from('homework').createSignedUrl(path, 3600)`, then `fetch` the URL, `blob()`, `URL.createObjectURL` (the CSP allows `blob:` images; `connect-src` allows the Supabase host). Revoke the object URL on unmount.
  - Images: `<img alt="Submitted work, attempt 2">`, contained to 70dvh; clicking toggles `.is-actual-size` (scrollable).
  - Text: read the first 200 KB (`blob.slice(0, 204800).text()`) into a Mono `<pre>` via `textContent`; if larger, a note "Showing the first part of this file." and "Open file".
  - PDF: a file card with "Open PDF" (`window.open(signedUrl, '_blank', 'noopener')`).
  - Load failure: error callout "We couldn’t load this file. Try again, or open it in a new tab."
  - Below: the student's note (quote block), "Assignment instructions" in `<details>`, and "Other attempts" (links).
- **Editor card** (`--surface`, radius 12, 20px padding):
  - Pill and "Submitted Oct 6 at 4:12 pm, attempt 2 of 5".
  - Draft states: a quiet note "AI draft. Only you can see this until you release it."
  - Failed: a danger callout with `error` and "Try grading again" when `canRetry`; the editor stays usable for manual grading.
  - Score: label "Score", 44px input, Mono 20, `inputmode="decimal"`, "/ 100" suffix; Feedback: label "Feedback for the student and family", 12-row textarea.
  - **Unreleased:** "Save draft" (secondary, `type="submit"`) and "Release to family" (primary, `type="button"`). The form's submit handler only saves a draft (`{ score, feedback }`), so Enter can only ever save a draft. Release validates exactly as today (score 0 to 100, feedback present; inline errors with `aria-describedby`), then `grades.update({ score, feedback, released_at: now })`.
  - **After release:** invalidate; the shell toast "Grade released. Maya’s family can see it now." with Undo for 10 seconds; the editor area shows "Released just now" and a primary "Next in queue" button (or "Back to review queue" when the queue is empty).
  - **Undo** lives in the shell toast, not the view: it runs `grades.update({ released_at: null }).eq('submission_id', id)` from whatever view is current, invalidates, and toasts "Release undone. The grade is a draft again." It survives "Next in queue" and any navigation because `#toasts` is outside the view host. The release is written immediately (closing the tab keeps it).
  - **Released:** read-only score, feedback and "Released Oct 5 by Varun". A `<details>` "Edit or unrelease" holds the editor with "Save changes" (`type="submit"`; keeps the original `released_at`) and "Unrelease" (danger ghost, `type="button"`, `{ released_at: null }`; toast "Grade unreleased. Maya’s family can no longer see it." with Undo that re-releases).
  - No keyboard shortcut releases or unreleases.

### 5.10 Calendar (`#/calendar`)

- **Toolbar:** h2 month title (`--t-h2`, `aria-live="polite"`, `id` unique per mount); previous/next icon buttons labelled with the target ("Previous month, September 2026"); "Today" button; Month / List segmented (`aria-pressed`); staff with a selected student also get "This student / All students". View, month and day live in the hash (`replaceState`); the last-used view is also kept in `localStorage['vb-cal-view']` (try/catch) and used only when the hash has none.
- **Defaults:** Month at 768px and up, List below.
- **Month grid:** native `<table class="cal-month">`, `table-layout: fixed`, always 42 cells (6 weeks, from `monthMatrix`), 1px `--line` grid inside a radius-12 card. `thead` `th scope="col" abbr="Sunday"` "Sun", 12/500 `--text-3`, Sunday first.
  - Cell size: 1280 and up min 112px, 3 chips (or 2 plus "+N more"); 1024 to 1279 min 96px, 2 chips (or 1 plus "+N more"); 768 to 1023 min 80px, 1 chip plus "+N".
  - Each day: one `<button class="cal-day" data-date="YYYY-MM-DD">` with the number in a 24px circle, 13/500 `.num`. Roving tabindex: only the selected day (or today, or the 1st) has `tabindex="0"`.
  - `aria-label` from `dayLabel`: "Wednesday, October 14, today. 2 items: Algebra worksheet, overdue; Read chapter 3, done". Empty: "Wednesday, October 14. Nothing due."
  - Today: `--accent` circle, `--on-accent` number, `aria-current="date"`, cell fill `--surface-2`. Selected: `aria-pressed="true"`, `inset 0 0 0 2px var(--accent)` ring on the cell and `--accent-soft` cell fill.
  - Weekends `--weekend`. Past in-month numbers `--text-3`. Other-month numbers `--text-3` weight 400 (the 1st of an adjacent month reads "Nov 1"); their chips at 55% opacity.
- **Chips** (`aria-hidden="true"`, not focusable, 22px, radius 6, 12/500, ellipsis): a 12px kind icon (`clipboard-text` assignment, `check-square` task) then the title.
  - Open: `--surface-2`, `--text-2`. Due soon: warning bg/text. Overdue: danger bg/text with `warning-circle` in place of the kind icon.
  - Submitted: transparent with 1px `--line-strong` border and `hourglass-medium`. Graded: `check-circle` in `--text-2` on `--surface-2`; staff also see the score. Done task: `--text-3`, struck through.
  - Staff only: AI draft / Edited warning bg with a dashed border and `pencil-simple-line`; Could not grade danger with `x-circle`.
  - All-students scope: chips start with the student's initials in 12/600.
  - One delegated `click` listener on the table: `closest('.chip')` opens that item's drawer; `closest('.cal-more')` selects the day; otherwise `closest('.cal-day')` selects the day.
- **Day panel:** 320px column beside the grid at 1280 and up, below it otherwise. h3 `longDate` ("Wednesday, October 14") and item rows (links, `itemRow`), or "Nothing due this day." With no selected day: "Next 7 days". Staff: an empty selected day shows "New assignment due Oct 14" (`open=new&kind=assignment&due=...`; the Type control can switch to Task).
- **Keyboard** (on day buttons): Left/Right one day; Up/Down one week; Home/End start/end of the week; PageUp/PageDown previous/next month (same day, clamped to the month length); Shift+PageUp/PageDown previous/next year; Enter/Space select. Moving past the visible month re-renders and focuses `button[data-date=...]`. No single-letter shortcuts.
- **List view:** Overdue pinned first; then dated groups with `dayHeading` headers for 30 days from today, then a "Show the next 30 days" button that extends the range in place; then a collapsed `<details>` "No due date (N)". Empty: "Nothing due in the next 30 days."
- **Phone month mode:** 44px square cells, number plus up to 3 dots (6px): open `--text-2`, due soon warning solid, overdue danger solid, submitted hollow (1.5px info ring), graded success solid, done `--text-4`. The selected day's rows list below the grid.

### 5.11 Tasks (`#/tasks`)

- h1 "Tasks"; staff primary "New task" (`open=new&kind=task`).
- Open tasks in the To do groups; then "Done" (last 14 days, collapsed `<details>` with count) and "Show older (N)".
- **Checkbox** (`taskCheck`): a native `<input type="checkbox">` with `appearance: none`, 20px, 1.5px `--control` border, radius 6, inside a 44px hit area (the whole left cell is its `<label>`), `data-focus-key="task-<id>"`. Checked: `--accent` fill with a `check` icon that draws in over 180ms.
- **Toggle:** optimistic. Students call `rpc('set_task_done', { p_task_id, p_done })`; staff call `tasks.update({ completed_at })`. The title strikes through immediately; after 600ms the store is invalidated and the row moves to Done; toast "Marked done." with Undo (reverses through the same call). Unchecking toasts "Marked not done." Failure: revert, inline error under the row "We couldn’t update that task. Try again.", focus back on the checkbox.
- **Parents:** a `circle` / `check-circle` glyph with visually hidden "Not done yet" / "Done"; no input.
- Titles open the drawer. Empty: "No tasks right now. Tasks from your tutor, like reading or practice, show up here."

### 5.12 Updates (`#/updates`)

- h1: student "Notes from your tutor", parent "Updates from your tutor", staff "Updates".
- **Composer** (staff, a card above the feed; focused when `compose=1`): textarea labelled "Write an update for Maya’s family" (6 rows, maxlength 10000), checkbox "Also show to Maya" (`visible_to_student`, off by default), primary "Post update". `updates.insert({ student_id, body, visible_to_student })`; toast "Update posted."; the textarea clears.
- **Feed:** max 680px. Each item: 32px avatar (staff authors: `--accent-soft` with `--accent-text` initials), author 14/500, relative time (`<time>` with `title`), body 15/24 `pre-wrap`. Hairlines between items. Staff see a neutral pill "Family only" (`eye-slash`) or "Shared with Maya" (`eye`).
- **Delete:** authors and admins get a `dots-three` menu with "Delete", then `confirmDialog` ("Delete this update? It will be removed for Maya’s family. This can’t be undone."); `updates.delete().eq('id', id)`; toast "Update deleted."
- Empty: families "No updates yet. Notes from your tutor will appear here."; staff "No updates yet. Post one to keep the family in the loop."
- Opening this view marks updates seen (4.9).

### 5.13 Students (`#/students`, staff)

- h1 "Students"; a search field ("Find a student", filters by name and email in memory; not in the URL).
- Filters and sorting (rules in `portal/js/students-filter-model.js`): toggle chips with counts, All plus "Needs review", "Overdue work" and "No lesson booked" (no upcoming lesson from today through today + 13, Pacific days), one on at a time, each shown only while its count is above zero (the one in use always shows); for the admin a "Tutor" select (All tutors, then each tutor by name); a "Sort by" select (Name A to Z by default, Needs review first, Next lesson soonest, Next due soonest, Recent average low to high, with no-grade students last; ties by name). Chip counts follow the tutor choice, not the search text. Search, filters and sort combine; the count line reads "12 students" or "Showing 3 of 12 students" and is the polite live region. An empty result offers "Clear filters" ("Clear search" when only the search narrows). The filter, tutor and sort are remembered per user in localStorage (`vb-students-view-<userId>`) and survive a refresh re-render; the search text only survives a refresh.
- One row per student (link to `?student=<id>#/overview`, pushState): 32px avatar, name 14/500 over email 13 `--text-3`; "3 to review" count badge; next due (title plus `dueLabel`); last submission (`relativeTime`); 30-day average (Mono, "None" when no grades). At 1024px and up a column grid with a header row of plain text column labels (not a table); below, stacked.
- Empty and error copy as in 5.4 (the existing staff.js strings: "No students are assigned to you yet.", "No students yet. Approve one on the People page.", "No student matches that search.", "Students could not be loaded. Refresh to try again." becomes the standard error callout).

### 5.14 People (`people.html`, admin)

- h1 "People"; link tabs "Waiting for approval (N)" (`#/pending`) and "Everyone" (`#/everyone`).
- `#people-message` (`role="status"`, the aria-live banner) sits above `#people`, outside the re-rendered list, inside the view host. `act()` keeps today's order: on error, `await render()` first, then show the message and `scrollIntoView({ block: 'center' })`; on success show the message, then render.
- **Waiting for approval:** one card per person, oldest first: avatar, name, email, "Signed up Sep 28", pill "Asked to join as parent" (neutral) or "No role requested", the signup note in a `--surface-2` quote block, an "Approve as" select defaulting to the requested role, and "Approve". Approving as admin keeps its confirm ("Make Maya Chen an admin? Admins can see and change everything.", via `confirmDialog`). Empty: "Nobody is waiting."
- **Everyone:** search field (in memory), role segmented filter with counts (All, Students, Parents, Tutors, Admins; `replaceState` on `role`).
  - Rows: avatar, name, email; an inline role select (`aria-label="Role for Maya Chen"`); your own is disabled with the note "You can’t change your own role". A role change keeps its confirm ("Change Maya Chen to parent? Their access changes right away.") and reverts the select on cancel.
  - Students additionally show "Open workspace" (`/portal/staff.html?student=<id>#/overview`) and two link groups, "Tutors" and "Parents": removable chips (`x` icon button, `aria-label="Remove Varun Baskaran"`) and an add select ("Add a tutor" / "Add a parent"). Writes are the existing inserts/deletes on `tutor_students` and `parent_students`.
  - Tutors and parents show a read-only "Students: Maya Chen, Leo Park" / "Children: ..." line; admins show "you" on their own row.

### 5.15 Sign in, sign up, reset (`index.html`, `reset.html`)

- Page: `--frame` background; a 400px column centered with `padding-top: 12dvh`; the brand lockup on top; a Light/Dark icon button at the top right (`aria-label` "Switch to dark mode" / "Switch to light mode").
- Card: `--surface`, 1px `--line`, radius 16, 32px padding (24px on phones).
- h1 (`tabindex="-1"`, 20/600): "Sign in to your portal", "Request an account", "Check your email", "Reset your password", "Choose a new password", "Thanks, Maya".
- Fields 44px with labels above; the form message sits above the full-width primary button. Sign-up's requested role is a radio group styled as three tiles (Student, Parent, Tutor).
- Links under the card: "New here? Request an account", "Forgot your password?", "Back to VP Education Group" (`/`).
- Check-email and waiting panels lead with a 40px `--surface-2` icon square (`envelope-simple`, `hourglass-medium`).
- Every element id used by `auth-page.js` and `reset-page.js` stays. Flows, `route()`, the FRIENDLY error map, validation and focus behavior do not change.

---

## 6. Components (foundation, `ui.js` / `overlays.js` / `app.css`)

- **Buttons:** heights 28 (sm), 36 (default), 44 (auth, phones, `pointer: coarse`). 14/500, radius 8, 16px icon, 8px gap. Primary `--accent` / `--accent-hover`, `--on-accent` text. Secondary `--surface` with 1px `--line-strong`. Ghost transparent, `--text-2`, hover `--hover`. Danger ghost: danger text. Danger solid: confirm dialogs only. Disabled 45% opacity, `cursor: not-allowed`. Busy: `busy(button, label, action)` swaps only the label span, sets `aria-busy="true"`, fixes `style.minWidth` to the current width, restores after.
- **Icon button:** 32px (44px on coarse pointers), always `aria-label`, tooltip on hover and focus.
- **Inputs:** 40px (44px below 768px), `--surface`, 1px `--control`, radius 8, 14px (16px below 768px). Label above in 13/500; hint 12 `--text-3`; "Optional" in 12 `--text-3` after the label. Error: danger border, `warning-circle` plus message linked by `aria-describedby`, `aria-invalid="true"`. Placeholders never replace labels.
- **Select:** a `.select` wrapper with a `caret-down` icon, `appearance: none`, explicit `color` and `background-color` on `select` and `option` in both themes.
- **Segmented control:** `role="group"` with an `aria-label`; `--surface-2` track, 2px padding, 32px tall, radius 8; buttons with `aria-pressed`; selected thumb `--seg-thumb`, 1px `--line-strong`, radius 6. Only for views of the same data (and the theme and Type choices).
- **Tabs:** links, 40px, as in 3.8.
- **Pill:** 22px, radius 999, padding 0 8px 0 6px, 14px icon plus 12/500 label, tone bg/text; `.is-dashed` for staff drafts. Under `forced-colors: active`, pills and chips get `border: 1px solid CanvasText`.
- **Score chip:** 24px, `--surface-2`, Mono 13/500 score and "/100" in `--text-3`.
- **Count badge / bubble:** as in 3.4 and 3.5.
- **Avatar:** up to 2 initials, radius 8, 24 to 40px, `--surface-2`, 1px `--line`, `--text-2` 12/600 (13/600 at 40px). Staff authors in the updates feed use `--accent-soft` / `--accent-text`. No images, no generated hues.
- **Dialogs:** native `<dialog>`, `::backdrop` `--scrim`, `overscroll-behavior: contain`, radius 16, `--raised`, `--shadow-sheet`.
  - `confirmDialog({ title, body, confirmLabel, tone = 'danger' }) -> Promise<boolean>`: 400px (full-width sheet on phones), title 16/600, body 14 `--text-2`, Cancel (autofocused) then the action. Only the action resolves `true`; Cancel, Escape and a backdrop click resolve `false`. Replaces every `confirm()`: role change, admin approval, task delete, update delete.
- **Menu:** `menu({ label, items: [{ label, icon, onSelect, tone }] })`: a button (`aria-haspopup="menu"`, `aria-expanded`) and a `ul role="menu"` of `button role="menuitem"`, `--raised`, radius 12, `--shadow-pop`, 32px items. Arrows, Home/End move; Escape and Tab close; focus returns to the button; a click outside closes.
- **Toasts:** `toast({ text, action: { label, run }, duration })`. Bottom right (24px from the edges), or bottom center above the tab bar on phones; 360px max; `--inverse` / `--on-inverse`, action in `--inverse-action`; radius 12, `--shadow-pop`. 6 seconds, or 10 with an action. Paused on hover and focus-within. At most 3 (oldest removed). Rendered in `#toasts` (outside the view host).
- **Tooltip:** CSS-only `span.tip[aria-hidden="true"]`, `--inverse`, 12/500, radius 6, 400ms delay, `--shadow-pop`.
- **Empty state / error callout / skeleton:** as in 5.1.
- **Score chart** (`scoreChart(series)`, owned by the Overview unit): SVG via `createElementNS` from `chartModel`; guides at the model's gridlines (0, 50, 100) in `--line` with 12px Mono labels; a 1.5px `--text` line, no fill; 4px points with a 2px `--surface` ring; the latest point 6px with its value labelled; a `<title>` in every point; three date labels on the x axis. A visually hidden data table and a caption whose id is generated per render (`chart-caption-<n>`), fixing the fixed id.
- **Icons** (`icon(name, { size = 16, label })`): Phosphor Regular path data (MIT), copied from `@phosphor-icons/core` 2.x `assets/regular/*.svg` into `icons.js` with the license notice in a comment; `viewBox="0 0 256 256"`, `fill="currentColor"`, built with `createElementNS`; `aria-hidden="true"` unless `label` is given (then `role="img"` and `aria-label`). Names: house, clipboard-text, check-square, calendar-blank, chat-circle-text, chart-line-up, tray, users-three, identification-badge, sidebar-simple, list, caret-right, caret-left, caret-down, caret-up-down, x, dots-three, plus, magnifying-glass, upload-simple, pencil-simple, pencil-simple-line, note-pencil, trash, arrow-square-out, arrow-counter-clockwise, sign-out, sun, moon, circle, clock, warning-circle, hourglass-medium, x-circle, check-circle, check, archive, minus-circle, file-text, file-pdf, image-square, eye, eye-slash, envelope-simple, trend-up, trend-down, info. No other icon family, no icon fonts, no emoji.

---

## 7. Accessibility, responsive, dark mode

- **Structure:** skip link; landmarks (`nav` for the sidebar, `nav` for the tab bar with a different label, `main`); one h1 per view (`tabindex="-1"`); headings in order; links navigate, buttons act.
- **Status:** always icon plus word plus tone. Overdue accessible labels include "overdue".
- **Counts:** visually hidden context ("4 to do, 1 overdue", "7 submissions to review", "3 people waiting").
- **Keyboard:** every nav item and control reachable; drawer, sheets, switcher and confirm are native modal dialogs (trap, Escape, restore focus per 4.8); calendar per 5.10; no single-letter shortcuts anywhere.
- **Live regions:** `#toasts`, `#route-announcer`, the calendar month heading, `#people-message`, form messages (`role="alert"` for errors, `role="status"` for success).
- **Touch:** 44px targets and `touch-action: manipulation` below 1024px and on `pointer: coarse`.
- **Responsive checks:** 320, 375, 768, 1024, 1280 and 1440; 200% zoom at 1280. No page-level horizontal scroll; only tab rows and the Students column grid scroll in their own containers. `100dvh`, never `100vh`.
- **Dark mode:** tuned values from section 2 (surfaces lighten with elevation, `#FFFFFF14` edges instead of shadows, desaturated accent and status text, no pure black or white). `color-scheme: dark` on the dark root.
- **Forced colors:** pills, chips, badges and the active nav pill get `CanvasText` borders; focus uses `Highlight`.
- **Reduced motion:** as in 2.5.

---

## 8. Copy

Sentence case, active voice, numerals, curly apostrophes and quotes. No em dashes, no en dashes, no exclamation marks, no "Oops", no "Elevate", "Seamless" or "Unleash", no chains of middle dots (use commas or separate lines). One verb through a flow: "Release to family", then "Grade released".

1. "Nothing to do right now. New assignments from your tutor will show up here." (staff: "Nothing to do right now. Add an assignment for Maya with New assignment.")
2. "Nothing waiting for review. Work you submit stays here until your tutor grades it." (parent: "Nothing waiting for review. Work Maya submits stays here until the tutor grades it."; staff: "Nothing in review for Maya.")
3. "No graded work yet. Grades appear here after your tutor reviews your submission."
4. "Graded work moves here 3 weeks after it’s graded. Work that wasn’t turned in moves here 30 days after it was due."
5. "Work submitted. Your tutor will review it soon."
6. "You’ve used all 5 attempts for this assignment. Message your tutor if you need to send another file."
7. "All caught up. Maya has nothing due this week."
8. "Grade released. Maya’s family can see it now."
9. "No work waiting for review. Submissions appear here once the grader has a draft ready."
10. "We couldn’t load assignments. Check your connection and try again." (same pattern per view: "We couldn’t load the calendar.", "We couldn’t load updates.", ...)
11. "Delete “Algebra worksheet 3”? It will be removed from Maya’s portal. This can’t be undone."
12. "Thanks, Maya. Your account is waiting for approval. You can sign in once an admin approves it."
13. "Needs attention. Your tutor will take a look."
14. "Your account is ready. Once we link your child’s account, their work shows up here."
15. "This assignment has submitted work, so it cannot be deleted."
16. "Release undone. The grade is a draft again."
17. "That student isn’t in your list."

The implementer greps every portal file for U+2014 and U+2013 before each commit.

---

## 9. Preserved behaviours (checklist)

| Behaviour today | Where it lives after the redesign |
|---|---|
| Release button `type="button"`; Enter only saves a draft; released grades re-save keeping `released_at`; release validation (score 0 to 100, feedback required); secondary saves draft or unreleases; released grades read-only with "Edit or unrelease" `<details>` | Review page editor (5.9) |
| Stale-render protection (`freshSlot`, `freshHost`) | Router fresh host per mount + `AbortController` (4.1) |
| `?student=` / `?child=` in the URL; parent child switcher only for 2+ children; no-child welcome | 3.7, 4.2, 5.3 |
| `onChange` reloads picker badges and progress | Store `change` event recomputes nav counts and refreshes the view (4.4) |
| Focus: restore after redraw; file input focus on open; checkbox focus by task id; h1 focus on panel change and student pick | 4.8, 5.6, 5.11, auth unchanged |
| Parent read-only (no submit, no editable checkboxes, no update delete); RLS blocks writes anyway | 5.3, 5.6, 5.11, 5.12 |
| 5-submission cap removes submitting | Drawer callout with the reason (5.6) |
| Upload order and error mapping | 5.6, unchanged steps |
| `23503` delete message; confirms before deleting tasks and updates | 5.7, 5.12 via `confirmDialog` |
| People `act()` resync, message outside the list, scroll to message, role-change confirm with revert, admin-approval confirm, own role disabled | 5.14 |
| Auth routing, FRIENDLY map, sign-up validation, forgot-password answers, reset checks | 5.15, logic untouched |
| `HOME` role routing; `requireRole` halting | `session.js` unchanged except removing `NAV` and `mountHeader` |
| `vb-theme` semantics; theme boot before paint | `theme-boot.js` unchanged; `portal/js/theme.js` (3.10) |
| Only released grades count toward progress, even for staff | `progressPanel` filters `released_at` (5.3) |
| Students cannot open their own files | No file links for families (5.6) |
| CSP rules and tests | Section 10 |

---

## 10. Do not

- Change `index.html`, `styles.css`, `/theme.js` or any landing asset, or load `/styles.css` or `/theme.js` in the portal.
- Use `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` anywhere under `portal/`, not even in a comment. No inline `<script>` or `<style>`, no `style=""`, no `setAttribute('style', ...)`. Dynamic values go through `el.style.prop`, `el.style.setProperty('--x', v)` or classes. All database text through `textContent` (`h()` does this).
- Load fonts from anywhere but Google Fonts, scripts from anywhere but self and the pinned jsdelivr supabase-js, images from anywhere but self, `data:` and `blob:`.
- Show "AI draft", "Grading", "Edited", draft scores or `ai_graded` to students or parents. Let Enter or any shortcut release a grade.
- Use the accent outside the whitelist (2.1), add a sixth status hue, or color scores by value.
- Put shadows on resting cards, nest cards, use gradients (other than the skeleton shimmer), glass, glow, identical stat tiles, welcome banners, eyebrow labels or middle-dot chains.
- Show a zero badge, put a count and "New" on the same row, compute a badge from a different query than its list, or mix dots and numbers in navigation.
- Nest navigation deeper than two levels, or use segmented controls to switch between sections.
- Make a month grid the only calendar on phones, key days with `iso.slice(0, 10)`, parse `new Date('YYYY-MM-DD')`, or step days by 86,400,000 ms.
- Use spinners for content, blank containers, raw ISO timestamps, `100vh`, `transition: all`, or width/height animation.
- Put personal data (names, emails, search text) in the URL beyond the existing `?student=` / `?child=` ids.

---

## 11. Implementation plan

The build runs in three phases: **Foundation** (one engineer, sequential), **Units** (parallel, each on its own files), **Integration** (one engineer). Units never edit foundation files; if a unit needs a foundation change, it asks the foundation owner. Units never edit each other's files; the few cross-unit imports go through stub files the foundation creates with final signatures.

Conventions for every unit:
- CSS goes in the unit's own sheet under `portal/css/`, with class names prefixed by the unit (`asg-`, `tsk-`, `cal-`, `ovw-`, `upd-`, `rvw-`, `stu-`, `ppl-`, `auth-`). Tokens only; no raw hex.
- Pure logic goes in its own module with tests in `tests/unit/<module>.test.js` (Vitest, node environment, no DOM).
- Views export `mount(ctx)` and render only into `ctx.host`.
- Every view handles loading, empty and error states and checks `ctx.alive()` after each await.

### 11.1 Foundation (one engineer, first)

Order: F1, then F2 to F4 (independent), then F5 to F9, then F10.

**F1. Pure domain modules + tests**
- `portal/js/dates.js`: `BUSINESS_TZ`, `WEEK_START`, `dayKey(v)`, `todayKey(now)`, `parseKey(key) -> {y, m, d}`, `addDays(key, n)`, `weekday(key)`, `daysBetween(a, b)`, `zonedIso(key, time = '23:59')`, `businessTime(iso) -> { key, hour, minute }`, `viewerIsInBusinessZone(now)`, `dueLabel(dueIso, now) -> { text, full, tone }`, `relativeTime(iso, now) -> { text, full }`, `dayHeading(key, today)`, `longDate(key)`, `monthTitle(ym)`.
- `portal/js/format.js`: change `dueDateToIso` and `isoToDateInput` bodies to use `zonedIso` / `dayKey` (signatures unchanged); extend `tests/unit/format.test.js` with the DST cases in 4.7.
- `portal/js/buckets.js`: constants in 4.5; `sortSubs(subs)`, `bucketOf(task, subs, now)`, `archiveReason(task, subs, now)`, `dueState(task, subs, now)`, `deriveItems(tasks, subs, now, { audience, canSubmit }) -> Item[]` where `Item = { task, subs, latest, grade, previousScore, bucket, archiveReason, dueState, attempts, canSubmit }`, `groupTodo(items, now)`, `groupInReviewStaff(items)`, `groupGraded(items, now)`, `groupArchived(items)`, `groupTasks(items, now) -> { open, doneRecent, doneOlder }`, `navCounts(items, { audience })`.
- `portal/js/status.js`: `TONE_OF` (labels tone to status tone), `itemStatus(item, { audience }) -> { key, label, tone, icon, dashed }`, `submissionStatus(sub, grade, { audience })`.
- `portal/js/router.js` (pure part): `parseHash(hash, table)`, `buildHash(route)`, `sameView(a, b)`, `DRAWER_PARAMS`.
- `portal/js/nav-model.js`: `navModel({ role, page, scope, route, counts, fresh }) -> { groups: [{ label, items: [{ key, label, icon, href, current, badge: { n, tone, context } | null, isNew, children }] }], tabbar: [...], more: [...] }`.
- `portal/js/seen.js`: `seenKey(kind, viewerId, studentId)` (pure), `getSeen(...)`, `markSeen(...)` (storage, try/catch).
- Tests: `dates.test.js`, `buckets.test.js` (every rule in 4.5, including resubmission after release, 21/30-day edges, late submission to a missed item, families with null grades), `status.test.js` (every row of the 4.6 table for both audiences; no family label ever equals "AI draft", "Grading" or "Edited, not released"), `router.test.js`, `nav-model.test.js` (per role, per mode, badge rules, zero hidden, "99+", never count and New together), `seen.test.js`.

**F2. Stylesheet**: `portal/css/app.css`: reset, tokens (both themes), base typography, focus, motion and reduced motion, layout shell (3.3 to 3.9), all components in section 6, rows and group headers (5.1), skeletons, empty and error states, dialogs, drawer container and animation, sheets, switcher, toasts, tooltips, forced colors. Creates empty unit sheets with a header comment: `portal/css/{assignments,tasks,calendar,overview,updates,review,people,auth}.css`. Adds `tests/unit/contrast.test.js` that parses the token blocks in `app.css` and asserts every pair in 2.3.

**F3. Icons**: `portal/js/icons.js`: `icon(name, { size, label })`, `ICON_NAMES`.

**F4. UI helpers**: `portal/js/ui.js`: `button({ label, variant, size, icon, type, href, onClick, ariaLabel, focusKey })`, `iconButton({ icon, label, onClick })`, `busy(button, label, action)`, `pill(status)`, `scoreChip(score)`, `badge({ n, tone, context })`, `newPill()`, `avatar(name, { size, staff })`, `itemRow(item, { audience, href, showStudent, studentName, variant, meta })`, `groupHeader({ label, count, tone, icon, collapsible })`, `emptyState({ icon, text, action })`, `errorCallout({ title, text, onRetry })`, `skeletonRows(n)`, `segmented({ label, options, value, onChange })`, `linkTabs(items)`, `field({ label, hint, optional, control, error })`, `select({ label, options, value })`, `timeEl(iso, now)`, `visuallyHidden(text)`. `portal/js/overlays.js`: `confirmDialog(opts)`, `toast(opts)`, `menu(opts)`, `tooltip(el, text)`. `dom.js` keeps `h`, `clear`, `showMessage`, `withBusy` (and `section` until integration).

**F5. Theme**: `portal/js/theme.js` (3.10).

**F6. Store**: `portal/js/store.js` (4.4): `getStudentData(id)`, `getUpdates(id)`, `getWorkspace()`, `getChildren(parentId)`, `getPendingCount()`, `invalidate(id)`, `invalidateAll()`, `onChange(fn)`, `itemsFor(data, { now, audience, viewerId })` (calls `deriveItems`).

**F7. Router runtime and app**: `portal/js/router.js` runtime `startRouter({ table, onSync }) -> { current(), go(url, { replace }), setParams(params, { replace }), openDrawer(taskId, extra), closeDrawer() }`. `portal/js/app.js`: `startApp(config)`, where `config = { me, page, audience, table, defaultRoute(scope), loadScope(), drawer }`. It builds the shell, resolves the scope, subscribes to the store, handles `visibilitychange`, titles, announcements, focus rules and view mounting. The context each view receives:
```
ctx = {
  host, me, role, page, audience, readOnly,
  scope: { student } | null,          // student profile for student/parent/staff-with-student
  route: { view, sub, id, params },
  now, signal, alive(),
  store,                              // the store module
  setHeader({ title, lede, actions, crumbs, docTitle, tabs }),
  setTopbarActions(nodes),
  announce(text),
  open(taskId, extra), openNew({ kind, due }), go(hash, { replace }), setParams(params, { replace }),
  toast, confirm,
  isRefresh                            // true on refresh re-renders
}
```

**F8. Shell**: `portal/js/shell.js`: `mountShell({ me, page }) -> { setNav(model), setScope({ kind, current, options, onSwitch }), setCrumbs(crumbs), setTopbarActions(nodes), setMode('workspace' | 'student'), viewRoot }`, covering the sidebar, rail, 768 to 1023 overlay, tab bar, More sheet, switcher, theme control, user row and sign out.

**F9. Drawer host**: `portal/js/drawer.js`: `initDrawer({ render })`, `showDrawer(dctx)`, `hideDrawer()`. It owns the dialog lifecycle, animation, close paths, history rule and focus. The drawer renderer receives:
```
dctx = { body, header, taskId | 'new', params, me, role, audience, readOnly, scope, now, signal,
         setTitle(text), close(), store, toast, confirm, go }
```

**F10. Pages and entry modules**
- Rewrite `portal/student.html`, `portal/parent.html`, `portal/staff.html` and `portal/people.html` with the head in 3.1 (linking `app.css` and every unit sheet) and the body in 3.2.
- Rewrite entry modules `portal/js/student.js`, `parent.js`, `staff.js` and `people.js`: `requireRole`, then `startApp` with the page's route table (4.2) and `drawer: renderItemDrawer`.
- Create stub modules with final signatures, each rendering its h1 and an empty state "This view is being built." (removed by its unit):

| Stub file | Signature | Owner |
|---|---|---|
| `portal/js/views/overview.js` | `mount(ctx)` | U4 |
| `portal/js/views/assignments.js` | `mount(ctx)` | U1 |
| `portal/js/item-drawer.js` | `renderItemDrawer(dctx)` | U1 |
| `portal/js/views/tasks.js` | `mount(ctx)` | U2 |
| `portal/js/task-check.js` | `taskCheck(item, ctx, { size = 'md' }) -> HTMLElement` | U2 |
| `portal/js/views/calendar.js` | `mount(ctx)` | U3 |
| `portal/js/progress-panel.js` | `progressPanel({ items, tasks, grades, name, now }) -> HTMLElement`, `scoreChart(series) -> HTMLElement` | U4 |
| `portal/js/views/updates.js` | `mount(ctx)` | U5 |
| `portal/js/views/today.js`, `views/review-queue.js`, `views/review.js` | `mount(ctx)` | U6 |
| `portal/js/review-row.js` | `queueRow(sub, { studentName, taskTitle, attempt, total, newer, now, filter }) -> HTMLElement` | U6 |
| `portal/js/views/students.js`, `views/people.js` | `mount(ctx)` | U7 |

- `session.js`: delete `NAV` and `mountHeader` (no callers remain).
- Old modules (`student-view.js`, `staff-tasks.js`, `staff-submissions.js`, `staff-updates.js`, `progress-view.js`) and `portal/portal.css` stay on disk, unreferenced, until integration.
- Exit criteria: `npm test` passes; each app page loads at 375, 768 and 1280 in both themes, shows the shell with correct nav, counts and switcher from real data, routes between stubs, opens and closes a stub drawer with correct history and focus, and shows a toast and a confirm dialog.

### 11.2 Parallel units

Each unit lists the files it owns, public functions, data it needs, and the foundation pieces it uses.

**U1. Assignments, item drawer, create/edit, upload**
- Owns: `portal/js/views/assignments.js`, `portal/js/item-drawer.js`, `portal/js/item-form.js`, `portal/js/submit-work.js`, `portal/css/assignments.css` (lists, drawer sections, dropzone, form).
- Public: `mount(ctx)`; `renderItemDrawer(dctx)`; `itemForm(dctx, { task = null, kind, due, studentOptions }) -> HTMLElement`; `submitWorkSection(dctx, item) -> HTMLElement`.
- Data: `getStudentData`, `getWorkspace` (student lookup for staff), `staffNames()`; writes `tasks.insert/update/delete`, Storage upload, `submissions.insert`, `startGrading`.
- Uses: buckets, status, dates, ui (`itemRow`, `groupHeader`, `pill`, `scoreChip`, `field`, `busy`, `emptyState`, `errorCallout`), overlays (`confirmDialog`, `toast`, `menu`), icons, drawer host, `upload.js`, `labels.js` (`FILE_LABELS`), `taskCheck` (for task-kind drawers; stub until U2 lands).
- Tests: none new beyond F1 (logic is in buckets/status); manual QA per 5.5 to 5.7.

**U2. Tasks**
- Owns: `portal/js/views/tasks.js`, `portal/js/task-check.js`, `portal/css/tasks.css`.
- Public: `mount(ctx)`; `taskCheck(item, ctx, { size })`.
- Data: `getStudentData`; writes `rpc('set_task_done')` (students) or `tasks.update({ completed_at })` (staff).
- Uses: `groupTasks`, status, dates, ui, overlays (`toast` with Undo), icons.

**U3. Calendar**
- Owns: `portal/js/calendar-model.js` (pure), `portal/js/views/calendar.js`, `portal/css/calendar.css`, `tests/unit/calendar-model.test.js`.
- Public (pure): `monthMatrix(ym, weekStart = 0) -> Cell[42]` (`{ key, inMonth, weekday, isWeekend }`), `shiftMonth(ym, n)`, `itemsByDay(items) -> { byDay: Map, undated: Item[] }`, `moveKey(key, keyName, { shift }) -> key`, `capacityFor(width) -> number`, `chipsFor(dayItems, capacity) -> { shown, more }`, `dayLabel(key, dayItems, today, audience)`, `agendaGroups(items, today, { days = 30 })`, `dotsFor(dayItems)`.
- Public (view): `mount(ctx)`.
- Data: `getStudentData` (scoped) or `getWorkspace` (scope=all); student names from the workspace for initials.
- Uses: dates, buckets, status, ui (`itemRow`, `segmented`, `emptyState`), icons, `ctx.open` / `ctx.openNew`.
- Tests: 42 cells for every month of 2026 (February 2026 starts Sunday; May and August 2026 need 6 rows); keys across the Nov 1, 2026 DST change; `moveKey` for all APG keys, including month-end clamping (Jan 31 PageDown to Feb 28) and year shifts; `dayLabel` wording; agenda range and "No due date".

**U4. Overviews and progress**
- Owns: `portal/js/overview-model.js` (pure), `portal/js/views/overview.js` (student, parent and staff-student variants chosen by `ctx.page` and `ctx.role`), `portal/js/progress-panel.js`, `portal/css/overview.css`, `tests/unit/overview-model.test.js`.
- Public (pure): `greeting(now)`, `studentLede({ overdue, dueThisWeek, newGrades })`, `parentSummary(firstName, { overdue, dueThisWeek })`, `scoreWindow(grades, now) -> { avg, prevAvg, delta, count, lastAt }`, `dueNext(items)`, `weekStrip(items, today)`, `lastUpdateLabel(updates, now)`.
- Public (DOM): `mount(ctx)`, `progressPanel(...)`, `scoreChart(series)`.
- Data: `getStudentData`, `getUpdates`, `staffNames()`, seen state for "New"; for staff student overview, queue rows from the student's submissions.
- Uses: buckets, status, dates, progress.js (`completionStats`, `scoreSeries`, `average`, `chartModel`), ui, icons, `taskCheck` (U2 stub), `updateItem` (U5), `queueRow` (U6 stub).
- Tests: every lede and summary template; 30-day window edges and deltas; `dueNext` ordering (oldest overdue first, undated last).

**U5. Updates**
- Owns: `portal/js/views/updates.js`, `portal/js/updates-feed.js` (rewrite internals; keep `staffNames()`, `loadUpdates(studentId)` and `updateItem(update, names, { showAudience, onDelete, compact, studentFirstName })` signatures), `portal/css/updates.css`.
- Public: `mount(ctx)`, `updateItem(...)`.
- Data: `getUpdates`, `staffNames()`; writes `updates.insert`, `updates.delete`.
- Uses: ui (`avatar`, `timeEl`, `pill`, `field`, `busy`), overlays (`menu`, `confirmDialog`, `toast`), seen.js, icons.

**U6. Staff workspace: Today, Review queue, Review page**
- Owns: `portal/js/review-model.js` (pure), `portal/js/review-row.js`, `portal/js/grade-editor.js`, `portal/js/file-preview.js`, `portal/js/views/today.js`, `portal/js/views/review-queue.js`, `portal/js/views/review.js`, `portal/css/review.css`, `tests/unit/review-model.test.js`.
- Public (pure): `needsReview(sub)`, `queueGroups(subs, filter) -> [{ key, label, items }]`, `stillGrading(subs)`, `waitingLabel(sub, now) -> { text, tone }`, `attemptInfo(sub, taskSubs) -> { n, total, newer }`, `neighbors(queue, id) -> { index, total, prevId, nextId }`, `recentlyReleased(subs, now, { days = 14, limit = 5 })`.
- Public (DOM): `mount(ctx)` for each view; `queueRow(...)`; `gradeEditor(sub, grade, { onSaved, onReleased, onUnreleased }) -> HTMLElement`; `filePreview(sub, { signal }) -> HTMLElement`.
- Data: `getWorkspace`, `getStudentData`, the review-page query in 5.9, Storage `createSignedUrl`, `grades.update`, `startGrading`, `staffNames()`, `getPendingCount()` (admin callout on Today).
- Uses: labels.js (`staffStatus`, `canRetry`), status, dates, ui, overlays (toast with the shell-level Undo), icons.
- Tests: the `needsReview` partition equals the three groups for every combination of status, `reviewed_at` and `released_at`; ordering; filters; waiting tone at exactly 48 hours; neighbors at the ends.

**U7. Students and People**
- Owns: `portal/js/views/students.js`, `portal/js/views/people.js`, `portal/css/people.css` (also styles Students).
- Public: `mount(ctx)` for each.
- Data: `getWorkspace` (students, counts, next due, last submission, 30-day average); People: the three existing queries, `profiles.update({ role })`, inserts and deletes on `tutor_students` / `parent_students`, `getPendingCount()`.
- Uses: ui (`avatar`, `badge`, `segmented`, `linkTabs`, `select`, `emptyState`), overlays (`confirmDialog`), dates, `showMessage` from dom.js (keeps the `act()` contract), icons.

**U8. Auth pages**
- Owns: `portal/index.html`, `portal/reset.html`, `portal/js/auth-page.js`, `portal/js/reset-page.js`, `portal/css/auth.css`.
- Changes: new head (3.1, linking `app.css` and `auth.css` only), markup per 5.15 with every id kept, the portal `theme.js` icon toggle instead of `/theme.js`, icons via `icons.js`. Logic unchanged.
- Uses: app.css tokens and components, theme.js, icons.

### 11.3 Integration (one engineer, last)

1. Delete `student-view.js`, `staff-tasks.js`, `staff-submissions.js`, `staff-updates.js`, `progress-view.js`, `portal/portal.css`, and `section` in `dom.js` if unused. `grep` confirms no references.
2. Add `tests/unit/portal-shell.test.js`:
   - No portal page references `/styles.css`, `/theme.js` or `portal.css`.
   - App pages contain `viewport-fit=cover`, `#main`, `#portal-nav`, `#toasts`, `#route-announcer`, `dialog#drawer`.
   - The only font URL is the Geist URL in 2.4.
   - No portal file contains U+2013.
   - The existing `portal-pages.test.js` stays as it is.
3. Run `npm test` normally and with `TZ=Asia/Tokyo` and `TZ=America/New_York`.
4. **Design review:** screenshots at 375, 768, 1024 and 1280 in light and dark for every view and role, plus hover, focus, empty, loading, error, drawer open, confirm, toast, rail, More sheet and switcher states. Check there is no horizontal scroll at 320px or at 200% zoom, contrast (re-run the contrast test), keyboard paths (nav, switcher, calendar, drawer, menus), and reduced motion. Fix, then re-screenshot.
5. **Behaviour pass against section 9**, including:
   - Enter never releases.
   - Undo after "Next in queue".
   - Late submission to a "Not turned in" item.
   - A parent with two children has separate "New" states.
   - Staff "Mark done" uses `tasks.update`.
   - Switching student mid-load never paints the old student.
6. Bump every `?v=` on changed CSS and JS links.

### 11.4 New pure helpers that must have unit tests

`dates.js`, `buckets.js`, `status.js`, `router.js` (parse/build/sameView), `nav-model.js`, `seen.js` (key builder), `calendar-model.js`, `overview-model.js`, `review-model.js`, plus the changed `format.js` functions and the token contrast check. Existing pure modules (`format.js`, `progress.js`, `labels.js`, `upload.js`) and `grading.js` and `session.js` (minus `NAV`/`mountHeader`) keep their exports and tests.
