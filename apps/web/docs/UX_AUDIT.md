# EVENTRA — UX research, audit & strategy

_Stage 1 deliverable · 7 Nov 2026 · based on the `redesign/ui-v3` branch, the live API (11 events), and a full read of `apps/web` and `apps/api`._

**How to read this.** Every finding is tagged with what actually exists:
**[Built]** works end-to-end · **[Partial]** exists with real gaps · **[Mock]** simulated / fake · **[Missing]** no backend support · **[FE bug]** frontend defect.
Nothing here assumes a capability the code doesn't have.

---

## 0. The one-paragraph verdict

EVENTRA's backend is genuinely capable — deterministic planning, real WhatsApp + AI voice outreach, approvals with WhatsApp YES/NO, an incident → impact → recovery → verification engine. The organizer can't feel most of it. The product is organised around **features** (agent runs, engines, streams, provenance) instead of around **the organizer's question: "will my event happen, and what do I need to do?"** Trust is undermined in small but fatal ways: a login that doesn't log anyone in, screens that show "nothing here" when the server failed, a fake team list, demo events mixed into real ones, and no visible signal when vendors are being contacted in mock mode. Fixing honesty and the core loop matters far more than more visual polish.

---

## 1. What an organizer actually needs (the lens)

From the organizer's side, every screen should answer one of six questions:

| # | Organizer question | Where EVENTRA answers it today |
|---|---|---|
| Q1 | Will my event happen? | Nowhere directly. Plan "readiness" (READY/BLOCKED) is the closest real signal, buried in Plan. |
| Q2 | What needs me right now? | Overview "Needs you" (new) — but approvals, picks and problems are also spread over 5 other surfaces. |
| Q3 | Where is my money going? | Budget page shows totals only; per-category estimate vs quote vs committed exists in the API but isn't shown as a story. |
| Q4 | Can I trust this vendor / this number? | Source tags exist; score breakdown is **not stored** by the backend; OSM capacities are guessed. |
| Q5 | What did EVENTRA do on my behalf? | Activity streams exist (3 of them) but read like logs. |
| Q6 | What happens if something breaks? | Strong engine, but the Problems screen is hidden behind "Advanced tools". |

---

## 2. Deliverable 1 — UX audit

Severity: **Critical** = breaks trust or can cost money/the event · **High** = blocks or badly confuses a core journey · **Medium** = friction · **Low** = polish.

### A. Trust & honesty

| # | Problem | Why it matters | Sev | Recommendation | Reality |
|---|---|---|---|---|---|
| A1 | Sign-in is theatre: password pre-filled, submit waits 900 ms then redirects; every request is `x-user-id: default-operator`; "Operations Lead / OL" is hard-coded. (`AuthView.tsx:78-91`, `AppShell.tsx:143`) | A paying customer who discovers this stops trusting every other screen. Approvals ("you can't approve your own request") are meaningless with one shared identity. | **Critical** | Until real auth exists: replace the form with an honest **"Demo workspace — choose who you are"** picker that actually calls `setOperatorId`, and show that name in the top bar. Real auth is a backend project. | [Mock] FE+BE |
| A2 | Failures look like emptiness: dashboard shows the first-run screen when `listEvents` fails; conversations/incidents/recovery swallow errors via `allSettled` and show "nothing yet". (`events.ts:10-14`, `IncidentCommand.tsx:67-85`) | "No incidents" when the server is down is the most dangerous lie an ops tool can tell. | **Critical** | Every data view gets three distinct states: loading, **couldn't load (retry)**, genuinely empty. | [FE bug] |
| A3 | Team page invents people ("Alex Thorne", "Sarah Chen") when the API is empty and reports "Invited / Role updated" even when the call failed. (`lib/api/collaborators.ts:21-176`) | Organizer believes a colleague has access when they don't. | **Critical** | Remove fallbacks; surface real errors; show "Only you so far" when empty. | [FE bug] |
| A4 | No visible "mock mode". By default comms, LLM and maps are mock; outreach "silently succeeds". `/integrations/status` exists but the UI never reads it. | Organizer thinks vendors were called. In a real event that's catastrophic. | **Critical** | Persistent banner when any integration is mock: "Demo mode — vendors are **not** really contacted." Per-message "simulated" tag. | [Built] API, unused |
| A5 | Live views freeze while the live connection is healthy: `AgentActivityStream`, `ActivityCommand`, `LiveOperationsCommand`, `DiscoveryCommand` stop polling when `sseConnected` but never subscribe to updates. | On event day the screen silently stops updating exactly when it claims "Live". | **Critical** | Subscribe to `liveVersion` (as `LiveOperationsOverview` already does) or keep a slow poll. | [FE bug] |
| A6 | Demo events (`conference_demo` …) are merged into the real event list and are the default active event; with zero events the sidebar still shows a full event menu pointing at a demo. | First-time user lands in someone else's event. | High | Only show demo events in an explicit "Sample event" entry; no event menu until an event exists or is chosen. | [FE bug] |
| A7 | OSM venue capacity/rates are **guessed from venue type**; simulated vendors appear among real ones. | Organizer may book a 1,000-guest event into a hall whose "capacity 3500" is invented. | High | Mark guessed fields "Estimated — confirm with venue"; never rank on guessed capacity without that label; filter "Hide simulated". | [Partial] |
| A8 | Viewing an incident **creates** recovery options on the backend (`RecoveryCommand.tsx:137-140`). | Side effects on view muddle the audit log ("who generated these?"). | Medium | Generate on explicit "Find ways to fix this". | [FE bug] |
| A9 | Voice intake always sends `explicit_defaults_accepted: true`. (`VoiceIntakePanel.tsx:420`) | Consent checkbox is decorative. | High | Send the checkbox value. | [FE bug] |

