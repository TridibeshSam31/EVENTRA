# EVENTRA Backend Gap Register

This register documents genuine backend architectural and contract limitations discovered during development and audits.
All gaps B1 through B11 have been fully resolved with comprehensive test coverage.

---

### B1 — Missing arbitrary dependency graph edges for some non-CPM incidents
- **ID:** B1
- **Title:** Missing arbitrary dependency graph edges for some non-CPM incidents
- **Area:** Planning & Incident Impact Analysis
- **Current behavior:** Authoritative impact propagation assembles and returns explicit directed graph edges for non-CPM incidents, including incident-to-task (`INCIDENT_TO_TASK`), provider-to-task (`PROVIDER_TO_TASK`), and resource-to-task (`RESOURCE_TO_TASK`) alongside CPM critical path edges.
- **Endpoint/schema:** `GET /api/events/{event_id}/impact`
- **Resolution Details:** Extended `ImpactAnalyzer.analyze()` and `ImpactPropagationEngine.propagate()` in `apps/api/app/engines/impact/` to assemble directed graph edges with source, target, and edge type.
- **Test Suite:** `apps/api/tests/unit/engines/test_impact_edges.py` (4/4 passed)
- **Severity:** Medium
- **Status:** RESOLVED

---

### B2 — Recovery verification is asynchronous and may initially return PENDING
- **ID:** B2
- **Title:** Recovery verification is asynchronous and may initially return PENDING
- **Area:** Recovery Verification
- **Current behavior:** Truthful verification lifecycle endpoint and trigger endpoint expose explicit states (`PENDING`, `IN_PROGRESS`, `VERIFIED`, `FAILED`) without fabricating synchronous success.
- **Endpoint/schema:** `GET /events/{event_id}/incidents/{incident_id}/recovery/verification`, `POST /events/{event_id}/incidents/{incident_id}/recovery/verify`
- **Resolution Details:** Added verification state query endpoint and trigger endpoint in `apps/api/app/api/routes/recovery.py` and `apps/api/app/services/action_service.py`, returning truthful state and verification metrics.
- **Test Suite:** `apps/api/tests/integration/api/test_recovery_verification_lifecycle.py` (3/3 passed)
- **Severity:** Medium
- **Status:** RESOLVED

---

### B3 — Newly created events may have no materialized plan/tasks
- **ID:** B3
- **Title:** Newly created events may have no materialized plan/tasks
- **Area:** Event Planning & Task Generation
- **Current behavior:** Explicit materialization state machine (`PENDING_PLAN`, `EMPTY`, `MATERIALIZED`, `FAILED`) is tracked and exposed. Unmaterialized plans return truthful status rather than synthetic placeholder tasks.
- **Endpoint/schema:** `GET /events/{event_id}/planning/blueprint`, `GET /events/{event_id}/schedule`
- **Resolution Details:** Added `planning_status` to planning schemas and services. Schedule route validates materialization state and returns typed error when plan is unmaterialized.
- **Test Suite:** `apps/api/tests/integration/api/test_plan_materialization_lifecycle.py` (3/3 passed)
- **Severity:** Low
- **Status:** RESOLVED

---

### B4 — No standalone task-to-provider reassignment endpoint
- **ID:** B4
- **Title:** No standalone task-to-provider reassignment endpoint
- **Area:** Task Management & Vendor Binding
- **Current behavior:** Lightweight, authoritative task-to-provider reassignment endpoints are exposed with strict event isolation, RBAC validation, and audit recording.
- **Endpoint/schema:** `PATCH /events/{event_id}/tasks/{task_id}/provider`, `POST /events/{event_id}/tasks/{task_id}/reassign-provider`
- **Resolution Details:** Implemented `VendorTaskBindingService.reassign_task_provider()` in `apps/api/app/services/vendor_task_binding_service.py` with auto-unbinding, existence checks, and audit logging.
- **Test Suite:** `apps/api/tests/integration/api/test_task_provider_reassignment.py` (6/6 passed)
- **Severity:** Low
- **Status:** RESOLVED

---

### B5 — No live WebSocket/SSE push stream; frontend currently polls
- **ID:** B5
- **Title:** No live WebSocket/SSE push stream; frontend currently polls
- **Area:** Real-time Telemetry & Live Operations
- **Current behavior:** Server-Sent Events (SSE) push stream and versioned polling change feed are exposed with live task and telemetry event broadcasts.
- **Endpoint/schema:** `GET /api/events/{event_id}/live-stream`, `GET /api/events/{event_id}/live-changes`
- **Resolution Details:** Created `LiveStateBroker` in `apps/api/app/services/live_broker.py` for asyncio event broadcast. Implemented SSE endpoint with heartbeat and finite-client frame limits, plus an ETag-versioned change feed.
- **Test Suite:** `apps/api/tests/integration/api/test_live_state_and_verification.py` (2/2 passed)
- **Severity:** Medium
- **Status:** RESOLVED

---

