# Development Order: EVENTRA

The implementation of EVENTRA follows a strict 20-phase dependency-ordered sequence.

> **CRITICAL RULE FOR AI AGENTS:**  
> The AI must NOT skip ahead and implement a later subsystem if its foundational dependencies do not exist.  
> If a requested task touches a phase whose prerequisites are incomplete, you must identify and resolve the missing dependency first.

---

## The 20-Phase Implementation Sequence

```text
01 Database Model
  └── 02 Event Setup
        └── 03 Event Specification
              └── 04 Venue / Location Model + Discovery
                    └── 05 Provider Network + Assignments
                          └── 06 Planning Engine
                                └── 07 Dependency Engine
                                      └── 08 Live State Engine
                                            └── 09 Incident Engine
                                                  └── 10 Impact Engine
                                                        └── 11 Risk Engine
                                                              └── 12 Recovery Engine
                                                                    └── 13 Agent
                                                                          └── 14 Collaboration + Approval/RBAC
                                                                                └── 15 Action + Autonomy Policy
                                                                                      └── 16 Verification
                                                                                            └── 17 PWA/UI
                                                                                                  └── 18 Notifications + Integrations
                                                                                                        └── 19 Analytics + Audit
                                                                                                              └── 20 Simulation / Demo Hardening
```

---

## Phase Breakdown & Deliverables

### Phase 01: Database Model
- Base SQLAlchemy/SQLModel entities, PostgreSQL connection pooling, Alembic migrations.
- Core schema: User, Event, EventMember, Role, Task, Dependency, Venue, Vendor, Incident, Recovery, Approval.

### Phase 02: Event Setup
- Event creation lifecycle, base metadata (title, dates, target guest count scalar, overall budget).
- State initialization: Draft state machine.

### Phase 03: Event Specification
- Structured event requirements (budget caps, venue constraints, timing windows, operational objectives).
- Objective priority tagging (Critical vs. Flexible).

### Phase 04: Venue / Location Model + Discovery
- Venue schema: physical capacity, zoning, loading docks, facilities, pricing, geocoding.
- Venue discovery service: geospatial distance, drive time, availability filtering, and selection locking.

### Phase 05: Provider Network + Assignments
- Vendor catalog: operational categories (Catering, AV/Lighting, Security, Decor), service rate models.
- Vendor assignment to event and task requirements with contract status tracking.

### Phase 06: Planning Engine
- Work breakdown structure (WBS) synthesis: tasks, milestones, durations, required resources, cost estimates.
- Baseline schedule compilation.

### Phase 07: Dependency Engine
- Directed Acyclic Graph (DAG) construction: finish-to-start, start-to-start relationships.
- Deterministic topological sorting, cycle detection, critical path calculation, and buffer slack math.

### Phase 08: Live State Engine
- Transition from `Planned` to `Live` state.
- Real-time task progress tracker, check-in markers, active timeline progression, and milestone completion.

### Phase 09: Incident Engine
- Incident model and intake: manual reporter, vendor message parse, sensor/telemetry trigger.
- Incident status lifecycle: Reported -> Investigating -> Confirmed -> Recovering -> Resolved.

### Phase 10: Impact Engine
- Graph blast-radius traversal originating from an incident root cause.
- Downstream task delay propagation, resource blockage calculation, and budget variance assessment.

### Phase 11: Risk Engine
- Deterministic scoring: delay magnitude vs. schedule slack, threat to critical objectives, budget exposure.
- Severity classification: Low, Medium, High, Emergency.

### Phase 12: Recovery Engine
- Deterministic formulation of viable recovery strategies:
  1. Task re-sequencing / compression.
  2. Backup vendor substitution.
  3. Resource re-allocation.
  4. Non-critical scope shedding.
- Feasibility check across budget, capacity, and deadlines.

### Phase 13: Agent (Single Event Operations Agent)
- Reasoning orchestrator wrapping deterministic tools via LangGraph / typed tool bindings.
- Natural language query handling, situation summarization, trade-off explanation, and strategy recommendation.

### Phase 14: Collaboration + Approval / RBAC
- Role-based access control: Main Organizer, Event Manager, Collaborator, Vendor, Viewer.
- Server-side authorization barriers and pending `Approval` generation for high-impact actions.

### Phase 15: Action + Autonomy Policy
- Autonomy tier execution: automated dispatch for low-risk approved actions vs. locked human review for critical changes.
- Execution runner dispatching task adjustments and vendor re-assignments.

### Phase 16: Verification
- Verification criteria registry: provider confirmation, manual supervisor check-off, or physical telemetry check.
- Incident closure and recovery validation.

### Phase 17: PWA / UI
- Next.js Progressive Web App with responsive mobile-first views.
- Real-time command center, live timeline, incident alerts, approval queues, and task execution cards.

### Phase 18: Notifications + Integrations
- Push notification adapter, WhatsApp inbound/outbound communication adapter, external maps geocoding.
- Webhook ingest pipelines.

### Phase 19: Analytics + Audit
- Immutable audit log of all decisions, state transitions, and approvals.
- Post-event operational metrics: recovery efficiency, schedule variance, vendor SLA adherence.

### Phase 20: Simulation / Demo Hardening
- Realistic scenario injectors: Vendor No-Show, Venue Issue, Supply Shortage.
- Verification that inputs flow through the authentic pipeline without mocked shortcuts.


---

# Frontend V2 Implementation Order

The canonical backend/domain development order above remains authoritative.

Frontend V2 is a presentation-layer implementation sequence built on top of the existing backend capabilities.

Frontend V2 must not replace or reorder the backend dependency architecture.

## Frontend V2 Sequence

1. Frontend V2 Design System
2. EventShell + EventHeader + Lifecycle
3. Overview
4. AgentPanel + AgentActivityStream + ProvenanceBadge
5. Discovery Command Architecture
6. Venue Discovery
7. Vendor Discovery
8. Shortlist → Engagement
9. Conversation UI
10. Call + WhatsApp Execution Status
11. Response Extraction + Quote Comparison
12. Provider Signal → Incident
13. Impact Visualization
14. Recovery Workflow
15. Approval / Authorization UX
16. Event Blueprint
17. Timeline + Budget
18. Live Operations Migration
19. Activity
20. Audit
21. Responsive / PWA
22. Fake / Demo Data Audit
23. API Contract Audit
24. Full E2E Validation
25. Final Cleanup

## Frontend V2 Gates

### Gate 1

Before Discovery implementation, these must work:

- Design System
- EventShell
- Overview
- Agent primitives

### Gate 2

Before Engagement implementation, these must work using real backend state:

- Discovery architecture
- Venue Discovery
- Vendor Discovery

### Gate 3

Before secondary pages receive final polish, this core loop must work:

DISCOVERY
→ SHORTLIST
→ ENGAGEMENT
→ RESPONSE
→ VALIDATION
→ INCIDENT
→ IMPACT
→ RECOVERY