### B. First-time experience & event creation

| # | Problem | Why | Sev | Recommendation | Reality |
|---|---|---|---|---|---|
| B1 | After creating an event, nothing happens: the user lands on Overview with "No recommendations yet" and must discover a Start button inside the AI-assistant panel. Copy says EVENTRA "starts finding vendors once the event exists". | The magic moment — "it's already working for me" — never happens. | **Critical** | On create, show a confirmation step "Here's what EVENTRA will do next" with **Start planning & finding vendors** (calls the existing `start-operations`). Then land on a progress view, not an empty overview. | [Built] `start-operations` |
| B2 | Blank guest count / budget are sent as `0`; copy promises "blank stays blank". No date validation (end before start). Enter on the last step submits. | Plan & budget engines then reason over zeros ("within budget" for ₹0). | High | Send `null`; validate dates; explicit submit only. | [FE bug] |
| B3 | No plausibility guidance: a 1,000-guest wedding with a ₹10,000 budget passes and later shows "Within budget". | A first-timer doesn't know what things cost; EVENTRA should. | High | Inline guidance from the budget engine's category estimates: "Typical for 1,000 guests in Delhi: ₹X–Y. Your budget covers ~Z%." | [Partial] estimates exist per category |
| B4 | Form offers 6 event types; backend supports WEDDING / COLLEGE_FEST / CONFERENCE and maps everything else to CONFERENCE silently. | A product launch gets a conference template without being told. | Medium | Offer the 3 real templates + "Other (we'll start from a conference template)". | [Partial] |
| B5 | Two good intake modes compete: wizard and voice. The 705-line text `ConversationalIntake` is dead code; the backend `POST /events/intake` (multi-turn, lakh/crore parsing, Hindi) is unused by the wizard. | Users who think in sentences ("wedding for 500 in Jaipur, ₹8 lakh, Dec 12") get a form. | Medium | **Hybrid**: one smart text box at the top ("Describe your event") that pre-fills the structured fields via `/events/intake`; fields stay editable; voice is the same box with a mic. | [Built] API |

**Recommendation for creation format:** not a chatbot, not a long form. A **single page with a smart sentence box that fills 5 fields** (type, date, city, guests, budget), each editable, with everything else optional and deferred ("Add details later"). Progressive disclosure: requirements per category appear only after the plan exists.

### C. Information architecture & dashboard

