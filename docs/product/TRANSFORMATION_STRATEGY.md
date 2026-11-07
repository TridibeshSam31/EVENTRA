# EVENTRA — Product transformation strategy

_7 Nov 2026 · branch `redesign/ui-v3` · follows `apps/web/docs/UX_AUDIT.md` and the five abandonment reasons · **for review — no code changed**_

The five reasons a first-time customer leaves:

1. It feels like a demo: fake sign-in, shared identity, mock outreach by default.
2. They don't trust the vendor list.
3. Value depends on vendors replying to an AI, and the hard work comes back to them.
4. "Booked" isn't a booking.
5. 20 pages per event.

Four of the five are about **truth**, not layout. So this strategy starts with what the system *knows* and how it *proves* it. Navigation comes second.

**Status tags used below:** **[Built]** works today · **[Partial]** exists with gaps · **[New]** does not exist yet.

---

## 0. The core idea: one vendor, one honest ladder

Every vendor in every category moves up a single ladder. Each rung is a **separate fact with its own evidence**, so no rung can imply the next one.

| # | Rung (customer words) | What it means | Evidence required | Who/what moves it |
|---|---|---|---|---|
| 1 | **Found** | It exists in a listing | Source + date (Google Maps / OpenStreetMap / added by you) | Search |
| 2 | **Contacted** | We tried to reach them | A delivery record: message sent / call placed, with result | EVENTRA or you |
| 3 | **Replied** | A human at the vendor answered | The reply itself (message text, call transcript, or your note) | Vendor |
| 4 | **Quoted** | Vendor stated a price for *this* event | Quote version: total, what's included, valid until, link to the reply it came from | Vendor (extracted or entered by you) |
| 5 | **Approved by you** | You (or your approver) accept this quote | Decision record: who, when, amount | Organizer |
| 6 | **Vendor confirmed** | Vendor accepted the booking on the approved terms | Vendor's own words after approval (message / transcript), or your note marked "confirmed by phone" | Vendor |
| 7 | **Secured** | Money or paper changed hands | Advance recorded (amount, date, method, optional receipt) and/or signed confirmation uploaded | Organizer records it; **EVENTRA does not process payments** |

Rules that enforce the constraints:

- **Found ≠ verified.** Rung 1 never sets a "verified" badge. Individual facts get verified only by rungs 3–4 (see §5).
- **Approved by you ≠ vendor accepted.** Rung 5 never sets rung 6.
- **Vendor confirmed ≠ secured.** Rung 6 never counts as "Secured" money.
- **Simulated evidence never moves a rung** on a live event. On a demo event every rung is labelled *Demo*.
- A vendor can drop off the ladder (declined, no answer, quote expired, cancelled). Dropping off is shown, never deleted.

This ladder replaces the 15-value `negotiation_status`, the separate `status`, `VendorOutcomeStatus` and the shortlist `status`. Those stay in the backend for engines; the customer only ever sees the ladder.

---

## Q1. EVENTRA without agent-centric language

**Current.** UI and API surface internal concepts:
- agent runs, discovery runs, engines, provenance, "Browser Assistant"
- `PROVIDER_ENGAGEMENT`, `COMMUNICATION_OUTREACH`, `CONTRACT_VENDOR`
- shortlist / candidate / provider / assignment
- "operations", "execution plan", "Operations Lead"

`describe.ts` and `approval_presenter.py` already translate approvals [Built]. Everything else is inconsistent.

**Problem.** The customer must learn the system's model to use it. Different screens use different words for the same thing, e.g. provider, vendor and candidate.

**Desired.** One customer vocabulary, enforced in code:

| Internal | Customer sees |
|---|---|
| agent run / discovery run | "Searching for caterers near Jaipur…" |
| candidate / provider / vendor | **vendor** (venue is a vendor category) |
| shortlist entry | **saved** |
| select candidate | **pick** (one per category) |
| outreach / communication approval | **contact** |
| negotiation | **price discussion** |
| assignment | **booking** (with its ladder rung) |
| approval / `CONTRACT_VENDOR` etc. | **decision** ("Approve ₹1,20,000 for Sharma Caterers") |
| incident | **problem** |
| recovery option | **way to fix it** |
| readiness gate | **checklist item** |
| provenance / source tag | "From Google Maps · 3 Nov" / "Vendor said on WhatsApp" / "Our estimate" |
| simulation / mock | **Demo** (never "simulated success") |
| operator / x-user-id | the person's name |
| engine, LangGraph, LLM, agent | never shown. Available only under **History → technical details** |

