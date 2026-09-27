# EVENTRA Backend Gap Register

This register documents genuine backend architectural and contract limitations discovered during Frontend V2 implementation.
All gaps are tracked with truthful frontend fallbacks and marked as **DEFERRED** per the Frontend V2 implementation policy.

---

### B1 — Missing arbitrary dependency graph edges for some non-CPM incidents
- **ID:** B1
- **Title:** Missing arbitrary dependency graph edges for some non-CPM incidents
- **Area:** Planning & Incident Impact Analysis
- **Current behavior:** Some non-CPM incidents return impacted task lists without explicitly serialized directed graph edges.
- **Desired behavior:** Dedicated impact graph endpoint returning adjacency lists or directed edges for arbitrary sub-graphs.
- **Endpoint/schema:** `GET /api/events/{event_id}/impact`
- **Frontend fallback:** Fall back to task predecessor/successor relationships and sequential milestone ordering.
- **Severity:** Medium
- **Recommended backend fix:** Return explicit graph adjacency matrix or edge list in incident impact responses.
- **Discovered in:** Prior architecture audit / Task 5
- **Status:** DEFERRED

---

### B2 — Recovery verification is asynchronous and may initially return PENDING
- **ID:** B2
- **Title:** Recovery verification is asynchronous and may initially return PENDING
- **Area:** Recovery Verification
- **Current behavior:** Triggering recovery verification triggers an asynchronous evaluation job that initially returns `PENDING`.
- **Desired behavior:** Immediate synchronous validation or polling webhook/event stream for verification results.
- **Endpoint/schema:** `POST /api/events/{event_id}/recovery/verify`
- **Frontend fallback:** Display `VERIFYING / PENDING` status with polling refresh until backend marks verification passed or failed.
- **Severity:** Medium
- **Recommended backend fix:** Implement streaming verification progress or push notifications when complete.
- **Discovered in:** Task 5
- **Status:** DEFERRED

---

### B3 — Newly created events may have no materialized plan/tasks
- **ID:** B3
- **Title:** Newly created events may have no materialized plan/tasks
- **Area:** Event Planning & Task Generation
- **Current behavior:** Events in intake or initial discovery stages do not have tasks or execution schedules generated yet.
- **Desired behavior:** Clear draft blueprint schema or explicit empty state contract.
- **Endpoint/schema:** `GET /api/events/{event_id}/planning/blueprint`, `GET /api/events/{event_id}/tasks`
- **Frontend fallback:** Truthfully render empty state with "Blueprint pending initial planning pass" without fabricating synthetic tasks.
- **Severity:** Low
- **Recommended backend fix:** Provide a `planning_status: PENDING_BLUEPRINT` flag in event state.
- **Discovered in:** Task 6
- **Status:** DEFERRED

---

### B4 — No standalone task-to-provider reassignment endpoint
- **ID:** B4
- **Title:** No standalone task-to-provider reassignment endpoint
- **Area:** Task Management & Vendor Binding
- **Current behavior:** Reassignment requires navigating through the full vendor binding/recovery flow.
- **Desired behavior:** Direct `PATCH /api/events/{event_id}/tasks/{task_id}/assignment` endpoint.
- **Endpoint/schema:** `PATCH /api/events/{event_id}/tasks/{task_id}`
- **Frontend fallback:** Guide user to Vendor Procurement / Recovery Command workflows.
- **Severity:** Low
- **Recommended backend fix:** Expose lightweight task provider assignment endpoint.
- **Discovered in:** Task 6
- **Status:** DEFERRED

---

### B5 — No live WebSocket/SSE push stream; frontend currently polls
- **ID:** B5
- **Title:** No live WebSocket/SSE push stream; frontend currently polls
- **Area:** Real-time Telemetry & Live Operations
- **Current behavior:** The backend does not expose an SSE (`text/event-stream`) or WebSocket endpoint for real-time telemetry updates.
- **Desired behavior:** Server-Sent Events or WebSocket stream at `/api/events/{event_id}/live-stream`.
- **Frontend fallback:** Guarded heartbeat polling (4s–8s) active only when the document tab is visible to prevent leaks.
- **Severity:** Medium
- **Recommended backend fix:** Implement FastAPI SSE endpoint streaming Redis PubSub or database change events.
- **Discovered in:** Task 7
- **Status:** DEFERRED

---