### B6 — General live tasks do not expose individual verification state
- **ID:** B6
- **Title:** General live tasks do not expose individual verification state
- **Area:** Task Execution & Verification
- **Current behavior:** Tasks track discrete `verification_status` (`UNVERIFIED`, `PENDING_VERIFICATION`, `EXECUTED`, `VERIFIED`, `FAILED`), `verified_at`, and `verification_notes`. Marking a task COMPLETED transitions verification to `EXECUTED` (never falsely `VERIFIED`).
- **Endpoint/schema:** `PATCH /api/events/{event_id}/tasks/{task_id}/verification`
- **Resolution Details:** Added verification fields to `Task` database model and schemas. Added verification update endpoint and wired `LiveStateService.update_task_status()` to maintain truthful execution verification.
- **Test Suite:** `apps/api/tests/integration/api/test_live_state_and_verification.py` (2/2 passed)
- **Severity:** Low
- **Status:** RESOLVED

---

### B7 — Audit export endpoint unavailable
- **ID:** B7
- **Title:** Authoritative audit export endpoint unavailable
- **Area:** Observability & Audit
- **Current behavior:** Authoritative export endpoint generates downloadable JSON or CSV exports with secret redaction and digital provenance headers (`X-Audit-Record-Count`, `X-Audit-Generated-At`).
- **Endpoint/schema:** `GET /api/events/{event_id}/audit/export`
- **Resolution Details:** Implemented streaming JSON/CSV export in `AuditRecorder.export_records()` and `apps/api/app/api/routes/observability.py` with RBAC authorization (`EVENT_DIRECTOR`, `SAFETY_LEAD`).
- **Test Suite:** `apps/api/tests/integration/api/test_audit_export_and_pagination.py` (3/3 passed)
- **Severity:** Low
- **Status:** RESOLVED

---

### B8 — Offset pagination missing on `/events/{event_id}/audit`
- **ID:** B8
- **Title:** Offset and cursor pagination unsupported on audit trail endpoint
- **Area:** Observability & Audit
- **Current behavior:** Audit trail endpoint supports both offset (`offset: int`) and base64 cursor (`cursor: str`) pagination with composite deterministic ordering (`created_at DESC, id DESC`).
- **Endpoint/schema:** `GET /api/events/{event_id}/audit`
- **Resolution Details:** Added `list_records_paginated()` in `AuditRecorder` with total count, `next_cursor`, and composite database index `ix_audit_records_event_created_id`.
- **Test Suite:** `apps/api/tests/integration/api/test_audit_export_and_pagination.py` (2/2 passed)
- **Severity:** Low
- **Status:** RESOLVED

---

### B9 — Dedicated engine health/status endpoint unavailable
- **ID:** B9
- **Title:** Discrete backend engine health/status telemetry endpoint unavailable
- **Area:** Observability & Computational Engines
- **Current behavior:** Discrete telemetry endpoint returns operational health and subsystem status across all deterministic computational engines without exposing credentials.
- **Endpoint/schema:** `GET /health/engines`, `GET /api/health/engines`
- **Resolution Details:** Implemented multi-engine probe inspecting Database, Planning, Schedule CPM, Impact Propagation, Recovery, Agent & Tool Registry, Scraper, and Notification engines in `apps/api/app/api/routes/health.py`.
- **Test Suite:** `apps/api/tests/integration/api/test_engine_health.py` (2/2 passed)
- **Severity:** Low
- **Status:** RESOLVED

---

### B10 — Standalone persistent agent run history endpoint unavailable
- **ID:** B10
- **Title:** Standalone persistent agent run history query endpoint unavailable
- **Area:** Event Operations Agent
- **Current behavior:** All agent execution runs, step traces, tool executions, and termination reasons are persisted to the database and queryable via dedicated endpoints with secret redaction.
- **Endpoint/schema:** `GET /api/events/{event_id}/agent/runs`, `GET /api/events/{event_id}/agent/runs/{run_id}`
- **Resolution Details:** Created `AgentRun` database model, updated `EventOperationsAgent.run()` to persist execution records, and added run history endpoints in `apps/api/app/api/routes/agent.py`.
- **Test Suite:** `apps/api/tests/integration/api/test_agent_run_history.py` (4/4 passed)
- **Severity:** Low
- **Status:** RESOLVED

---

### B11 — No dedicated offline mutation reconciliation or operational sync-replay endpoint
- **ID:** B11
- **Title:** No dedicated offline mutation reconciliation or operational sync-replay endpoint
- **Area:** PWA & Offline Operations
- **Current behavior:** Batch mutation reconciliation endpoint processes queued operations with idempotency keys, SHA-256 payload fingerprinting, atomic per-operation rollback, and conflict detection.
- **Endpoint/schema:** `POST /api/events/{event_id}/reconciliation/batch`
- **Resolution Details:** Created `IdempotencyRecord` database model, `IdempotencyService` in `apps/api/app/core/idempotency.py`, and batch reconciliation handler in `apps/api/app/api/routes/reconciliation.py`.
- **Test Suite:** `apps/api/tests/integration/api/test_idempotency_reconciliation.py` (5/5 passed)
- **Severity:** Medium
- **Status:** RESOLVED

---

## Operational Environment Limitations (External Services)
- **Twilio SMS Rate Limit:** Real external integration tests against live Twilio (`test_phase12_integration_scenarios.py`, `test_voice_recovery.py`) are subject to the external provider's daily quota (50 SMS/day max, HTTP 429). These tests are truthfully categorized as **BLOCKED — ENVIRONMENT** when provider quotas are exhausted, per the real integration verification policy.
