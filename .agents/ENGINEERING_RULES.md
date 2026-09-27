# Engineering Rules: EVENTRA

These 25 rules are **NON-NEGOTIABLE**. Every AI coding agent working on this repository must strictly adhere to them.

---

### RULE 1: Backend is the source of truth.
The backend database and domain services hold the single authoritative state of the event. The frontend (React/Next.js) is a view layer, and the AI agent is an advisory/action coordinator. No state exists outside the backend.

### RULE 2: LLM output is never automatically trusted as deterministic truth.
An LLM output is a probabilistic proposal. Dates, budget numbers, capacity thresholds, and dependency ordering produced by an LLM must be validated by backend domain services before being persisted or acted upon.

### RULE 3: Agent decides what to do; deterministic engines calculate what is possible.
The AI Agent reasons about ambiguities, trade-offs, and strategic choices. The deterministic engines (dependency DAG, budget calculators, scheduling algebra) compute invariant checks and feasible solutions.

### RULE 4: Do not duplicate deterministic calculations inside prompts.
Never ask an LLM to calculate critical path latency, sum budget items, or detect graph cycles in a prompt. The agent calls deterministic tools that return exact mathematical answers.

### RULE 5: Do not put business logic inside React components.
Frontend components must be presentation-driven. State transitions, impact evaluations, permission checks, and data transformations belong in backend services or clean API response contracts.

### RULE 6: Do not put external API calls throughout the codebase.
Never make raw HTTP calls to Google Maps, Twilio, OpenAI, Anthropic, or external vendor APIs directly from UI components, background worker loops, or random utility files.

### RULE 7: All external integrations go through `integrations/`.
Every third-party dependency must be wrapped in a dedicated adapter inside the `integrations/` directory, exposing a typed internal interface.

### RULE 8: Backend permissions must be enforced server-side.
Hiding a button or route in the UI is purely a user experience convenience. Every API route and agent action must independently authorize the user's role, event membership, and action permissions on the server.

### RULE 9: High-impact actions must pass approval according to policy.
Any operational change that exceeds budget thresholds, modifies locked venue contracts, cancels key vendors, or alters critical-path schedules must produce a pending `Approval` record and block until signed off.

### RULE 10: Every state-changing action must eventually be verifiable.
When the system executes an operational action (e.g. reassigning a vendor, shifting a milestone), it must establish a verification criterion (telemetry check, provider acknowledgment, or manual confirmation).

### RULE 11: Simulation injects legitimate inputs. It never fakes outcomes.
Simulated test scenarios (e.g., vendor no-show) must inject the exact same incident payloads and state changes as real-world occurrences. Never hardcode simulated responses or bypass the calculation engines.

### RULE 12: Do not create multiple artificial agents.
EVENTRA operates with **ONE Event Operations Agent** equipped with specialized tools. Do NOT build separate Planning Agents, Budget Agents, Venue Agents, and Recovery Agents.

### RULE 13: Do not create giant files.
Keep files focused and manageable (ideally under 300 lines). Break components, engines, and routes into cohesive, single-responsibility modules.

### RULE 14: Do not create giant generic services.
Avoid "God classes" like `EventManager` or `GeneralService`. Create distinct, single-purpose services: `ScheduleService`, `ImpactEngine`, `VendorService`, `ApprovalService`.

### RULE 15: Do not silently introduce features marked REMOVE.
Do not sneak in attendee tables, ticketing portals, RSVP trackers, attendee social feeds, or autonomous financial transfers. Respect the non-goals in `FEATURE_SCOPE.md`.

### RULE 16: Do not silently turn DOUBT features into MVP requirements.
Features categorized under DOUBT or SPECIAL DOUBT (like cross-event machine learning memory or long-term vendor reputation algorithms) must not block or complicate MVP phases.

### RULE 17: Do not replace PostgreSQL with a graph database for the MVP.
All relational and dependency-graph requirements must be handled within PostgreSQL using adjacency schemas and Python/SQL graph traversal algorithms (topological sorting, critical path analysis). Do NOT introduce Neo4j.

### RULE 18: Do not create a separate attendee-management subsystem.
Guest count is strictly an aggregate scalar input (`guest_count: int`) for capacity and procurement math. Do not create attendee schemas, ticket badges, or guest lists.

### RULE 19: Venue/location is a first-class operational capability.
Venue modeling is not just an address string; it includes physical capacity, layout zones, power/AV facilities, loading dock constraints, travel distance, and ETA calculations.

### RULE 20: Provider Network and Procurement are separate concerns.
The **Provider Network** models who is in the ecosystem (vendors, specialties, rates, contracts). **Procurement** models the operational acquisition and reservation of specific items, equipment, or service slots for an event.

### RULE 21: Never bypass the event state.
All system components must interact through the canonical event state machine. No backdoor modifications or untracked state divergence.

### RULE 22: Never directly mutate event state from UI.
The frontend must dispatch typed command actions or API requests. The backend domain service processes the command, evaluates business rules, transitions state, and returns the updated aggregate.

### RULE 23: Critical objective protection overrides unrestricted autonomy.
When an incident threatens a hard-tier event objective (e.g., event start time, safety constraint), the system enters an escalated risk state, restricting autonomous execution and requiring human supervisor intervention.

### RULE 24: Before adding architecture, check whether an existing module already owns that responsibility.
Never invent a parallel directory, helper layer, or abstraction without inspecting the existing codebase first. Extend or compose existing modules.

### RULE 25: Prefer small composable modules over abstraction for abstraction's sake.
Avoid over-engineered class hierarchies, generic repository anti-patterns, and layers of indirection that add no concrete runtime value. Keep code readable, direct, and testable.


---

## Frontend V2 Rules

### RULE 26: Frontend must never fabricate operational state.

The frontend must never fabricate:

- provider availability
- venue availability
- capacity
- pricing
- quotes
- provider responses
- call outcomes
- WhatsApp delivery state
- discovery counts
- approval state
- incident state
- recovery outcomes
- execution state
- verification state
- audit events

If authoritative backend state is unavailable, render `UNKNOWN`, `NOT AVAILABLE`, loading, empty, or error state as appropriate.

---

### RULE 27: Frontend must preserve provenance.

Important operational information must retain its provenance where available.

Supported provenance categories:

- `AGENT`
- `ENGINE`
- `SOURCE`
- `HUMAN`
- `EXECUTED`
- `UNKNOWN`

The frontend must not silently convert agent proposals or external reports into deterministic truth.

---

### RULE 28: Frontend must not duplicate authoritative deterministic calculations.

React/frontend code must not independently calculate or decide:

- critical path
- schedule feasibility
- budget totals
- dependency validity
- provider ranking
- venue feasibility
- impact
- risk
- recovery feasibility
- approval policy

The frontend renders authoritative backend results.

---

### RULE 29: Frontend V2 must use the canonical Event Operations Agent model.

Frontend UX must represent one Event Operations Agent with specialized tools.

Do not introduce separate frontend concepts that imply independent Planning Agents, Budget Agents, Venue Agents, Recovery Agents, or other artificial autonomous agents.

---

### RULE 30: The main Frontend V2 workspace uses a clean light operational UI.

The primary V2 workspace must use:

- light background
- white cards
- subtle borders
- clear typography
- generous spacing
- semantic status colors
- evidence-rich panels

Do not reintroduce the previous dark/glass/sci-fi command-center aesthetic into the main V2 workspace.

Live operations and critical incidents may use stronger semantic alert treatment without turning the entire workspace dark.