**Operational visibility is not removed.** Every customer statement links to its evidence: the message, the call, the decision record. The raw agent-run and audit stream stays under History, behind a "technical details" expander.

- **FE:** a single `lib/copy.ts` dictionary. Rename labels in place, since components keep their names. A Vitest test fails if banned terms appear in rendered customer pages: `agent run`, `provider`, `candidate`, `assignment`, `engine`, `simulation`, `Operations Lead`.
- **BE:** none required. Optional: `approval_presenter`-style `summary` fields for incidents and recovery options (some exist).
- **Complexity:** M.
- **Acceptance:**
  - No banned term appears in customer routes (test).
  - Every approval, incident and fix shows one plain sentence.
  - The technical stream is still reachable in ≤2 clicks from History.

---

## Q2. The minimum set of screens

To run an event from creation to completion you need **11 screens** (today: ~30 routes, 20 under an event):

| # | Screen | Job |
|---|---|---|
| 1 | Sign in / accept invite | Real identity (Q6-C) |
| 2 | My events | Live events; a separate "Try a sample event" entry |
| 3 | New event | Sentence box + 5 editable fields → "Here's what EVENTRA will do" → start |
| 4 | **Home** (event) | Will it happen? What needs me? Money snapshot. Problems banner. Post-event: report |
| 5 | **Vendors** board | One row per category with its ladder rung; venue is a category |
| 6 | Vendor page | Facts with sources, why recommended, one timeline (messages, calls, quotes, decisions), ladder, one next action, "I'll handle this myself" |
| 7 | Decision sheet | What, how much, budget impact, what happens on approve / reject, reversible? |
| 8 | **Plan** | Run of show + tasks (merges plan / schedule / tasks) |
| 9 | **Money** | Budget by category: estimate → quoted → approved → secured |
| 10 | **Day-of** | Now/next, vendor arrivals, problems, fix flow (merges live / incidents / recovery) |
| 11 | Event settings | Details, team, history (audit + activity), notifications prefs, report archive |

Decisions and Notifications are **drawers** reachable from the top bar, not pages, though decision detail keeps its deep-linkable route. Problems are **always** reachable from the Home banner, not just on the day.

---

## Q3. Five-section navigation

```
Home      Vendors      Plan      Money      Day-of            [🔔 Notifications] [⚑ Decisions 3] [Name ▾]
```

| Section | Answers | Contains (merged from) | Always visible? |
|---|---|---|---|
| **Home** | Will my event happen? What needs me? | overview, readiness checklist, next-step card, top 3 decisions, problems banner, recent activity (5), report after event | Yes |
| **Vendors** | Who's booked, who isn't, can I trust them? | vendors, venue, procurement, negotiations (+detail), conversations | Yes |
| **Plan** | What happens when, who does what? | plan, schedule, tasks | Yes |
| **Money** | Where is my money going? | budget, analytics (money parts) | Yes |
| **Day-of** | What's happening now, what's broken? | live, incidents, recovery | Yes. Before the event it shows the checklist and a countdown, not an empty live board |

Event menu (gear): Event details · Team · History · Report · Notification settings.

**Changes vs today:**
- **Sidebar.** `GlassSidebar.tsx` has 5 groups and 12 pages, plus a "Show all" toggle revealing 8 more. The new nav has 5 flat sections, always visible.
- **Next-step guide.** It stops *hiding* pages via `unlocked_pages` and only *highlights* the next section. Locked pages felt like being shut out of your own event.
- **Mobile.** The 5 sections become a bottom tab bar. Decisions and the bell stay in the top bar.

- **FE:** new `AppShell` nav, route redirects (Q7), guide retargeting (`page` values → 5 sections + anchor).
- **BE:** `next_step_service.py` returns `section` + `anchor`, keeping `page` for compatibility.
- **Complexity:** L (mostly moving existing components).
- **Acceptance:**
  - Every old URL redirects to the new home of its content.
  - No page is hidden by guide state.
  - Every next-step `page` value resolves to a section.
  - Keyboard and screen-reader navigation works across sections.
  - At 375 px the bottom bar works and there is no horizontal scroll.

