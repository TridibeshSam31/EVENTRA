# EVENTRA Frontend V2

## Purpose

EVENTRA Frontend V2 exposes the complete autonomous event-operations loop through a clear, evidence-driven operational workspace.

The frontend must communicate that EVENTRA is not merely a planning dashboard or chatbot.

EVENTRA should allow users to understand:

EVENT SPECIFICATION
        ↓
AGENT DISCOVERY
        ↓
QUALIFICATION
        ↓
SHORTLIST
        ↓
ENGAGEMENT
        ↓
RESPONSES
        ↓
EXTRACTION
        ↓
VALIDATION
        ↓
APPROVAL
        ↓
EXECUTION
        ↓
LIVE OPERATIONS
        ↓
INCIDENT
        ↓
IMPACT
        ↓
RECOVERY
        ↓
VERIFY
        ↓
UPDATED EVENT STATE

The frontend is successful when a user can observe this loop using real backend state while clearly understanding the boundary between:

- what the agent proposed
- what the deterministic engine verified
- what the external world reported
- what a human approved
- what EVENTRA actually executed
- what remains unknown or unverified

---

# 1. Architectural Principles

## 1.1 Backend is the source of truth

The frontend is a presentation and operational-control layer.

It must never become a second domain engine.

Backend services remain authoritative for:

- event state
- event specification
- task state
- dependencies
- schedule
- critical path
- budget
- venue qualification
- provider qualification
- ranking
- risk
- impact
- recovery feasibility
- approvals
- authorization
- execution
- verification

---

## 1.2 Agent vs deterministic engine

EVENTRA has one Event Operations Agent.

The agent:

- reasons through ambiguity
- selects tools
- proposes actions
- coordinates workflows
- interprets external responses
- proposes recovery options

Deterministic engines:

- calculate feasibility
- validate constraints
- calculate schedules
- calculate budget
- calculate dependencies
- calculate impact
- validate recovery
- enforce policy

React must never duplicate authoritative deterministic calculations.

---

# 2. Frontend Information Architecture

EVENTRA

├── OVERVIEW
│
├── DISCOVERY
│   ├── Venue Discovery
│   └── Vendor Discovery
│
├── PLANNING
│   ├── Event Blueprint
│   ├── Tasks
│   ├── Timeline
│   └── Budget
│
├── ENGAGEMENT
│   ├── Conversations
│   ├── Calls
│   ├── WhatsApp
│   ├── Outreach
│   └── Quotes
│
├── OPERATIONS
│   ├── Command Center
│   ├── Incidents
│   ├── Recovery
│   └── Approvals
│
└── TRUST
    ├── Activity
    └── Audit

The existing backend route architecture remains authoritative.

Frontend V2 may introduce cleaner route grouping and compatibility redirects, but must not break existing working routes during migration.

---

# 3. Event Lifecycle

Every event page must expose the operational lifecycle:

DEFINE
  ↓
DISCOVER
  ↓
PLAN
  ↓
READY
  ↓
LIVE
  ↓
RECOVER

The current lifecycle step must be visible without requiring the user to open multiple menus.

The event header should expose, where available:

- event name
- event type
- date
- location
- guest count
- current lifecycle state
- operational state
- active incident state
- current major blocker

Guest count is only an aggregate event requirement.

The frontend must never introduce attendee-management functionality.

---

# 4. Visual Design Direction

## 4.1 Primary workspace

The primary EVENTRA workspace uses a clean, light enterprise SaaS visual language.

Target:

- light page background
- white cards
- subtle borders
- dark readable typography
- generous whitespace
- restrained accent color
- compact operational metadata
- clear information hierarchy
- semantic status colors
- evidence-rich panels

The visual cleanliness should be comparable to a premium enterprise operations dashboard.

## 4.2 Explicitly avoid

Do not use the old dark/glass command-center aesthetic for the main V2 workspace.

Avoid:

- dark sidebar
- dark primary workspace
- glassmorphism
- excessive blur
- excessive glow
- blueprint grids
- background beams
- sci-fi control-room styling
- military command-center styling
- giant decorative gradients
- decorative cards with little information
- unnecessary animation

Animations may be used only when they communicate meaningful state transitions.

## 4.3 Operational alerts

