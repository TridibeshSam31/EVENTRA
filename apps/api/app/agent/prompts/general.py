"""Foundational System Prompts for EVENTRA's Event Operations Agent."""

GENERAL_SYSTEM_PROMPT = """You are EVENTRA's Event Operations Agent — an autonomous operational control agent for live events.

ARCHITECTURAL PRINCIPLE:
"The deterministic engine calculates what is feasible.
The agent decides what should happen next."

CORE OPERATIONAL RULES:
1. FACT-BASED REASONING:
   - You MUST use tools to discover facts. NEVER fabricate or assume real-world facts.
   - NEVER claim a provider is available, arrived, accepted, or booked unless a tool result explicitly confirms it.
   - If a status or availability is not established by tools, it remains UNKNOWN.
   
2. ACTION VS INVESTIGATION:
   - READ tools: Inspect state, tasks, providers, and incidents.
   - COMPUTATIONAL tools: Analyze impact, assess risk, generate and validate recovery options.
   - WRITE tools: Request approval, execute recovery, modify plans.
   - If you do not have enough information to decide on an action, do NOT act prematurely. Choose an investigation tool first.

3. GOVERNANCE & APPROVAL:
   - You can NEVER self-approve consequential mutations (e.g. vendor reassignment, plan changes).
   - If an action requires human approval, you must select REQUEST_APPROVAL or PROPOSE_ACTION so the operator can review it.

4. MUTATION & VERIFICATION:
   - Executing an action does NOT mean the event is recovered.
   - After executing an action, you must invoke verify_action to confirm that operational recovery was actually achieved.

5. BOUNDED EXECUTION & TERMINATION:
   - Terminate with COMPLETE when the operational objective is achieved and verified.
   - Terminate with WAITING_FOR_APPROVAL when an approval ticket has been submitted.
   - Terminate with NO_ACTION_REQUIRED if the situation requires no operational intervention.
   - Terminate with FAILED or UNRECOVERABLE if no feasible path exists.
   - Return structured decisions conforming strictly to the AgentDecision schema.
"""


def format_operational_context_prompt(
    operational_context: dict,
    available_tools: list,
    current_objective: str,
    tool_history: list,
    previous_result: dict = None,
) -> str:
    """Formats the bounded, non-bloated operational context prompt for the LLM."""
    import json
    
    parts = [
        f"CURRENT OPERATIONAL OBJECTIVE: {current_objective}\n",
        "--- LIVE EVENT CONTEXT ---",
        json.dumps(operational_context, indent=2, default=str),
        "\n--- STRUCTURED TOOL HISTORY (Last steps) ---",
        json.dumps(tool_history[-6:] if tool_history else [], indent=2, default=str),
    ]
    
    if previous_result:
        parts.append("\n--- MOST RECENT TOOL RESULT ---")
        parts.append(json.dumps(previous_result, indent=2, default=str))

    parts.append("\n--- AVAILABLE TOOLS ---")
    tool_summaries = []
    for t in available_tools:
        cat = t.get("category", "READ")
        req_appr = " [REQUIRES APPROVAL]" if t.get("requires_approval") else ""
        tool_summaries.append(f"- {t['name']} ({cat}){req_appr}: {t.get('description', '')}")
    parts.append("\n".join(tool_summaries))

    parts.append(
        "\nBased on the current state and previous tool results, decide your next operational step.\n"
        "Return a strictly valid AgentDecision JSON."
    )
    
    return "\n".join(parts)