---

## Q4. Discovery → communication → negotiation → booking as one journey

**Current.** The flow is split across many surfaces:
- Overview's vendor picker (7 × 5 cards)
- Vendors, Venue and Procurement pages
- Decisions (contact approvals)
- Messages & Calls, Negotiations and the negotiation detail page
- Decisions again (booking approvals)

The journey vocabulary in `lib/journey.ts` (Save → Pick → Contact → Book) is the right start [Built]. It stops at "Request booking", which is the **wrong end**: it ends at organizer approval.

**Desired.** One **category row** on the Vendors board and one **vendor page**. On both, the user always sees the ladder rung and exactly one next action:

```
Catering   ●──●──●──●──◐──○──○   Sharma Caterers · Quoted ₹1,20,000 (incl. 450 plates, setup) · valid till 12 Nov
           Found Contacted Replied Quoted Approved Confirmed Secured
           [ Approve this quote ]   · Compare 3 quotes · I'll handle this myself
```

| Rung → next | Primary action shown | Existing backend | Gap |
|---|---|---|---|
| none → Found | "Find caterers" / searching state with live count | discovery runs, shortlist [Built] | persist *why* (Q6-A) |
| Found → Contacted | "Contact these 3" (one decision for the batch) | `COMMUNICATION_OUTREACH` approval + outreach service, `CommunicationAttempt` [Built] | — |
| Contacted (no reply) | "No reply in 6 h · Try a call / Resend / Call them yourself" | follow-up sweeper [Built], `ContactResultPanel` no-reply state [Built] | explicit next-retry time in API |
| Replied → Quoted | "Read reply" with the extracted quote side by side; "Fix the amount" if extraction is wrong | reply analysis, `VendorOutcome` + validation [Built] | versioned quote with inclusions (Q6-B) |
| Quoted (several) | "Compare quotes" | `QuoteBoard` [Built] | line items |
| Quoted → price discussion (optional) | "Ask EVENTRA to negotiate down to ₹1,05,000" with cap | negotiation service + voice [Built] | round cap (P2) |
| Quoted → Approved | "Approve ₹1,20,000" → decision sheet | `CONTRACT_VENDOR` approval [Built] | **must stop setting `CONFIRMED`** (Q6-B) |
| Approved → Vendor confirmed | "Waiting for Sharma Caterers to confirm" · Send confirmation request / Mark as confirmed by phone (needs a note) | confirmation message is sent after approval [Built] | vendor-commitment field + evidence (Q6-B) |
| Confirmed → Secured | "Record advance" (amount, date, method, receipt) / "Upload signed confirmation" | `advance_required` flag only [Partial] | payments/evidence (Q6-B) |

**"I'll handle this myself"** is available on every rung. It turns EVENTRA from "AI or nothing" into a tracker that still works when vendors won't talk to a bot (abandonment reason 3). The organizer logs what happened ("Called, quoted ₹1.1L") as a `VendorOutcome` with `source=organizer`, which exists [Built], and the ladder moves on that evidence.

- **FE:** `VendorLadder` component; Vendors board; vendor page (absorbs `ContactResultPanel`, `QuoteBoard`, negotiation detail, conversation thread); retire the Overview vendor picker.
- **BE:** ladder computed server-side (Q6-B) and returned on `/events/{id}/vendors` (new aggregate endpoint) and per vendor.
- **Complexity:** L.
- **Acceptance:**
  - From the Vendors board a user can take a category from Found to Secured without visiting another section.
  - Every rung shows its evidence on click.
  - "I'll handle this myself" can move any rung with a typed note, and that note shows as the evidence.
  - Approving a quote leaves the rung at **Approved by you**, never Confirmed.

---

## Q5. Representing uncertainty, unverified data, failed communication, incomplete bookings

One small, fixed visual vocabulary, used everywhere:

### A. Fact trust (per field: phone, capacity, price, address, open/closed)