Live operations and critical incidents may use stronger semantic treatment.

Use:

- warning
- critical
- emergency
- success

states clearly.

Do not turn the entire application into a dark emergency dashboard.

The normal workspace remains light and calm.

---

# 5. Provenance System

Important operational information must preserve provenance.

Supported provenance categories:

- AGENT
- ENGINE
- SOURCE
- HUMAN
- EXECUTED
- UNKNOWN

The frontend should visually distinguish:

### AGENT

A reasoning or orchestration result proposed by the Event Operations Agent.

### ENGINE

A deterministic backend result or validation.

### SOURCE

Information originating from an external provider, map source, communication channel, or other external system.

### HUMAN

A human action, decision, approval, rejection, override, or manual confirmation.

### EXECUTED

An action that EVENTRA actually executed through an authorized backend workflow.

### UNKNOWN

Information that is unavailable, unverified, or not authoritative.

The frontend must never silently convert UNKNOWN into a known value.

---

# 6. Agent UI

Reusable components should include:

- EventShell
- EventHeader
- EventLifecycleStepper
- AgentPanel
- AgentActivityStream
- EngineStatusCard
- ProvenanceBadge

Agent UI should expose:

- current objective
- current operational state
- current action
- proposed action
- execution status
- relevant explanation
- timestamp
- provenance

Do not expose hidden chain-of-thought.

Only display backend-provided reasoning summaries or explanations.

---

# 7. Discovery Architecture

Discovery is one of EVENTRA's core product experiences.

The reusable discovery architecture should support:

- DiscoveryMap
- DiscoveryFunnel
- DiscoveryRunPanel
- DiscoveryIteration
- CandidateMarker
- CandidateEvidenceDrawer
- CandidateScoreBreakdown
- ShortlistPanel

Discovery pipeline:

SEARCH
 ↓
RAW DISCOVERY
 ↓
NORMALIZE
 ↓
DEDUPLICATE
 ↓
QUALIFY
 ↓
MATCH
 ↓
RANK
 ↓
SHORTLIST

The frontend should show real backend counts for:

- discovered
- unique
- relevant / qualified
- matching
- shortlisted

The frontend must never fabricate these values.

---

# 8. Adaptive Discovery

When the backend performs multiple discovery iterations, the frontend should make them visible.

Show where available:

- iteration number
- query
- radius
- search strategy
- candidates found
- candidates qualified
- candidates rejected
- adaptive decision
- next iteration
- stop condition
- timeout/failure

The frontend renders backend discovery decisions.

It does not implement discovery strategy itself.

---

# 9. Candidate Evidence

A candidate must be inspectable.

Candidate evidence may include:

- provider/venue name
- source
- address
- category
- rating
- review count
- distance
- website
- phone
- description
- qualification
- confidence
- matching reasons
- score breakdown
- source fields
- unknown fields

Every important field should preserve provenance where available.

The frontend must never fabricate:

- capacity
- pricing
- availability
- provider response
- quote
- service capability

If unavailable:

UNKNOWN

or:

NOT AVAILABLE

---

# 10. Venue Discovery

Venue Discovery must support:

- real map
- real discovery results
- discovery funnel
- adaptive iterations
- radius
- candidate evidence
- qualification
- ranking
- shortlist

Event constraints must come from backend state.

Possible constraints include:

- location
- guest count
- event type
- budget
- radius
- amenities
- date
- facilities

The frontend must not reproduce venue-scoring logic.

---

# 11. Vendor Discovery

Vendor Discovery uses the same reusable Discovery Command architecture.

Supported categories depend on backend provider capabilities.

Examples:

- catering
- decor
- photography
- videography
- AV
- DJ/music
- lighting
- entertainment
- transport
- security
- staffing

The frontend must use real backend discovery data.

It must never fabricate:

- vendors
- pricing
- availability
- ratings
- provider responses

---

# 12. Engagement

Shortlisted providers should transition naturally into Engagement.

Lifecycle:

SHORTLISTED
 ↓
OUTREACH READY
 ↓
CONTACTED
 ↓
AWAITING RESPONSE
 ↓
RESPONSE RECEIVED
 ↓
VALIDATED
 ↓
