# Testing Strategy: EVENTRA

Testing in EVENTRA is built to guarantee operational reliability under chaotic conditions. Tests ensure mathematical invariants hold and recovery workflows succeed end-to-end.

---

## 1. Unit Testing Layer

Unit tests isolate deterministic engines and state machines. They run in-memory with zero external API calls:

- **Dependency Traversal:** Topological sort ordering, cycle detection on cyclic task graphs, predecessor/successor chain validation.
- **Critical Path Calculation:** Correct identification of zero-slack tasks, earliest start time (EST) and latest finish time (LFT) calculations.
- **Impact Calculation:** Graph blast-radius propagation: verifying downstream task delay when an upstream task slips by $N$ minutes.
- **Risk Classification:** Deterministic scoring mapping schedule delay and objective threat to severity levels (`LOW`, `MEDIUM`, `HIGH`, `EMERGENCY`).
- **Schedule Feasibility:** Testing time overlap detection, buffer adequacy, and venue operating hour violations.
- **Budget Calculation:** Arithmetic precision for committed vs. spent amounts, variance calculations, and overspend threshold triggers.
- **Recovery Validation:** Feasibility checks confirming that a synthesized recovery plan resolves delays without violating hard constraints.
- **State Transitions:** Finite State Machine (FSM) validation: ensuring invalid transitions (e.g. `DRAFT` directly to `LIVE`) are rejected with explicit errors.

---

## 2. Integration Testing Layer

Integration tests verify interactions across internal subsystems, persistence, and external boundaries:

- **Database Persistence:** SQLAlchemy/SQLModel entity relationships, cascade behaviors, and PostgreSQL JSONB queries.
- **API Endpoints:** FastAPI route contracts, request validation, HTTP status codes, and server-side RBAC enforcement.
- **Integration Adapters:** Testing `integrations/maps/`, `integrations/venues/`, `integrations/whatsapp/` with recorded fixtures/VCR or clean mock contracts.
- **Agent Tool Execution:** Verifying that Agent tools correctly invoke underlying domain services and return structured tool responses.

---

## 3. Scenario Testing Layer (The Core Priority)

The **most critical tests in EVENTRA** are end-to-end operational scenario tests. These simulate real-world event crises through the full canonical loop:

```text
INCIDENT INJECTED
  ↓
DETECTION & PARSE
  ↓
IMPACT ANALYSIS (BLAST RADIUS)
  ↓
RISK SCORING (EMERGENCY IF CRITICAL OBJECTIVE THREATENED)
  ↓
RECOVERY SYNTHESIS (FEASIBILITY CHECKED)
  ↓
APPROVAL ROUTING (POLICY ENFORCED)
  ↓
ACTION DISPATCH (STATE UPDATED)
  ↓
VERIFICATION (TELEMETRY/CONFIRMATION)
  ↓
RECOVERED EVENT STATE CONFIRMED
```

### Core Scenario Test Suite:
1. **Vendor Delay:** A vendor is delayed by 45 minutes on a non-critical path. System absorbs delay into buffer without triggering emergency.
2. **Vendor No-Show:** Critical catering or AV vendor fails to arrive. System calculates critical path blockage, elevates risk to EMERGENCY, synthesizes backup vendor substitution within budget cap, routes approval, dispatches assignment, and verifies acceptance.
3. **Venue Issue:** Power failure or zone closure at selected venue. System evaluates affected tasks, queries alternative spaces/facilities, calculates transit & setup feasibility, and initiates relocation protocol.
4. **Resource Shortage:** Missing tables or audio equipment. System checks inventory, identifies procurement alternatives, and orders replacements without delaying opening remarks.
5. **Recovery Failure:** Proposed recovery rejected by human organizer or backup vendor declines. System re-evaluates, sheds lowest-priority flexible objective, and presents alternate recovery.
6. **Schedule Deviation Cascade:** Multi-task chain slippage tested to ensure topological order remains consistent after automated rescheduling.


---

# Frontend V2 Testing

Frontend V2 testing must verify that the UI correctly represents authoritative backend state without duplicating domain logic.

## Component Requirements

Major V2 components must correctly handle:

- real data
- loading state
- empty state
- error state
- unknown state
- provenance
- backend status transitions

## No Fabricated Operational State

The frontend must never fabricate:

- discovery counts
- provider availability
- venue availability
- pricing
- quotes
- provider responses
- communication state
- approval state
- incident state
- recovery state
- execution state
- verification state
- audit events

## Frontend V2 E2E Flow

EVENT
→ DISCOVERY
→ SHORTLIST
→ ENGAGEMENT
→ PROVIDER RESPONSE
→ EXTRACTION
→ VALIDATION
→ APPROVAL
→ EXECUTE
→ INCIDENT
→ IMPACT
→ RECOVERY
→ VERIFY
→ ACTIVITY / AUDIT

## Acceptance Checks

Verify that:

1. Event lifecycle is visible.
2. Venue discovery uses real backend state.
3. Vendor discovery uses real backend state.
4. Discovery funnel counts are authoritative.
5. Discovery iterations are visible where provided.
6. Candidate evidence is inspectable.
7. Provenance is visible.
8. Agent proposals are distinct from engine results.
9. Shortlisted providers transition into engagement.
10. Communication execution state is authoritative.
11. Provider messages are visible.
12. Provider responses can reach incident workflows.
13. Deterministic impact results are displayed.
14. Recovery discovery is visible.
15. Approval state is visible before consequential actions.
16. Execution and verification are visible.
17. Activity and audit reflect real backend events.
18. No frontend business logic duplicates backend calculations.
19. Unknown information remains unknown.
20. No fabricated operational state exists.