| Label | Meaning | Look |
|---|---|---|
| **Confirmed by vendor** | Vendor said it in a reply/call; links to it | solid check + "Vendor said · 4 Nov" |
| **From listing** | Google Maps / OSM, with date | plain text + source chip |
| **Our estimate** | Inferred (e.g. OSM capacity from venue type, budget-engine price range) | dashed underline + "Estimate — confirm with vendor" |
| **Unknown** | Not available | "—  Ask vendor" action |

Rules:
- Estimates are never shown in green or with a check.
- Ranking may use estimates, but the "why recommended" says so.
- A vendor whose phone is unknown can't be "Contacted" by EVENTRA. It shows "Add a phone number".

### B. Communication attempts

| State | Shown as |
|---|---|
| Sending / ringing | spinner + channel + time |
| Delivered, no reply | "Delivered 3 h ago · we'll follow up at 6 pm" |
| Replied | the reply, verbatim first; EVENTRA's reading second ("Said yes", "Said no", "Unclear — read it") |
| No answer / busy | "No answer (2 tries) · Try WhatsApp / Call yourself" |
| Failed | the reason in plain words ("Number not on WhatsApp", "Call couldn't connect") + next action. Never silent |
| **Demo** | grey "Demo — not sent to a real vendor" tag on the attempt **and** on anything derived from it |

### C. Bookings

The ladder (§0) *is* the representation. The Home checklist and Money use the rung as follows:
- A category is **covered** only at *Vendor confirmed*.
- A category is **safe** only at *Secured*.
- Anything below *Vendor confirmed* within N days of the event (default 7 days, critical categories 14 days) becomes a Home problem: "Catering isn't confirmed and the event is in 5 days."

### D. Failures of EVENTRA itself

Every data view has three distinct states: loading / couldn't load (retry) / genuinely empty. This is mostly [Built] from P0 A2; it will be verified per screen during implementation.

- **FE:** `TrustLabel`, `AttemptStatus`, `LadderRung` components in `components/ds/`.
- **BE:** provenance per fact (Q6-A); `simulated` on every outward record (Q6-D); deadline sweeper for unconfirmed categories (extend `late_task_sweeper` / readiness).
- **Complexity:** M (FE) + M (BE).
- **Acceptance:**
  - Every displayed vendor fact carries one of the four labels.
  - No estimate renders with a check icon.
  - Every failed attempt shows a reason and an action.
  - A demo-derived quote shows the Demo tag on the vendor page, the Money page and the decision sheet.

---

## Q6. Backend data model changes

### Current (verified in `apps/api/app/models`)

- **`users`:** `id, name, email, phone_e164`. No credentials.
- **Identity:** `get_current_user_id` reads the `x-user-id` header, defaulting to `anonymous_operator`. The frontend always sends `default-operator`.
- **`event_members`:** `user_id, role, role_id` exist, plus `roles` / `permissions` tables. They aren't enforced against a real identity.
- **`vendors`:** `source, source_id, rating, review_count, classification_confidence, base_cost`. **No per-field provenance, no reachability, no simulated flag.**
- **`venues`:** `capacity, hourly_rate`. No provenance; OSM values are guessed.
- **`event_shortlist_entries`:** `ranking, candidate_data (JSON), selection_source`. **Score components aren't stored as structured data.**
- **`vendor_assignments`** mixes three different truths:
  - two status fields (`status`, plus `negotiation_status` with 15 values)
  - `quoted_amount, agreed_cost, max_approved_amount`
  - `advance_required`, `is_simulation`
  - no quote versions, inclusions or validity
  - no record of vendor acceptance; no payment record
- **Approval conflated with confirmation.** Approving `CONTRACT_VENDOR` / `REASSIGN_VENDOR` sets `assignment.status = "CONFIRMED"` (`action_service.py:454, :634`). `negotiation_service.confirm_engagement` also sets CONFIRMED and **records the budget commitment** on organizer approval. Cost can default to `0` (`action_service.py:437`). `:635` writes `negotiation_status = "APPROVED"`, which **is not a value of `NegotiationStatus`**.
- **[Built] and reusable:** `communication_attempts` (channel, provider, status, provider_ref, error, attempt_count); `vendor_outcomes` + `vendor_outcome_validations` (claims with PASS / FAIL / UNKNOWN / CONFLICT). These are the right foundation for evidence.
- No file upload model was found (only `UploadFile` in intake for audio).

