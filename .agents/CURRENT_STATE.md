# Current Development State: EVENTRA

## Overall Status

**STATUS:** BACKEND OPERATIONAL FOUNDATION COMPLETE — FRONTEND V2 IN PROGRESS

---

# Current Engineering Focus

EVENTRA is currently transitioning from the existing frontend experience to the Frontend V2 operational architecture.

The backend already contains the major domain, deterministic engine, agent, authorization, recovery, verification, and integration foundations required by the Frontend V2 experience.

The current priority is to expose the autonomous event-operations loop through a clean, evidence-driven frontend.

---

# Backend Foundation

The following major backend capabilities are implemented:

- Event lifecycle
- Event specification
- Venue discovery
- Provider/vendor discovery
- Planning
- Task management
- Dependencies
- Critical path / schedule engine
- Budget engine
- Live event state
- Incident detection
- Impact analysis
- Risk evaluation
- Recovery engine
- Authorization
- Collaboration
- Approval workflows
- Action execution
- Verification
- Audit trail
- Activity history
- Event Operations Agent
- LangGraph orchestration
- Autonomous decisioning
- Real-world integration layer
- Maps/geolocation integrations
- Notifications
- Provider communication
- WhatsApp integration
- External discovery adapters

Backend remains the authoritative source of truth.

---

# Frontend V2 Status

The existing frontend contains working operational functionality and several reusable components, but it does not yet represent the complete Frontend V2 architecture.

The new V2 architecture is being implemented incrementally.

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

---

# Current Frontend V2 Priority

The immediate implementation priority is:

DESIGN SYSTEM
    ↓
EVENT SHELL
    ↓
OVERVIEW
    ↓
AGENT / PROVENANCE
    ↓
DISCOVERY

Discovery is the first major product experience because it demonstrates EVENTRA's core autonomous workflow.

---

# Visual Direction

Frontend V2 uses a clean, light enterprise operational UI.

Primary workspace:

- light background
- white cards
- subtle borders
- dark typography
- generous whitespace
- restrained accent color
- semantic status colors
- evidence-rich panels

Avoid:

- dark primary workspace
- dark sidebar
- glassmorphism
- excessive glow
- excessive blur
- blueprint grids
- sci-fi/military command-center styling
- decorative dashboards

Live operations and critical incidents may use stronger semantic alert treatment.

The landing/marketing page remains frozen during the V2 migration.

---

# Architectural Rules

Frontend V2 must:

- render authoritative backend state
- preserve provenance
- clearly distinguish agent proposals from deterministic engine results
- clearly distinguish external source information from verified engine results
- show human approval states
- show execution and verification states
- keep unknown/unverified information explicitly unknown

Frontend V2 must never:

- duplicate deterministic business logic
- fabricate provider facts
- fabricate venue facts
- fabricate availability
- fabricate pricing
- fabricate quotes
- fabricate provider responses
- fabricate communication state
- fabricate approval state
- fabricate incident/recovery state
- bypass backend authorization
- bypass approval policy

---

# Current Backend / Frontend Boundary

Backend:

- source of truth
- state machines
- business rules
- deterministic calculations
- authorization
- approvals
- execution
- verification
- audit

Frontend:

- presentation
- operational control
- user intent
- approval interaction
- visualization
- live state display

Agent:

- reasoning
- tool selection
- orchestration
- interpretation
- proposals

Deterministic engines:

- feasibility
- schedule
- budget
- dependency
- impact
- risk
- recovery validation

---

# Frontend V2 Acceptance Target

The final frontend should make this loop visible:

DISCOVER
→ QUALIFY
→ SHORTLIST
→ CONTACT
→ CONVERSE
→ EXTRACT
→ VALIDATE
→ APPROVE
→ EXECUTE
→ MONITOR
→ INCIDENT
→ IMPACT
→ RECOVER
→ VERIFY

The complete flow must be backed by real backend state.

---

# Landing Page

**FROZEN**

Do not redesign or migrate the marketing/landing page as part of Frontend V2.

---

# Next Engineering Step

**NEXT = Frontend V2 Design System + EventShell**

Before implementing individual V2 pages, establish:

1. Clean light design system
2. EventShell
3. EventHeader
4. EventLifecycleStepper
5. V2 navigation
6. Shared operational UI primitives

After that, implement Overview and reusable Agent/Provenance primitives.