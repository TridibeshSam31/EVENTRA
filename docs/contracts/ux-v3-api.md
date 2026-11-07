# UX v3 — API contract (backend ⇄ frontend)

Agreed shapes for the UX v3 work. Backend implements exactly these; frontend
consumes them and **degrades gracefully** (treat every new field as optional)
so either side can ship first. All new fields are additive — no existing field
changes meaning. No DB migrations unless stated; derive from existing data.

Base path: `/api` (routes are also reachable unprefixed like the rest of the API).

---

## 1. Approval — computed, human-facing fields

Added to every approval in `GET /events/{id}/approvals`, `GET /events/{id}/approvals/{aid}`:

```jsonc
{
  // existing fields unchanged …
  "summary": "Contact Car-Van-Bus Rental Service (Transport) on WhatsApp and phone",
  "vendor_name": "Car-Van-Bus Rental Service" | null,
  "category": "TRANSPORT" | null,
  "channel": "WHATSAPP" | "CALL" | "WHATSAPP_AND_CALL" | null,
  "involves_money": true | false,
  "amount": 85000 | null,            // from requested_action / linked assignment quote; null if unknown
  "currency": "INR" | null,
  "budget_impact": {                 // null when not a money action or budget unknown
    "category": "CATERING",
    "category_budget": 120000 | null,
    "committed_before": 40000,
    "committed_after": 125000,
    "total_budget": 500000 | null,
    "over_category_budget": true
  } | null,
  "on_approve": "EVENTRA will message and call this vendor to ask about availability and price.",
  "on_reject": "The vendor won't be contacted. You can pick another option.",
  "reversible": false,
  "expires_at": "2026-11-08T10:00:00Z" | null   // now actually set on creation (see §6)
}
```

## 2. Readiness — `GET /events/{id}/readiness`

```jsonc
{
  "event_id": "…",
  "status": "NOT_STARTED" | "IN_PROGRESS" | "AT_RISK" | "BLOCKED" | "READY" | "LIVE" | "DONE",
  "days_until_event": 23 | null,
  "gates": [
    {
      "id": "details" | "plan" | "venue" | "vendors" | "schedule" | "budget" | "problems",
      "label": "Venue confirmed",
      "status": "done" | "in_progress" | "blocked" | "not_started" | "not_applicable",
      "detail": "2 of 6 categories booked (Catering, Décor)",
      "progress": { "done": 2, "total": 6 } | null,
      "action": { "label": "Book remaining vendors", "page": "vendors", "path": "/events/{id}/vendors" } | null
    }
  ]
}
```
Gate rules (deterministic, from existing data): details = name+date+city+guests+budget present ·
plan = plan exists and readiness ≠ INCOMPLETE · venue = event.venue_id set or VENUE assignment CONFIRMED ·
vendors = required categories (from plan resources/tasks) with a CONFIRMED assignment ·
schedule = computed and feasible · budget = budget validate has no violations · problems = no open CRITICAL/HIGH incidents.

## 3. Next step — `GET /events/{id}/next-step`

The single thing the organizer should do now. Deterministic priority order:
open critical incident → pending approvals → picks needed (recommended options, nothing selected) →
discovery not started → vendors with no reply → quotes received awaiting decision → plan blockers →
schedule not computed → ready to go live → live → done.

```jsonc
{
  "event_id": "…",
  "step_id": "start_discovery",          // stable id (see list below)
  "stage": "DEFINE" | "DISCOVER" | "CONTACT" | "DECIDE" | "PLAN" | "READY" | "LIVE" | "RECOVER" | "DONE",
  "urgency": "normal" | "attention" | "critical",
  "title": "Let EVENTRA find your vendors",
  "body": "We'll search venues and suppliers near Delhi that fit 1,000 guests and ₹5,00,000.",
  "cta_label": "Start finding vendors",
  "page": "overview" | "vendors" | "venue" | "decisions" | "plan" | "budget" | "conversations" | "live" | "problems" | "setup",
  "path": "/events/{id}/vendors",
  "count": 5 | null,                     // e.g. number of approvals waiting
  "completed_steps": ["create_event", "plan_ready"],
  "unlocked_pages": ["overview", "setup", "vendors", "venue", "plan"],
  "progress": { "done": 2, "total": 7 }
}
```
`step_id` values: `complete_details`, `start_discovery`, `discovery_running`, `pick_vendors`,
`approve_requests`, `awaiting_replies`, `review_quotes`, `fix_plan_blockers`, `compute_schedule`,
`go_live`, `run_event`, `resolve_problem`, `event_done`.