### A. Trustworthy recommendations — **[New]**, M

| Change | Detail |
|---|---|
| `vendor_facts` table | `vendor_id, field (phone/capacity/price_from/address/open_status/services), value, trust (VENDOR_CONFIRMED / LISTING / ESTIMATE / ORGANIZER), source (google_maps/osm/reply/call/organizer), evidence_ref (message/attempt/outcome id), observed_at`. Vendor columns stay as the "current value" cache. |
| `vendors.is_simulated` (bool, indexed) + `vendors.contact_status` (UNKNOWN / FORMAT_OK / REACHED / WRONG_NUMBER / NOT_ON_WHATSAPP) | Set from attempt results. |
| `shortlist.score_components` JSON + `ranking_version` + `risks` JSON | e.g. `{distance_km, price_fit, capacity_fit, rating, data_completeness}` and `["capacity is an estimate", "no reviews"]`. The ranking engine already computes these; persist them instead of discarding. |
| Write path | When reply analysis extracts a claim that validates PASS, write a `VENDOR_CONFIRMED` fact with `evidence_ref`. OSM-inferred capacity is written as `ESTIMATE`. |

**Acceptance:**
- `GET /events/{id}/vendors/{vid}` returns each fact with `trust` + `source` + `observed_at`.
- The ranking API returns stored components and risks.
- No simulated vendor appears in a live event's results unless explicitly requested.

### B. Booking evidence — **[New]**, L

| Change | Detail |
|---|---|
| `quotes` table | `assignment_id, version, total, currency, line_items JSON, inclusions, exclusions, valid_until, source_evidence_ref, entered_by (EXTRACTED/ORGANIZER), created_at`. A new version on change lets us detect "vendor changed the quote" as a problem (P2 item). `assignment.quoted_amount` stays as a cache of the latest version. |
| Three orthogonal fields on `vendor_assignments` | `organizer_decision` (NONE / APPROVED / REJECTED, `approval_id`, `approved_quote_id`) · `vendor_commitment` (NONE / VERBAL / WRITTEN / DECLINED / CANCELLED, `commitment_evidence_id`, at) · `financial_status` (NONE / ADVANCE_DUE / ADVANCE_PAID / PAID_IN_FULL / REFUNDED, amounts). |
| `booking_evidence` table | `assignment_id, kind (VENDOR_MESSAGE / CALL_TRANSCRIPT / DOCUMENT / PAYMENT_RECORD / ORGANIZER_NOTE), ref_id or file_key, amount?, recorded_by (user id), recorded_at, simulated`. |
| Derived `ladder_rung` | Computed in one service (`booking_ladder.py`), returned by APIs. Never stored as an independent truth. |
| **Fix the conflation** | `CONTRACT_VENDOR` / `REASSIGN_VENDOR` approval sets `organizer_decision=APPROVED` only. Budget "committed" splits into **approved** (organizer) and **secured** (financial). `status="CONFIRMED"` is written only when `vendor_commitment ∈ {VERBAL, WRITTEN}`, keeping existing readers working. Remove the invalid `"APPROVED"` negotiation status. Reject approvals with cost `0` / unknown. |
| File storage | Uploads for receipts and signed confirmations (local disk in dev, S3-compatible in prod). |
| Migration | Backfill existing `CONFIRMED` rows as `organizer_decision=APPROVED, vendor_commitment=NONE` unless a confirmation reply exists. Honest by default. |

**Acceptance:**
- Approving a quote never changes `vendor_commitment` or `financial_status`.
- `ladder_rung=SECURED` requires a non-simulated `PAYMENT_RECORD` or `DOCUMENT` evidence row.
- `budget_commitments` reports `approved` and `secured` separately.
- Existing tests for readiness, live state and the approval presenter are updated and pass.

### C. Real user identity — **[New]**, L