| # | Problem | Sev | Recommendation |
|---|---|---|---|
| C1 | **Problems & Recovery is hidden behind "Advanced tools"**, and three different UIs exist for it (`IncidentCommand`, `IncidentResponseView`, `RecoveryCommand`) with inconsistent entry links. In a crisis the organizer can't find it. | **Critical** | One **Problems** area, always visible, badge with open count. Remove the Advanced toggle entirely. |
| C2 | The same job lives in many places: approvals (6 surfaces), vendor engagement (conversations, outreach overview, procurement, negotiations, Overview contact panel), activity (4 feeds), plan/tasks/schedule/budget (4 routes, one component), events list (`/dashboard` and `/events`). | High | Consolidate to the IA in Deliverable 2. |
| C3 | Lifecycle rail duplicates the sidebar as navigation and implies progress it can't know (we already had to stop it ticking stages). | Medium | Replace with a real **readiness checklist** on Overview (Deliverable 4); keep navigation in the sidebar only. |
| C4 | Overview tries to be home, vendor picker (7 categories × 5 cards), AI panel and activity log at once — it's very long. | High | Overview = status + decisions. Vendor comparison belongs on Vendors. |
| C5 | Dead or orphaned routes: `/analytics` renders a blank page; `/notifications`, `/events`, `/execution-plan`, `zz-preview-stack` unreachable; bell has no click. | Medium | Remove or wire (bell → notifications drawer). |
| C6 | Event switcher sends you to Live, not Overview. | Low | Go to Overview. |

### D. Vendor discovery & selection

| # | Problem | Sev | Recommendation | Reality |
|---|---|---|---|---|
| D1 | No price on candidate cards at selection time. Organizers choose by money; EVENTRA asks them to pick before any quote exists. | High | Make the journey explicit: **Pick to request quotes** (not "pick to hire"). Show "Quote: not yet requested / requested / ₹X received". | [Partial] quote lives on assignment |
| D2 | "Why recommended?" is thin: backend keeps only total score + first reason; per-dimension sub-scores aren't stored. | High | Short term: show the stored reasons honestly ("Matched because: category, within 12 km, rating 4.6") and hide the score when absent. Backend: persist `score_breakdown`. | [Partial] BE |
| D3 | Two different "pick" actions: Overview **Pick** (shortlist select → outreach approval) vs Vendors **Request booking** (`createAssignment`); "Book venue" locks a venue instantly with no confirmation. | High | One vendor lifecycle per category (Deliverable 3). Venue lock requires a confirm dialog stating consequences. | [Built] both APIs |
| D4 | No comparison view across a category with quote, availability, advance required, coverage hours. | High | Category comparison table — fields exist on `VendorAssignment` (`quoted_amount`, `provider_available`, `coverage_*`, `advance_required`). Itemised breakdown/terms: **[Missing]** BE. | [Partial] |

### E. AI communication & negotiation

| # | Problem | Sev | Recommendation | Reality |
|---|---|---|---|---|
| E1 | No single place that answers "what's happening with this vendor?": status lives in conversations, outreach overview, negotiations and Overview contact panel. | High | **Vendor timeline** in one drawer: WhatsApp messages, call attempts with status (ringing/no answer/busy/completed), transcript, extracted facts (✦), quote, negotiation rounds, approvals. | [Built] data exists |
| E2 | No-response is invisible. There is no automatic follow-up; retry is manual only. | High | Show "No reply for 6 h" with **Retry WhatsApp / Try a call / Mark contacted myself**. Auto follow-up is **[Missing]** BE. | [Partial] |
| E3 | "Did the vendor actually agree?" — reply analysis gives YES/NO/MAYBE/UNCLEAR + confidence; UNCLEAR isn't distinguished visually from YES. | High | Decision chip with plain meaning: "Said yes", "Said no", "Unclear — read the reply", always next to the original words. | [Built] |
| E4 | Takeover exists only on the negotiation detail page, reachable only via agent auto-navigation. | Medium | "Take over this conversation" on every vendor timeline. | [Built] |
| E5 | Negotiation has no round limit. | Low (UX) | Show round count; backend cap is a BE item. | [Missing] BE |

### F. Approvals

| # | Problem | Sev | Recommendation | Reality |
|---|---|---|---|---|
| F1 | Approvals don't show money when money is involved. Amounts live inside `requested_action` JSON and aren't extracted for CONTRACT_VENDOR / PROVIDER_ENGAGEMENT / ADJUST_BUDGET. | **Critical** | For money actions, the approval card leads with **amount, vendor, what's included (if known), budget impact (before → after), advance required**. If amount is missing: say so, don't let them approve blindly ("Amount not provided — ask vendor first"). | [Partial] |
| F2 | "Is this reversible?" is never stated. Backend: approved actions **cannot be undone**; rejecting outreach dismisses the conversation. | High | Every approval shows "After you approve: … · This can't be undone" / "If you decline: …". | [Built] behaviour known |
| F3 | Expiry/reminders never fire (`expires_at` never set). | Medium | BE fix; UI already shows expiry when present. | [Missing] BE |
| F4 | Remote approval by WhatsApp ("YES/NO code") exists but isn't mentioned anywhere in the UI. | Medium | Tell busy organizers: "You can also approve from WhatsApp" + setup in settings. | [Built] |