`unlocked_pages` grows with progress (frontend hides the rest unless "Show all pages" is on):
always `overview, setup`; + `vendors, venue, plan` after event exists; + `decisions` when any approval exists;
+ `conversations` when any outreach exists; + `budget` when plan exists; + `live` when ≥1 vendor confirmed or event is LIVE;
+ `problems` when any incident exists (always when one is open).

## 4. Quotes — `GET /events/{id}/quotes?category=`

```jsonc
{
  "items": [{
    "assignment_id": "…", "vendor_id": "…", "vendor_name": "…", "category": "CATERING",
    "status": "QUOTED" | "NEGOTIATING" | "AWAITING_APPROVAL" | "CONFIRMED" | …,
    "quoted_amount": 85000 | null, "currency": "INR",
    "available": true | false | null,
    "coverage_start": "…" | null, "coverage_end": "…" | null,
    "advance_required": true | false | null,
    "summary": "Can serve 500, setup included" | null,
    "quoted_at": "…" | null,
    "cap": 90000 | null, "within_cap": true | null,
    "negotiation_round": 2 | null,
    "previous_amount": 80000 | null      // set when the quote changed
  }],
  "by_category": { "CATERING": { "count": 3, "lowest": 80000, "category_budget": 120000 } }
}
```

## 5. Report — `GET /events/{id}/report`

```jsonc
{
  "event": { "id","name","type","start","end","location","guests" },
  "budget": { "total","committed","spent_by_category": [{ "category","estimated","committed" }] },
  "vendors": [{ "name","category","status","agreed_cost" }],
  "incidents": { "total","resolved","open","by_type": {} , "items": [{ "title","severity","status","resolution" }] },
  "approvals": { "total","approved","rejected","expired" },
  "communication": { "messages_sent","calls_made","replies" },
  "timeline": { "tasks_total","tasks_done","on_time","late" }
}
```

## 6. Behaviour changes (no new shape)

- **Approval expiry:** `expires_at` set on creation from config (`APPROVAL_TTL_HOURS_MINOR=72`,
  `_MAJOR=24`, `_CRITICAL=4`; never later than event start). Existing sweeper then reminds/escalates/expires.
- **No-reply follow-up:** outreach with no inbound reply after `OUTREACH_NO_REPLY_HOURS` (default 6) is marked
  `no_reply=true` on `GET …/shortlist/{cid}/communication` (`awaiting_reply_since`, `follow_up_due_at`) and an
  in-app notification is created once. Auto re-send only if `OUTREACH_AUTO_FOLLOW_UP=true` (default **false**).
- **Negotiation round cap:** `NEGOTIATION_MAX_ROUNDS` (default 4). On reaching it the negotiation stops
  and moves to awaiting the organizer (status/notification), never auto-accepts.
- **Quote change:** a new quote different from the stored one sets `previous_amount`, logs activity
  "Price changed ₹X → ₹Y", and if the assignment was CONFIRMED/APPROVED, requires a new approval.
- **Missed deadline:** live task late beyond `LATE_TASK_INCIDENT_MINUTES` (default 30) with an assigned vendor
  creates (once) a DELAY incident linked to the task.
- **Discovery data:** shortlist `candidate_data` additionally stores `score_breakdown` (dimension → 0..1),
  `reasons` (list), and `estimated_fields` (e.g. `["capacity","hourly_rate"]` for OSM-guessed values).
- **Consistency fixes:** budget "committed" uses one definition everywhere (sum of CONFIRMED assignment
  `agreed_cost`); discovery funnel counts are monotonic (discovered ≥ unique ≥ qualified).
