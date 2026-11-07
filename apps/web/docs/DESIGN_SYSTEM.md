# EVENTRA design system — "Run Sheet"

EVENTRA borrows its visual language from live-event production: run-of-show
sheets, timecodes, and stage **cue lights** (amber = standby, green = go,
red = hold). The app is a warm **paper** sheet on an **ink** frame, with one
crimson brand signal.

## Colour roles

| Family    | Use it for                                   | Legacy classes remapped to it          |
|-----------|----------------------------------------------|----------------------------------------|
| `ink`     | Text, borders, surfaces, primary buttons     | slate, gray, zinc, neutral, stone      |
| `cue`     | Brand, critical / hold, destructive          | rose, red, pink                        |
| `go`      | Confirmed, healthy, live, executed           | emerald, green, lime                   |
| `standby` | Waiting, needs attention, pending            | amber, yellow, orange                  |
| `agent`   | ✦ AI proposals, interpretation, agent work   | indigo, violet, purple, fuchsia        |
| `engine`  | ✓ Deterministic verification and calculation | cyan, teal                             |
| `info`    | ◎ External sources, neutral info             | blue, sky                              |

Write new code with the semantic names (`text-ink-600`, `bg-go-50`); legacy names
still work because of the remap in `tailwind.config.ts`.

**Primary buttons are ink, not crimson.** Crimson (`btn-cue`) is reserved for
the single most important action on a screen (start discovery, approve, go
live) and for critical states.

## Provenance (non-negotiable)

Every fact shows where it came from, using `components/v2/ProvenanceBadge`:
✦ Agent · ✓ Engine · ◎ Source · ● Human · ▲ Executed · ? Unknown. Do not invent
values; show unknowns as unknown.

## Type

- `font-display` (Archivo, condensed with `font-stretch: 85–90%`): page titles,
  big numbers, stage names.
- `font-sans` (Instrument Sans): UI and body.
- `font-mono` (JetBrains Mono): timecodes, IDs, counts, `.eyebrow` labels.

## Building blocks

- CSS: `.surface`, `.surface-sunk`, `.surface-ink`, `.eyebrow`, `.chip`,
  `.cue-light`, `.btn-primary`, `.btn-cue`, `.btn-secondary`, `.btn-ghost`,
  `.ruled`, `.stagger`, `.bg-dots`, `.grain`.
- React (`components/ds`): `PageHeader`, `Panel`, `Stat`, `CueChip`,
  `EmptyState`, `KeyValue`, `Meter`, `Segmented`.

## UX rules (v2)

- **One vendor journey, one vocabulary** (`lib/journey.ts`): Save → Pick →
  Approve & contact → Request booking. Never use "Select", "Contract",
  "Shortlist" as button labels. Each card shows only its *next* step as the
  primary button; everything else is secondary or in a menu.
- **Say it once.** A screen states "this needs you" in one place only. Other
  surfaces show status, not repeated calls to action.
- **No machine output.** Use `lib/humanize.ts` (humanizeCode, humanizeCategory,
  humanizeActor, humanizeAction, describeFacts, stripIds, shortId, formatMoney,
  timeAgo). UUIDs, raw JSON and SCREAMING_CODES only appear inside a collapsed
  "Technical details" disclosure.
- **Every problem has a next action** (a button/link that goes to where it is
  fixed). Never show a blocker without a way forward.
- **Don't show empty placeholders** like `--:--` or `00:00` for unknown times;
  omit them or say "Not scheduled".

## Motion (`components/ds/motion.tsx`)

`PopCard` (spring in + hover lift), `StaggerList`, `PresenceItem` +
`AnimatePresence` (rows animate out when handled), `AnimatedNumber`
(count-up), `Reveal` (on scroll), `Celebrate` (success burst after an action),
`Toast`. Use motion to explain change — new items pop in, handled items fly
out, numbers count — not as decoration. All respect reduced motion.

## Rules of thumb

- One accent per screen. Most surfaces are paper and ink.
- Radii: controls `rounded-lg`, cards `rounded-xl`, large hero blocks `rounded-2xl`.
- Pages are dense but calm: 24px gaps between panels, 16–20px padding inside.
- Motion is purposeful: `animate-rise-in`, `.stagger`, and `animate-cue-blink`
  only on things that are actually live. Everything respects reduced motion.
- No fake controls, sci-fi copy ("operator clearance", "detonate"), or
  invented numbers.