| Change | Detail |
|---|---|
| Authentication | Email magic-link / OTP sessions (or a hosted provider). `get_current_user_id` reads the session; the `x-user-id` header is accepted **only** when `APP_ENV=dev`. |
| `invitations` table | `event_id, email/phone, role, token, status, invited_by, expires_at`. Team page sends real invites. |
| Roles enforced | `OWNER`, `APPROVER` (can decide money), `MEMBER` (can act, not approve money), `VIEWER`. Approvals record real `requester_id` / `approver_id` user ids. Self-approval rule becomes meaningful. Optional per-event "money decisions above ₹X need an approver". |
| WhatsApp YES/NO approvals [Built] | Bind to `users.phone_e164` of a member with approve rights. Unknown numbers can't approve. |

**Acceptance:**
- No request without a session reaches event data in prod mode.
- The top bar shows the real name.
- An invited teammate can sign in and sees only their events.
- A member without approve rights cannot approve money (API 403 + UI hides the button with an explanation).

### D. Demo vs live, enforced — **[Partial]** → S/M

| Change | Detail |
|---|---|
| `events.mode` (LIVE / DEMO), set at creation, immutable | Demo events never appear in "My events", only under "Sample event". |
| `simulated` on `messages`, `communication_attempts` (derive from `provider=mock`), `vendor_outcomes`, `booking_evidence` | `assignment.is_simulation` exists [Built]; extend it and make it consistent. |
| Guard | On a LIVE event, if a needed integration is mock, the action **fails with a clear error** ("WhatsApp isn't connected — connect it or contact the vendor yourself"). It does not silently simulate. Today the default is `COMMUNICATION_PROVIDER=mock`, and the scraper falls back to mock (`GOOGLE_MAPS_SCRAPER_FALLBACK_TO_MOCK=True`). |

**Acceptance:**
- On a LIVE event, no mock provider produces a record without `simulated=true`.
- A simulated record can't advance the ladder.
- With mock comms on a LIVE event the contact action returns an actionable error.

### E. Production dependencies to flag honestly

- **WhatsApp.** The current real channel is **OpenWA** (WhatsApp Web automation on a personal number). For paying customers this is a ban risk and ties outreach to someone's phone. A credible product needs the **WhatsApp Business Platform** (approved templates for first contact). This is an external dependency with lead time, not code alone.
- **Voice.** Twilio + Gemini Live [Built]. It needs disclosure ("This is an assistant calling on behalf of …"), already partly in the prompt, plus call recording consent per region.
- **Payments.** Out of scope. EVENTRA *records* advances; it does not move money.

---

## Q7. Merge, hide contextually, or remove

All 20 event routes:

| Today | Decision | Goes to | Notes |
|---|---|---|---|
| `overview` (`[eventId]`) | **Keep** → Home | Home | Drop the 7 × 5 vendor picker (it moves to Vendors) |
| `vendors` | **Merge** | Vendors board | |
| `venue` | **Merge** | Vendors → Venue category | Keep venue-specific map / capacity UI inside the vendor page |
| `procurement` | **Merge** | Vendors | Category requirements show on the category row |
| `negotiations`, `negotiations/[id]` | **Merge** | Vendor page → "Price discussion" section | Keep the live negotiation screen as a full-screen view opened from there; route redirects |
| `conversations` | **Merge** | Vendor page timeline | Keep an "All messages" filter view under Vendors for bulk reading |
| `approvals`, `approvals/[id]` | **Contextual** | Decisions drawer (top bar) + Home top 3 + inline on vendor page | Detail route kept for WhatsApp / notification deep links |
| `plan`, `schedule`, `tasks` | **Merge** | Plan (Timeline · Tasks tabs) | |
| `budget` | **Keep** → Money | Money | |
| `analytics` | **Merge / remove** | Money charts or Report | Content to be checked during implementation; drop anything not answering a money or outcome question |
| `live` | **Keep** → Day-of | Day-of | |
| `incidents`, `recovery` | **Merge** | Day-of → Problems (detail = problem + ways to fix + decision) | Problems banner on Home before the day |
| `notifications` | **Contextual** | Bell drawer | Route redirects to the drawer |
| `activity` | **Contextual** | Home "Recent" (5) + vendor timelines; full list in History | |
| `audit` | **Hide** | Event menu → History (technical details expander) | Operational visibility kept |
| `collaborators` | **Move** | Event menu → Team | |
| `setup` | **Move** | Event menu → Event details | |
| `report` | **Contextual** | Home after the event ends; event menu → Report | |
| `/browser-runtime` | **Remove from customer nav** | Internal / admin only | Not a customer concept |
| `/events/[id]/execution-plan` (outside `(app)`) | **Merge** | Plan | Check for any remaining links |