APPROVAL / AUTO EXECUTE
 ↓
CONFIRMED

The frontend must reflect actual backend state.

It must never display CONTACTED, CONFIRMED, or EXECUTED merely because a button was clicked.

---

# 13. Conversations

Reusable communication components include:

- EngagementDashboard
- ConversationPanel
- WhatsAppMessageBubble
- CallExecutionCard
- ResponseExtractionPanel
- QuoteComparison

Conversation UI must show:

- original message
- sender
- receiver
- timestamp
- channel
- delivery status
- inbound/outbound direction
- provenance
- execution state

Supported communication channels depend on actual backend integrations.

---

# 14. Communication Execution

Communication execution states must come from backend integration state.

Possible call states:

- QUEUED
- DISPATCHING
- SENT
- DELIVERED
- RINGING
- ANSWERED
- IN_PROGRESS
- COMPLETED
- FAILED
- UNKNOWN

Possible WhatsApp states:

- QUEUED
- SENT
- DELIVERED
- FAILED
- RECEIVED
- UNKNOWN

Never claim a communication succeeded without authoritative backend confirmation.

---

# 15. Response Extraction

Provider responses should be represented as:

ORIGINAL MESSAGE
      ↓
AGENT EXTRACTION
      ↓
DETERMINISTIC VALIDATION
      ↓
DECISION / APPROVAL

Possible extracted facts:

- availability
- date
- capacity
- price
- services
- constraints
- exclusions
- response status

Extracted facts are not automatically deterministic truth.

They must remain marked as agent-extracted until validated by the appropriate deterministic backend logic.

---

# 16. Quote Comparison

QuoteComparison should compare structured backend quote data.

The frontend must not decide:

- which quote is feasible
- whether the price is within budget
- whether capacity is sufficient
- whether availability is valid

Those decisions belong to authoritative backend engines.

---

# 17. Incidents

Provider signals may result in incidents.

Example:

PROVIDER MESSAGE
"I won't be able to come."

        ↓

AGENT INTERPRETATION
PROVIDER_UNAVAILABLE

        ↓

INCIDENT

        ↓

IMPACT

        ↓

RECOVERY

The frontend must display the backend interpretation and incident state.

It must not perform the incident classification itself.

---

# 18. Impact

ImpactAnalysisCard should expose deterministic backend results:

- affected tasks
- blocked tasks
- dependent tasks
- schedule impact
- critical path impact
- budget impact
- severity
- affected providers/resources

The frontend does not calculate graph impact.

---

# 19. Recovery

Recovery workflow:

INCIDENT
 ↓
IMPACT
 ↓
RECOVERY OPTIONS
 ↓
BACKUP DISCOVERY
 ↓
QUALIFICATION
 ↓
CONTACT
 ↓
RESPONSE
 ↓
VALIDATION
 ↓
APPROVAL / AUTO EXECUTE
 ↓
REPLACE
 ↓
VERIFY
 ↓
RESUME

Recovery UI should clearly distinguish:

- agent-proposed recovery
- engine-verified recovery
- approval required
- approved
- executed
- verified

Recovery outcomes must come from backend state.

---

# 20. Authorization UX

Consequential actions follow:

AGENT PROPOSES
 ↓
POLICY CHECK
 ↓
AUTO EXECUTE
OR
APPROVAL REQUIRED
 ↓
TOOL EXECUTION
 ↓
VERIFICATION

The frontend should show why approval is required where backend policy information is available.

Never bypass backend authorization by hiding or showing a button.

---

# 21. Planning

Planning UI includes:

- EventBlueprint
- Tasks
- CriticalPathTimeline
- BudgetHealth

Planning pages render backend-authoritative results.

React must not recalculate:

- critical path
- schedule feasibility
- budget totals
- dependency validity
- recovery feasibility

---

# 22. Live Operations

The existing Live Command Center remains important.

However, it is the EXECUTION phase of EVENTRA rather than the identity of the entire product.

Live Operations should expose:

- live state
- task progress
- active incidents
- provider state
- operational alerts
- current milestones
- approvals
- recovery state

The V2 visual system should be used.

---

# 23. Activity and Audit

Activity represents the unified operational event stream.

It may contain:

- agent actions
- engine decisions
- discovery
- provider communication
- approvals
- execution
- incidents
- recovery
- verification
- human actions

Audit represents authoritative historical state and action records.

The frontend must not fabricate audit records.

---

# 24. Responsive / PWA

EVENTRA is a desktop planning and mobile operational PWA.

Mobile priorities:

1. Live state
2. Incidents
3. Approvals
4. Recovery
5. Provider contact
6. Location
7. Timeline
8. Notifications

Critical actions must never execute offline.

If disconnected:

Offline — Showing state from HH:MM

must be visible.

Read-only cached state may be shown.

Critical actions remain disabled until authoritative backend connectivity is restored.

---

# 25. Component System

The V2 component system should include:

EventShell
EventLifecycleStepper
EventHeader

AgentPanel
AgentActivityStream
EngineStatusCard
ProvenanceBadge

DiscoveryMap
DiscoveryFunnel
DiscoveryRunPanel
DiscoveryIteration
CandidateMarker
CandidateEvidenceDrawer
CandidateScoreBreakdown
ShortlistPanel

EngagementDashboard
ConversationPanel
CallExecutionCard
WhatsAppMessageBubble
ResponseExtractionPanel
QuoteComparison

IncidentPanel
ImpactAnalysisCard
RecoveryOptions

ApprovalCard
ActionExecutionTimeline

EventBlueprint
CriticalPathTimeline
BudgetHealth

AuditTimeline

Components must remain focused and reusable.

Avoid giant components.

---

# 26. No-Fake-Data Rule

The frontend must never fabricate operational state.

Forbidden fabricated data includes:

- provider availability
- venue availability
- capacity
- pricing
- quotes
- provider responses
- call outcomes
- WhatsApp delivery state
- discovery counts
- approval status
- incident state
- recovery outcome
- execution state
- audit events
- verification results

When authoritative information is unavailable:

UNKNOWN

or an appropriate loading/empty/error state must be shown.

---

# 27. Backend / Frontend Boundary

The frontend may:

- fetch backend state
- submit user intent
- request actions
- request approval
- display backend results
- display loading/error/empty states
- format data for presentation

The frontend must not:

- write directly to the database
- calculate authoritative business values
- bypass RBAC
- bypass approval
- perform external integration calls directly
- invent operational state
- replace deterministic engines

---

# 28. Frontend V2 Implementation Order

Implement in this order:

1. Frontend V2 design system
2. EventShell + EventHeader + Lifecycle
3. Overview
4. AgentPanel + AgentActivityStream + ProvenanceBadge
5. Discovery Command Architecture
6. Venue Discovery
7. Vendor Discovery
8. Shortlist → Engagement
9. Conversation UI
10. Call + WhatsApp execution status
11. Response extraction + Quote Comparison
12. Provider signal → Incident
13. Impact visualization
14. Recovery workflow
15. Approval / Authorization
16. Event Blueprint
17. Timeline + Budget
18. Live Operations migration
19. Activity
20. Audit
21. Responsive/PWA
22. Fake/demo data audit
23. API contract audit
24. Full E2E validation
25. Final cleanup

Do not skip foundational UI architecture to build isolated pages.

---

# 29. Frontend V2 Acceptance Criteria

Frontend V2 is considered operationally complete when:

- A new user understands EVENTRA's purpose from the first screen.
- Event lifecycle is always visible.
- Venue discovery shows a real map.
- Vendor discovery shows a real map.
- Discovery funnel displays real backend counts.
- Adaptive discovery iterations are visible.
- Candidates can be inspected with evidence.
- Candidate provenance is visible.
- Agent proposals are visually distinct from deterministic engine results.
- Shortlisted providers can transition into engagement.
- Call and WhatsApp execution states are visible.
- Incoming provider messages are visible.
- Provider responses can become incidents through backend workflows.
- Impact analysis is visible.
- Recovery discovery is visible.
- Backup provider engagement is visible.
- Provider responses show structured extracted facts.
- Deterministic validation is visible.
- Approval state is visible before consequential actions.
- Every consequential action has execution/audit visibility.
- Unknown facts remain unknown.
- No frontend business logic duplicates authoritative backend calculations.
- No fabricated operational facts exist.
- Landing page remains unchanged.