### G. Execution, monitoring & incidents

| # | Problem | Sev | Recommendation | Reality |
|---|---|---|---|---|
| G1 | Progress numbers that don't mean readiness ("Event plan 0/11", percentages). | High | Readiness = checklist of real gates: venue confirmed · each required category confirmed · schedule feasible · budget within limits · no open critical problems. | [Built] signals exist |
| G2 | Vendor check-ins are inferred only from WhatsApp text (ARRIVED/DELAY/ETA); no manual "mark arrived". | Medium | Day-of vendor board with inferred status + "Mark arrived" (needs BE endpoint or task status update). | [Partial] |
| G3 | Quote changes and missed deadlines aren't detected as incidents (message rules only catch CANCELLED/DELAY). | Medium | Manual "Report a problem" with these as presets; BE detection later. | [Partial] |

**Incident scenarios — what the user sees today vs should see**

| Scenario | Today | Should be |
|---|---|---|
| Caterer cancels 24 h before (WhatsApp) | Incident auto-created from message ✅; impact ✅; recovery options ✅ — but Problems is hidden, no global alert beyond header chip. | Global red banner "Catering cancelled — 6 tasks affected" → one-click into recovery; options as 2–3 plain choices with cost/time; approve; backups contacted via the same vendor timeline; "Resolved" confirmation when verified. |
| Decoration misses deadline | Only visible if task status is updated; no alert. | Live board flags "Decoration late by 40 min" (live-state deviation exists) with Call vendor / Report problem. |
| Vendor changes quotation | Not detected. | New quote shows in vendor timeline as "Price changed ₹X → ₹Y" requiring re-approval. **[Missing]** BE detection. |
| Venue unavailable | Manual incident only. | "Report a problem → Venue unavailable" preset → recovery. |
| Vendor doesn't respond | Stays "sent"; manual retry. | "No reply for N h" state + retry/call/escalate. Auto follow-up **[Missing]**. |
| Critical booking unconfirmed | Plan blocker "critical task has no vendor" ✅ but no deadline. | Readiness checklist item turns red X days before the event with the action. |

### H. Accessibility, mobile, motion