### B6 — General live tasks do not expose individual verification state
- **ID:** B6
- **Title:** General live tasks do not expose individual verification state
- **Area:** Task Execution & Verification
- **Current behavior:** Task model has `status` (PENDING, IN_PROGRESS, COMPLETED, BLOCKED), but individual verification records are only created on recovery/incident flows.
- **Desired behavior:** Optional verification badge/record on all critical path milestone tasks.
- **Endpoint/schema:** `GET /api/events/{event_id}/tasks`
- **Frontend fallback:** Display status deterministically from backend `task.status` and show verification badge only when verified by backend.
- **Severity:** Low
- **Recommended backend fix:** Add `verification_id` or `verified_at` field to Task model and schemas.
- **Discovered in:** Task 7
- **Status:** DEFERRED

---

### B7 — Audit export endpoint unavailable
- **ID:** B7
- **Title:** Authoritative audit export endpoint unavailable
- **Area:** Observability & Audit
- **Current behavior:** Backend exposes `GET /api/events/{event_id}/audit` returning JSON items, but lacks a dedicated export endpoint (such as CSV or JSON format export).
- **Desired behavior:** Dedicated `GET /api/events/{event_id}/audit/export?format=csv|json` endpoint producing an authoritative export file with digital verification headers.
- **Endpoint/schema:** `GET /api/events/{event_id}/audit/export`
- **Frontend fallback:** Audit interface displays "Audit records are read-only in this interface." and does not fabricate client-side exports that could be mistaken for official backend audits.
- **Severity:** Low
- **Recommended backend fix:** Add streaming CSV/JSON export endpoint in `apps/api/app/api/routes/observability.py`.
- **Discovered in:** Task 8
- **Status:** DEFERRED

---

### B8 — Offset pagination missing on `/events/{event_id}/audit`
- **ID:** B8
- **Title:** Offset pagination unsupported on audit trail endpoint
- **Area:** Observability & Audit
- **Current behavior:** `GET /api/events/{event_id}/audit` supports `limit` (max 200) and `action_type`, but lacks `offset` or `cursor` parameters.
- **Desired behavior:** Support standard `offset: int` or cursor-based pagination with total count for large audit ledgers.
- **Endpoint/schema:** `GET /api/events/{event_id}/audit`
- **Frontend fallback:** Request up to `limit=100` records and use client-side search and action-type filtering without fabricating fake page numbers.
- **Severity:** Low
- **Recommended backend fix:** Add `offset: int = Query(0, ge=0)` and query count to `apps/api/app/api/routes/observability.py`.
- **Discovered in:** Task 8
- **Status:** DEFERRED

---

### B9 — Dedicated engine health/status endpoint unavailable
- **ID:** B9
- **Title:** Discrete backend engine health/status telemetry endpoint unavailable
- **Area:** Observability & Computational Engines
- **Current behavior:** Backend implements discrete deterministic engines (Planning, Schedule CPM, Budget, Impact, Risk, Recovery, Verification, State Machine), but exposes no persistent health probe or subsystem status endpoint for each engine.
- **Desired behavior:** `GET /api/observability/engines` endpoint returning health, version, and execution count telemetry for discrete engines.
- **Endpoint/schema:** `GET /api/observability/engines`
- **Frontend fallback:** Explicitly display "Engine health/status is not exposed by backend." and visualize engine capabilities and executed traces without inferring false health states.
- **Severity:** Low
- **Recommended backend fix:** Implement `/engines/status` endpoint querying engine subsystem status.
- **Discovered in:** Task 9
- **Status:** DEFERRED

---

### B10 — Standalone persistent agent run history endpoint unavailable
- **ID:** B10
- **Title:** Standalone persistent agent run history query endpoint unavailable
- **Area:** Event Operations Agent
- **Current behavior:** `POST /agent/events/{event_id}/run` returns immediate run responses with `tool_history`, and `ToolRegistry` stores in-memory traces, but there is no dedicated `GET /events/{event_id}/agent/runs` endpoint to list past agent execution runs.
- **Desired behavior:** Dedicated `GET /api/events/{event_id}/agent/runs` endpoint returning historical agent runs, step traces, and termination statuses.
- **Endpoint/schema:** `GET /api/events/{event_id}/agent/runs`
- **Frontend fallback:** Maintain latest run output in session state, render registered tools from `GET /agent/events/{event_id}/tools`, and visualize cross-lifecycle actions via `getActivityStream()`.
- **Severity:** Low
- **Recommended backend fix:** Persist `AgentRun` records to database and expose `/agent/runs` list endpoint.
- **Discovered in:** Task 9
- **Status:** DEFERRED