- **FE:** route redirects in `next.config` / middleware; component moves.
- **BE:** none.
- **Complexity:** L overall, done incrementally section by section.
- **Acceptance:**
  - Each old route returns a redirect to its new location.
  - Deep links from notifications, WhatsApp messages and the next-step guide still land correctly (test the URLs the backend emits).
  - No feature is unreachable: every existing action has a documented new location.

---

## Q8. The smallest credible EVENTRA (for one real event)

**Promise:** "EVENTRA finds vendors near you, contacts them for you, and tracks every vendor until they're confirmed and paid, with proof. When a vendor won't talk to a bot, you log what happened and EVENTRA keeps track."

**In scope:**
1. **Real sign-in**, with the owner plus invited teammates and an approver role (Q6-C).
2. **LIVE / DEMO separation** with hard guards (Q6-D).
3. **Create event:** sentence box → 5 fields → start [mostly Built].
4. **Vendors:** search with fact provenance and stored reasons (Q6-A); contact via WhatsApp + call with honest attempt states [Built + Q5-B]; quotes with inclusions (Q6-B); the ladder to **Secured** with evidence (Q6-B); "I'll handle this myself" on every rung.
5. **Decisions:** money and reversibility on every decision [Built], approver role enforced.
6. **Home:** checklist driven by ladder rungs, next step [Built], problems banner, unconfirmed-near-deadline warnings.
7. **Money:** estimate / quoted / approved / secured per category.
8. **Day-of:** checklist of vendors confirmed, "Mark arrived", report a problem → ways to fix → decision [mostly Built].
9. **Report** after the event [Built].

**Explicitly out of MCV:**
- autonomous multi-round voice negotiation as a default (kept as opt-in, capped)
- analytics
- browser assistant
- email channel
- payments processing
- multi-city optimisation

**MCV is ready when:**
- A non-technical organizer creates a live event, gets ≥3 real vendors per category with sourced facts, and contacts them over a real channel.
- They take one category to *Secured* with evidence, and invite a teammate who approves a money decision from WhatsApp.
- They never see a simulated action presented as real.
- They never need a page outside the five sections.

Validate with 3–5 real organizers (one college fest, one wedding, one corporate) before P2 work.

---

## Implementation order (after review)

| Phase | Items | Why first | Cx |
|---|---|---|---|
| **1. Stop the lies** | Approval ≠ confirmation fix + invalid status (Q6-B part); `events.mode` + simulated propagation + live guards (Q6-D); terminology dictionary + test (Q1) | Cheap, and removes the trust-breaking behaviour | M |
| **2. Evidence model** | `quotes`, assignment truth fields, `booking_evidence`, `booking_ladder` service, file storage, migration + backfill (Q6-B); `vendor_facts`, score persistence (Q6-A) | Everything in the UI depends on it | L |
| **3. One journey** | Vendors board + vendor page + ladder + "handle myself" (Q4); trust / attempt components (Q5) | Fixes abandonment reasons 2, 3, 4 | L |
| **4. Five sections** | Nav, merges, redirects, guide retarget (Q3, Q7); Money split approved / secured | Fixes reason 5 | L |
| **5. Identity** | Auth, invites, roles, WhatsApp approver binding (Q6-C) | Fixes reason 1; can run in parallel with 2–4 on the backend | L |
| **External** | WhatsApp Business Platform onboarding | Lead time; start now | — |

Every phase keeps existing endpoints working (additive fields, cached legacy columns, redirects) and ships with tests. The current suites are green (web 66/66, typecheck clean); the API suite is to be run against the live server.

## Open questions for review

1. Auth: build email OTP ourselves, or use a hosted provider (Clerk / Auth.js / Supabase)?
2. Default "confirm by" thresholds: 7 days, and 14 for venue and catering?
3. Should "Approved by you" count toward the Money total shown on Home, or only "Secured"? (Proposal: show both, headline = secured.)
4. Is OpenWA acceptable for pilot customers while WhatsApp Business is set up, with explicit organizer consent?
