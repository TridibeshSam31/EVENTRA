# Agent Node Modularization (Refactor Target)

> **IMPORTANT**: The files in this directory (`observe.py`, `interpret.py`, `investigate.py`, `plan.py`, `reevaluate.py`, `act.py`, `verify.py`) are **currently unused stubs**.
>
> All live operational node functions and state transitions for the autonomous agent are implemented inline in [`apps/api/app/agent/graph.py`](../graph.py).

## Purpose of this Directory

This directory is preserved as the designated target for future refactoring to decompose the monolithic `EventOperationsAgent` (~900 lines in `graph.py`) into discrete, unit-testable node handlers:

- `observe.py`: Event state telemetry collection, health checks, timeline drift observation.
- `interpret.py`: Incident categorization, severity assessment, urgency calculation.
- `investigate.py`: Querying affected vendors, venue constraints, and schedule dependencies.
- `plan.py`: Generating deterministic recovery options and evaluating feasibility against budget/schedule engines.
- `reevaluate.py`: Adjusting plans upon partial progress, timeouts, or counter-proposals.
- `act.py`: Dispatching communications (WhatsApp, Exotel voice) and requesting human approval for consequential mutations.
- `verify.py`: Post-execution confirmation, state hashing, and task binding validation.

Until this modularization refactoring is executed, **any modifications to agent behavior must be made directly in `apps/api/app/agent/graph.py`**.