| # | Problem | Sev | Recommendation |
|---|---|---|---|
| H1 | Meta text in `ink-400` (#A49C8F) on paper (#F4F1EB) is ≈2.4:1; `ink-500` ≈4.2:1 — below WCAG AA for small text. Used widely for labels, timestamps, helper text. | High | Minimum `ink-600` for any text < 16 px; `ink-400/500` only for icons/dividers. |
| H2 | Too many 10 px mono uppercase letter-spaced labels (eyebrows) — hard to read, reads "technical". | Medium | Keep mono for times, money, IDs. Section labels → 12 px sentence case. |
| H3 | Mobile: approvals detail renders below the whole list; fixed heights (`h-[520px]`, `h-[420px]`); help text only in `title` tooltips; compact rail hidden < md. | High | Master-detail becomes list → full-screen detail on mobile; remove fixed heights; help text inline. |
| H4 | Motion. Some of what we added last round is decorative (success bursts, attention pulses). | Medium | Keep motion that explains state change (new item appears, handled item leaves, number changes). Drop celebration bursts except booking confirmed / problem resolved. |

---

## 3. Deliverable 2 — Ideal information architecture

```
My events                         (home: all events, each with readiness + "needs you" count)
└─ Event
   ├─ Overview        — Is it on track? What needs me? (readiness checklist, decisions, next deadlines, money snapshot)
   ├─ Vendors         — per category: Needs vendor → Options → Quote requested → Quoted → Booked
   │    └─ Vendor drawer: profile · why recommended · timeline (messages, calls, transcript, quote, negotiation) · actions
   ├─ Decisions  (n)  — everything waiting for approval, money first
   ├─ Plan            — Run of show (timeline) · Tasks · Budget (by category: estimate / quoted / committed)
   ├─ Day-of          — live board: schedule vs actual, vendor arrivals, open problems
   ├─ Problems   (n)  — incidents → impact → fix options → approval → verified   (always visible)
   └─ Settings        — Event details · Team · Notifications & WhatsApp approvals · Activity log
```

**Removed / merged:** Advanced toggle · lifecycle rail (→ readiness checklist) · `/events` (→ My events) · separate Conversations/Negotiations/Procurement pages (→ Vendors drawer + Decisions) · `/tasks`, `/schedule` (→ Plan tabs) · `/analytics` (until reporting exists) · Overview vendor picker (→ Vendors).
**Global:** top bar = event switcher, demo-mode banner when relevant, notifications drawer (bell), current user.

---

## 4. Deliverable 3 — Ideal end-to-end journey

1. **Arrive** — landing explains "plan, contact vendors, recover" with one example. CTA: Start an event / Try the sample event.
2. **Who are you** — (until real auth) pick a demo identity; later real sign-in.
3. **Describe the event** — one sentence or voice → 5 confirmed fields → plausibility hint on budget → **Create & start**.
4. **EVENTRA works** — progress view: "Building your plan… Finding venues… Finding caterers (12 found, 5 good matches)". Organizer can leave; notified when picks are ready.
5. **Choose who to contact** — Vendors, per category: 3–5 options with why/risks/source; **Pick to request quote** (multi-select). One approval: "Contact 4 vendors on WhatsApp + call" (Approve all).
6. **Hear back** — vendor timelines fill in; quotes appear in the category comparison; unclear/no-reply states with retry/call/take over.
7. **Decide & book** — choose a quote → Decision card with amount, budget impact, terms known, irreversibility → approve → booked (confirmation message sent by backend).
8. **Get ready** — Overview readiness checklist goes green item by item; reminders for unconfirmed critical items.
9. **Event day** — Day-of board; problems arrive as alerts; fix → approve → verify.
10. **Wrap up** — conclude event; activity log export. (Post-event report: **[Missing]** BE.)

---

## 5. Deliverable 4 — Screen-by-screen

| Screen | Objective | Primary info | Secondary | Main CTA | Secondary actions | States |
|---|---|---|---|---|---|---|
| **My events** | Pick up where I left off | Event cards: date countdown, readiness (n/5 gates), "needs you" count | Budget used | Open event | New event, sample event | loading · error · first-run · list |
| **New event** | Create in < 1 min | Sentence/voice box → 5 fields | Optional details (collapsed) | Create & start | Save without starting | validation per field, budget hint, creating, failed |
| **Overview** | Is it on track; what needs me | Readiness checklist (5 gates, each with action) · Decisions (top 3) · Problems | Next deadlines · money snapshot (committed / budget) · last 5 things EVENTRA did | First pending decision | View all decisions / plan | all-clear, attention, disrupted (red banner) |
| **Vendors** | Get each category booked | Category rail with status (Needs vendor / Comparing / Quoted / Booked); options with price-or-quote-state, distance, rating, source, why | Map (toggle on mobile) | Pick to request quote / Book this quote | Save, hide simulated, filters | discovering (live log), none found (widen radius), error |
| **Vendor drawer** | Trust this vendor | Status + latest reply in plain words + quote | Timeline (messages, calls, transcript), why recommended, source & estimated fields | Next step (request quote / book / retry) | Take over, call manually, remove | no reply N h, unclear reply, call failed, simulated |
| **Decisions** | Approve confidently | Money decisions first: amount, vendor, budget impact before→after, reversibility | Who/why, technical details (collapsed) | Approve | Decline (reason), approve all (same type, non-money only) | stale (re-check), expired, done |
| **Plan** | Know the run of show | Timeline with critical path; tasks needing a vendor | Dependencies, budget by category | Fix next blocker | Compute schedule, compile plan (explained) | blocked, ready, not generated |
| **Day-of** | Run the day | Now/next cue, late items, vendor arrivals, open problems | Full schedule vs actual | Respond to top issue | Mark arrived, call vendor, report problem | live, connection lost (stale data warning), concluded |
| **Problem** | Recover fast | What happened (original message) · impact in plain words | Options compared (cost, time, risk) | Approve fix | Recalculate, resolve manually | new, fixing, awaiting approval, verified, failed |
| **Settings → Team** | Share safely | Real members + roles | What each role can do | Add member | Change role, remove | real errors only, "only you" |

---

## 6. Deliverable 5 — Design direction (adjustments to "Run Sheet")

Keep the system (paper/ink, crimson signal, provenance colours). Change:

- **Hierarchy:** one page title (28 px display) → section titles (16 px semibold, sentence case) → body 14 px → meta 12–13 px. Retire 10 px mono uppercase section eyebrows; keep mono only for times, money and IDs.
- **Contrast:** text below 16 px uses `ink-600`+ (≥ 4.5:1). `ink-400/500` for icons and borders only.
- **Colour meaning (strict):** crimson = critical/irreversible action · amber = waiting on you · green = confirmed · iris ✦ = AI-proposed · teal ✓ = engine-verified. Never decorative.
- **Spacing:** 8-pt grid; 24 px between sections, 16 px inside cards; max content width 1200 px.
- **Components:** one Card, one StatusChip, one DecisionCard, one VendorRow, one Timeline item, one EmptyState/ErrorState — replace the many ad-hoc variants in `components/v2`.
- **Dashboard layout:** two columns ≥ 1280 px (main: readiness + decisions; side: deadlines, money, activity); single column below; decisions never below the fold.
- **Responsive:** master-detail → stacked full-screen detail on < 768 px; bottom sheet for drawers; 44 px touch targets; no hover-only information.
- **Motion:** state-change only (enter, leave, value change, 150–250 ms); no idle pulses except genuinely live indicators.

---

## 7. Deliverable 6 — Prioritised roadmap

Complexity: S ≤ 1 day · M 2–4 days · L 1–2 weeks. FE = frontend only.

### P0 — must fix before anyone pays

| Item | Cx | Dep |
|---|---|---|
| A2 Honest loading / error / empty states on dashboard, conversations, incidents, recovery, team | M | FE |
| A3 Remove fake team members & fake success | S | FE |
| A4 Demo-mode banner from `/integrations/status` + "simulated" tags | S | FE (API exists) |
| A5 Fix frozen live views (subscribe to `liveVersion`) | S | FE |
| A1 Honest identity picker (`setOperatorId`), real name in top bar | S | FE (real auth = BE, L) |
| A6 Demo events out of the real list; no phantom event menu | S | FE |
| A9 Voice consent value; B2 null blanks + date validation | S | FE |
| C1 Problems always visible, single Problems flow (merge 3 UIs) | M | FE |
| B1 Create → start operations → progress view | M | FE (API exists) |
| F1/F2 Money + reversibility on decision cards | M | FE; BE to put amount in a field (S) |
| H1 Contrast fix | S | FE |

### P1 — high-impact UX

| Item | Cx | Dep |
|---|---|---|
| IA consolidation (Deliverable 2): Decisions, Vendors-by-category, Settings; remove Advanced toggle & orphans | L | FE |
| E1 Vendor drawer with full timeline (messages, calls, transcript, quote, negotiation, takeover) | L | FE |
| D4 Category quote comparison | M | FE |
| G1 Readiness checklist replacing rail & % | M | FE |
| E2/E3 No-reply and unclear-reply states with retry/call | M | FE |
| B3 Budget plausibility hints; B5 smart sentence intake via `/events/intake` | M | FE |
| H3 Mobile master-detail, remove fixed heights | M | FE |
| F4 Surface WhatsApp approvals; bell → notifications drawer | S | FE |

### P2 — mature product

| Item | Cx | Dep |
|---|---|---|
| Real authentication & invitations | L | BE+FE |
| Persist score breakdown → full "why recommended" | M | BE+FE |
| Itemised quotes, terms, contracts, payments/advances | L | BE+FE |
| Automatic no-reply follow-up; negotiation round cap; approval expiry/reminders | M | BE |
| Quote-change & missed-deadline detection as incidents | M | BE |
| Post-event report | L | BE+FE |
| Email channel | M | BE |

---

## 8. Things I'm deliberately *not* recommending

- A chatbot as the main interface. Organizers want status and decisions; conversation is useful only for intake.
- Exposing agent runs, engines or streams by name. Provenance stays as small ✦/✓ tags with plain-language tooltips.
- Percent-complete numbers not backed by real gates.
- More animation. The previous round added enough; P0 trims the decorative parts.
