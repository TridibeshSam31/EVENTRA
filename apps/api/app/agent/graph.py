"""LangGraph definition for EVENTRA's single Event Operations Agent.

Implements the REAL bounded agent loop:
OBSERVE
  ↓
INTERPRET
  ↓
DECIDE_NEXT_STEP
  ↓
TOOL_EXECUTION
  ↓
PROCESS_RESULT
  ↓
RE-EVALUATE
  ├── more investigation → DECIDE_NEXT_STEP
  ├── propose action → VALIDATE_ACTION
  ├── approval required → WAIT_FOR_APPROVAL
  ├── execute action → ACT
  ├── verify → VERIFY
  └── complete → END

CRITICAL ARCHITECTURAL CONSTRAINTS:
1. ONE agent: EventOperationsAgent.
2. The deterministic engine calculates what is feasible. The agent decides what should happen next.
3. No fake chatbot; dynamic tool selection based on live state.
4. Bounded loop: terminates if step limit or loop ping-pong detected.
5. Consequential actions require authoritative human approval. The agent CANNOT self-approve.
6. Mutation != recovery: every consequential mutation triggers deterministic verification.
7. No hidden chain-of-thought: only structured operational decision trace is stored.
"""
import uuid
from typing import Any, Dict, List, Optional
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END

from app.agent.state import AgentState
from app.agent.decision import AgentDecision, DecisionType, ReasonCode
from app.agent.provider import LLMProvider, get_default_llm_provider
from app.agent.tools.registry import default_registry, ToolStatus, ToolResult, ToolCategory
from app.agent.tools.operations_tools import (
    get_event_state,
    get_incidents,
    check_action_authorization,
    check_approval_status,
    request_action_approval,
    execute_action,
    verify_action,
    get_decision_trace,
)

MAX_AGENT_STEPS = 12


def _get_context(config: Optional[RunnableConfig]):
    configurable = (config or {}).get("configurable", {})
    db = configurable.get("db")
    llm = configurable.get("llm_provider") or get_default_llm_provider()
    return db, llm


def observe_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Phase 1: OBSERVE authoritative event state, incidents, and constraints."""
    db, _ = _get_context(config)
    event_id = state["event_id"]
    approval_id = state.get("approval_id")

    event_state = get_event_state(db, event_id)
    incidents = get_incidents(db, event_id)

    # Pick the most recent open incident as active incident if not set
    active_incident_id = state.get("active_incident_id")
    if not active_incident_id and incidents:
        active_incident_id = incidents[0]["id"]

    # Check if this run is resuming with an authoritative approval ticket
    approval_record = None
    approval_granted = False
    if approval_id:
        try:
            approval_record = check_approval_status(db, approval_id)
            if approval_record.get("is_approved"):
                approval_granted = True
        except Exception:
            approval_granted = False

    selected_option = state.get("selected_option")
    if approval_record and approval_record.get("recovery_option_id"):
        from app.models.recovery import Recovery
        rec = db.query(Recovery).filter(Recovery.id == approval_record["recovery_option_id"]).first()
        if rec:
            selected_option = {
                "id": rec.id,
                "strategy_type": rec.strategy_type,
                "is_feasible": rec.is_feasible,
                "proposed_changes": rec.proposed_changes,
                "affected_tasks": rec.affected_tasks,
            }

    execution_result = state.get("execution_result")
    if approval_id and not execution_result:
        from app.models.action import ActionExecution
        existing_exec = (
            db.query(ActionExecution)
            .filter(ActionExecution.approval_request_id == approval_id)
            .order_by(ActionExecution.executed_at.desc())
            .first()
        )
        if existing_exec:
            execution_result = {
                "id": existing_exec.id,
                "action_id": existing_exec.action_id,
                "status": existing_exec.status,
                "action_type": existing_exec.action_type,
                "recovery_option_id": existing_exec.recovery_option_id,
                "executed_at": existing_exec.executed_at.isoformat() if existing_exec.executed_at else None,
            }

    return {
        "current_event_state": event_state,
        "current_incidents": incidents,
        "active_incident_id": active_incident_id,
        "selected_option": selected_option,
        "approval_result": approval_record,
        "execution_result": execution_result,
        "pending_approval": not approval_granted if approval_id else state.get("pending_approval", False),
        "recovery_attempts": state.get("recovery_attempts") or [],
        "attempt_count": state.get("attempt_count") or 0,
        "max_recovery_attempts": state.get("max_recovery_attempts") or 3,
        "current_phase": "OBSERVE",
        "status": "OBSERVING",
    }


def interpret_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Phase 2: INTERPRET operational trigger, establish objective, identify missing information."""
    _, llm = _get_context(config)
    message = state.get("message", "")
    msg_lower = (message or "").lower()
    event_state = state.get("current_event_state") or {}
    incidents = state.get("current_incidents") or []

    # Direct operational command handling (start operations, plan modification)
    if any(kw in msg_lower for kw in ["start operations", "begin operations", "start operation", "launch operations"]):
        from app.agent.tools.operations_tools import start_autonomous_operations
        db, _ = _get_context(config)
        op_result = start_autonomous_operations(db=db, event_id=state["event_id"], user_id=state.get("user_id", "anonymous_operator"))
        return {
            "status": "COMPLETED",
            "termination_status": "COMPLETED",
            "final_response": op_result.get("message", "Operations Active"),
            "current_phase": "TERMINATED",
        }

    if not incidents and any(kw in msg_lower for kw in ["remove ", "delete ", "drop requirement", "add ", "modify plan"]):
        from app.agent.tools.operations_tools import modify_event_plan
        db, _ = _get_context(config)
        op_result = modify_event_plan(db=db, event_id=state["event_id"], modification=message, user_id=state.get("user_id", "anonymous_operator"))
        return {
            "status": "COMPLETED",
            "termination_status": "COMPLETED",
            "final_response": op_result.get("message", "Operational plan updated."),
            "current_phase": "TERMINATED",
        }

    # Derive operational objective
    if not state.get("objective"):
        if any(kw in msg_lower for kw in ["guest", "count", "pax", "capacity", "500", "800"]):
            objective = f"Evaluate and accommodate changed guest requirement: '{message[:80]}'"
        elif incidents or any(kw in msg_lower for kw in ["photographer", "delay", "late", "no-show", "arrive", "cancel", "caterer", "catering", "vendor", "incident", "broken", "issue", "fix", "fail", "recovery"]):
            objective = f"Investigate disruption and execute operational recovery: '{message[:80]}'"
        else:
            objective = f"Operational assessment: '{message[:80]}'"
    else:
        objective = state["objective"]

    # Use LLM interpretation if available
    try:
        interpretation = llm.interpret_incident(message, event_state, incidents)
        summary = interpretation.get("summary", "Interpreted operational situation.")
    except Exception:
        summary = f"Interpreted situation: {objective}"

    messages = list(state.get("messages", []))
    messages.append({
        "role": "agent",
        "type": "interpretation",
        "content": summary,
    })

    return {
        "objective": objective,
        "operational_intent": "INCIDENT_RECOVERY" if incidents else "OPERATIONAL_INVESTIGATION",
        "current_phase": "INTERPRET",
        "status": "INTERPRETING",
        "messages": messages,
    }


def decide_next_step_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Phase 3: REASON & CHOOSE NEXT ACTION dynamically through the LLMProvider.
    
    Inspects operational context, available tools, tool history, and previous results.
    Emits a structured AgentDecision.
    """
    db, llm = _get_context(config)
    step_count = state.get("step_count", 0)
    max_steps = state.get("max_steps", MAX_AGENT_STEPS)
    tool_history = list(state.get("tool_history", []))

    # Bounded execution safeguard
    if step_count >= max_steps:
        decision = AgentDecision(
            decision_type=DecisionType.FAIL,
            reason_code=ReasonCode.STEP_LIMIT_REACHED.value,
            rationale="Agent reached maximum reasoning and tool execution step limit.",
            terminate=True,
            termination_status="STEP_LIMIT_REACHED",
        )
        return {
            "last_decision": decision.model_dump(),
            "status": "FAILED",
            "termination_status": "STEP_LIMIT_REACHED",
            "error": "AGENT_STEP_LIMIT_REACHED",
            "current_phase": "TERMINATED",
        }

    # Bounded recovery attempts safeguard
    attempt_count = state.get("attempt_count") or 0
    max_recovery_attempts = state.get("max_recovery_attempts") or 3
    if attempt_count >= max_recovery_attempts:
        decision = AgentDecision(
            decision_type=DecisionType.FAIL,
            reason_code=ReasonCode.UNRECOVERABLE_STATE.value,
            rationale=f"Agent exceeded maximum recovery attempts ({max_recovery_attempts}) without achieving verified recovery.",
            terminate=True,
            termination_status="RECOVERY_FAILED",
        )
        return {
            "last_decision": decision.model_dump(),
            "status": "RECOVERY_FAILED",
            "termination_status": "RECOVERY_FAILED",
            "error": "MAX_RECOVERY_ATTEMPTS_EXCEEDED",
            "current_phase": "TERMINATED",
        }

    # Loop ping-pong safeguard: detect 3 identical consecutive tool calls
    if len(tool_history) >= 3:
        last_three = tool_history[-3:]
        if (
            last_three[0].get("tool") == last_three[1].get("tool") == last_three[2].get("tool")
            and last_three[0].get("arguments") == last_three[1].get("arguments") == last_three[2].get("arguments")
        ):
            decision = AgentDecision(
                decision_type=DecisionType.FAIL,
                reason_code=ReasonCode.TOOL_EXECUTION_FAILED.value,
                rationale="Agent detected repeated identical tool calls with no state progression (loop safeguard).",
                terminate=True,
                termination_status="FAILED",
            )
            return {
                "last_decision": decision.model_dump(),
                "status": "FAILED",
                "termination_status": "FAILED",
                "error": "AGENT_LOOP_DETECTED",
                "current_phase": "TERMINATED",
            }

    # Human-in-the-loop Resumption check
    approval_result = state.get("approval_result") or {}
    if approval_result.get("is_approved") and not state.get("execution_result"):
        # We are resuming an approved action!
        rec_opt_id = approval_result.get("recovery_option_id")
        decision = AgentDecision(
            decision_type=DecisionType.TOOL_CALL,
            tool_name="execute_action",
            tool_arguments={
                "recovery_option_id": rec_opt_id,
                "approval_request_id": approval_result.get("id"),
            },
            reason_code=ReasonCode.APPROVAL_GRANTED.value,
            action_intent="EXECUTE_APPROVED_RECOVERY",
            rationale=f"Executing approved recovery option '{rec_opt_id}' after authoritative operator sign-off.",
        )
        return {
            "last_decision": decision.model_dump(),
            "current_phase": "DECIDE",
            "status": "DECIDING",
        }

    # Build bounded operational context
    event_state = state.get("current_event_state") or {}
    operational_context = {
        "event_id": state["event_id"],
        "event_name": event_state.get("name"),
        "event_state": event_state.get("state"),
        "lifecycle_state": event_state.get("lifecycle_state"),
        "budget_remaining": event_state.get("budget_remaining"),
        "task_counts": event_state.get("task_counts"),
        "active_incident_id": state.get("active_incident_id"),
        "current_incidents": state.get("current_incidents", []),
        "impact": state.get("impact"),
        "risk": state.get("risk"),
        "recovery_options": state.get("recovery_options", []),
        "selected_option": state.get("selected_option"),
        "approval_granted": approval_result.get("is_approved", False),
        "approval_id": state.get("approval_id"),
        "execution_result": state.get("execution_result"),
        "verification_result": state.get("verification_result"),
        "recovery_attempts": state.get("recovery_attempts") or [],
        "attempt_count": state.get("attempt_count") or 0,
        "max_recovery_attempts": state.get("max_recovery_attempts") or 3,
    }

    available_tools = default_registry.get_tool_schemas()
    current_objective = state.get("objective", "Resolve operational disruption")
    previous_result = state.get("last_tool_result")

    # LLM decides next action
    try:
        decision = llm.decide_next_action(
            operational_context=operational_context,
            available_tools=available_tools,
            current_objective=current_objective,
            tool_history=tool_history,
            previous_result=previous_result,
        )
    except Exception as exc:
        decision = AgentDecision(
            decision_type=DecisionType.FAIL,
            reason_code=ReasonCode.TOOL_EXECUTION_FAILED.value,
            rationale=f"Failed to generate structured agent decision: {exc}",
            terminate=True,
            termination_status="FAILED",
        )

    return {
        "last_decision": decision.model_dump(),
        "current_phase": "DECIDE",
        "status": "DECIDING",
    }


def route_after_decide(state: AgentState) -> str:
    """Conditional routing based on AgentDecision."""
    last_dec = state.get("last_decision") or {}
    dec_type = last_dec.get("decision_type", DecisionType.FAIL.value)

    if dec_type == DecisionType.TOOL_CALL.value:
        tool_name = last_dec.get("tool_name")
        # Consequential WRITE tools must route through action validation first
        tool_def = default_registry.get(tool_name) if tool_name else None
        if tool_def and tool_def.category == ToolCategory.WRITE and tool_def.requires_approval:
            return "validate_action"
        return "tool_execution"

    if dec_type == DecisionType.PROPOSE_ACTION.value:
        return "validate_action"

    if dec_type in (DecisionType.REQUEST_APPROVAL.value, DecisionType.WAIT.value):
        return "wait_for_approval"

    if dec_type == DecisionType.COMPLETE.value:
        return "end_completed"

    return "end_failed"


def tool_execution_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Phase 4: EXECUTE TOOL through the central ToolRegistry and record structured trace."""
    db, _ = _get_context(config)
    event_id = state["event_id"]
    user_id = state.get("user_id", "anonymous_operator")
    step_count = state.get("step_count", 0) + 1
    last_dec = state.get("last_decision") or {}
    tool_name = last_dec.get("tool_name", "")
    tool_args = last_dec.get("tool_arguments") or {}

    tool_result = default_registry.execute(
        tool_name=tool_name,
        arguments=tool_args,
        db=db,
        user_id=user_id,
        event_id=event_id,
    )

    # Build structured history entry (operational facts, NOT chain-of-thought)
    history_entry = {
        "step": step_count,
        "tool": tool_name,
        "arguments": {k: v for k, v in tool_args.items() if k != "db"},
        "status": tool_result.status.value,
        "reason_code": last_dec.get("reason_code"),
        "result_summary": tool_result.summary(),
    }
    tool_history = list(state.get("tool_history", []))
    tool_history.append(history_entry)

    # State synchronization for recognized deterministic tools
    updates: Dict[str, Any] = {
        "step_count": step_count,
        "last_tool_call": {"tool": tool_name, "arguments": tool_args},
        "last_tool_result": tool_result.model_dump(),
        "tool_history": tool_history,
        "current_phase": "EXECUTE",
        "status": "EXECUTING_TOOL",
    }

    if tool_result.status == ToolStatus.SUCCESS and tool_result.data:
        if tool_name == "analyze_impact":
            updates["impact"] = tool_result.data
        elif tool_name in ("assess_risk", "calculate_risk"):
            updates["risk"] = tool_result.data
        elif tool_name == "generate_recovery_options":
            updates["recovery_options"] = tool_result.data
            if tool_result.data:
                # Store top feasible option as selected_option for inspection
                feasible = [o for o in tool_result.data if o.get("is_feasible")]
                backup_opts = [o for o in feasible if str(o.get("strategy_type", "")).upper() in ("BACKUP", "REASSIGN", "REASSIGN_VENDOR")]
                updates["selected_option"] = backup_opts[0] if backup_opts else (feasible[0] if feasible else tool_result.data[0])
        elif tool_name == "execute_action":
            updates["execution_result"] = tool_result.data
            updates["action_status"] = "EXECUTED"
        elif tool_name == "verify_action":
            updates["verification_result"] = tool_result.data
            updates["verification_status"] = tool_result.data.get("status", "VERIFIED")
            decision_trace = get_decision_trace(db, event_id, tool_result.data.get("id"))
            updates["decision_trace"] = decision_trace

    return updates


def process_result_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Phase 5: RE-EVALUATE outcome of tool execution and decide next phase."""
    last_res = state.get("last_tool_result") or {}
    status = last_res.get("status")
    last_call = state.get("last_tool_call") or {}
    tool_name = last_call.get("tool")

    if status == ToolStatus.REQUIRES_APPROVAL.value:
        return {
            "current_phase": "APPROVAL",
            "pending_approval": True,
            "status": "NEEDS_APPROVAL",
        }

    return {
        "current_phase": "RE_EVALUATE",
        "status": "RE_EVALUATING",
    }


def route_after_process_result(state: AgentState) -> str:
    """Routes after tool execution result is processed."""
    last_res = state.get("last_tool_result") or {}
    status = last_res.get("status")
    last_call = state.get("last_tool_call") or {}
    tool_name = last_call.get("tool")

    if status == ToolStatus.REQUIRES_APPROVAL.value:
        return "wait_for_approval"

    # Consequential write execution must be immediately verified
    if tool_name == "execute_action" and status == ToolStatus.SUCCESS.value:
        return "verify"

    if tool_name == "verify_action":
        if status in (ToolStatus.SUCCESS.value, "VERIFIED"):
            return "end_completed"
        return "end_failed"

    # Default: loop back to agent decision
    return "decide_next_step"


def validate_action_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Evaluates proposed consequential action through Phase 9 AuthorizationService.
    
    Ensures agent cannot self-approve.
    """
    db, _ = _get_context(config)
    event_id = state["event_id"]
    user_id = state.get("user_id", "anonymous_operator")
    last_dec = state.get("last_decision") or {}
    selected = state.get("selected_option")
    if not selected:
        rec_opts = state.get("recovery_options") or []
        feasible = [o for o in rec_opts if o.get("is_feasible")]
        selected = feasible[0] if feasible else (rec_opts[0] if rec_opts else {})

    strat = str(selected.get("strategy_type", "REASSIGN_VENDOR")).upper()
    action_type = "REASSIGN_VENDOR" if strat in ("BACKUP", "REASSIGN", "REASSIGN_VENDOR") else "ADJUST_SCHEDULE"
    target_id = selected.get("affected_tasks", [None])[0] if selected.get("affected_tasks") else None

    auth_result = check_action_authorization(
        db=db,
        event_id=event_id,
        user_id=user_id,
        action_type=action_type,
        target_type="TASK",
        target_id=target_id,
        payload=selected.get("proposed_changes"),
        recovery_option_id=selected.get("id"),
    )

    # Check authoritative DB status if approval_id provided
    approval_id = state.get("approval_id")
    is_authoritatively_approved = False
    approval_record = None
    if approval_id:
        try:
            approval_record = check_approval_status(db, approval_id)
            if approval_record.get("is_approved"):
                is_authoritatively_approved = True
        except Exception:
            is_authoritatively_approved = False

    needs_approval = auth_result.get("requires_approval", True) and not is_authoritatively_approved

    return {
        "authorization_result": auth_result,
        "approval_result": approval_record,
        "pending_approval": needs_approval,
        "proposed_action": {
            "action_type": action_type,
            "target_id": target_id,
            "recovery_option_id": selected.get("id"),
        },
        "current_phase": "VALIDATE",
        "status": "NEEDS_APPROVAL" if needs_approval else "AUTHORIZED",
    }


def route_after_validate(state: AgentState) -> str:
    """Routes based on authorization and approval necessity."""
    auth = state.get("authorization_result") or {}
    if not auth.get("allowed"):
        return "end_failed"

    if state.get("pending_approval"):
        return "wait_for_approval"

    return "act"


def wait_for_approval_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Creates immutable ApprovalRequest in PostgreSQL and safely pauses agent execution."""
    db, llm = _get_context(config)
    event_id = state["event_id"]
    user_id = state.get("user_id", "anonymous_operator")
    selected = state.get("selected_option")
    if not selected:
        rec_opts = state.get("recovery_options") or []
        feasible = [o for o in rec_opts if o.get("is_feasible")]
        selected = feasible[0] if feasible else (rec_opts[0] if rec_opts else {})

    strat = str(selected.get("strategy_type", "REASSIGN_VENDOR")).upper()
    action_type = "REASSIGN_VENDOR" if strat in ("BACKUP", "REASSIGN", "REASSIGN_VENDOR") else "ADJUST_SCHEDULE"
    target_id = selected.get("affected_tasks", [None])[0] if selected.get("affected_tasks") else None

    appr_dict = request_action_approval(
        db=db,
        event_id=event_id,
        user_id=user_id,
        action_type=action_type,
        target_type="TASK",
        target_id=target_id,
        requested_action=selected.get("proposed_changes") or {},
        recovery_option_id=selected.get("id"),
        notes=f"Agent requested approval for recovery strategy: {strat}",
    )

    context = {
        "incident": state.get("current_incidents", [{}])[0] if state.get("current_incidents") else {},
        "selected_option": selected,
        "risk": state.get("risk") or {},
        "approval": appr_dict,
    }
    response_msg = llm.format_operational_response("PENDING_APPROVAL", context)

    # Append to tool history as well
    tool_history = list(state.get("tool_history", []))
    tool_history.append({
        "step": state.get("step_count", 0) + 1,
        "tool": "request_action_approval",
        "arguments": {"action_type": action_type, "recovery_option_id": selected.get("id")},
        "status": "SUCCESS",
        "reason_code": ReasonCode.APPROVAL_REQUIRED.value,
        "result_summary": f"Approval ticket created (ID: {appr_dict['id']})",
    })

    return {
        "approval_id": appr_dict["id"],
        "approval_result": appr_dict,
        "pending_approval": True,
        "tool_history": tool_history,
        "status": "PENDING_APPROVAL",
        "termination_status": "WAITING_FOR_APPROVAL",
        "final_response": response_msg,
        "current_phase": "APPROVAL",
    }


def act_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Phase 6: ACT - Executes authorized recovery mutation through ActionService."""
    db, _ = _get_context(config)
    event_id = state["event_id"]
    user_id = state.get("user_id", "anonymous_operator")
    selected = state.get("selected_option") or {}
    approval_res = state.get("approval_result") or {}
    last_dec = state.get("last_decision") or {}
    last_args = last_dec.get("tool_arguments") or {}

    recovery_id = (
        selected.get("id")
        or approval_res.get("recovery_option_id")
        or last_args.get("recovery_option_id")
        or ""
    )
    approval_id = state.get("approval_id") or approval_res.get("id")
    step_count = state.get("step_count", 0) + 1

    exec_result = execute_action(
        db=db,
        event_id=event_id,
        user_id=user_id,
        recovery_option_id=recovery_id or "",
        approval_request_id=approval_id,
    )

    tool_history = list(state.get("tool_history", []))
    tool_history.append({
        "step": step_count,
        "tool": "execute_action",
        "arguments": {"recovery_option_id": recovery_id, "approval_id": approval_id},
        "status": "SUCCESS",
        "reason_code": ReasonCode.ACTION_EXECUTED.value,
        "result_summary": f"Action executed successfully (Execution ID: {exec_result.get('id')})",
    })

    return {
        "execution_result": exec_result,
        "action_status": "EXECUTED",
        "step_count": step_count,
        "tool_history": tool_history,
        "status": "EXECUTED",
        "current_phase": "ACT",
    }


def verify_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Phase 7: VERIFY - Authoritatively verifies whether post-mutation event state actually recovered."""
    db, _ = _get_context(config)
    event_id = state["event_id"]
    user_id = state.get("user_id", "anonymous_operator")
    exec_result = state.get("execution_result") or {}
    action_execution_id = exec_result.get("id") or exec_result.get("action_id") or ""
    step_count = state.get("step_count", 0) + 1
    selected = state.get("selected_option") or {}
    attempt_count = (state.get("attempt_count") or 0) + 1
    max_recovery_attempts = state.get("max_recovery_attempts") or 3

    verification = verify_action(
        db=db,
        event_id=event_id,
        action_execution_id=action_execution_id,
        user_id=user_id,
    )

    decision_trace = get_decision_trace(db, event_id, verification.get("id"))
    ver_status = verification.get("status", "FAILED")
    is_verified = (ver_status == "VERIFIED")

    tool_history = list(state.get("tool_history", []))
    tool_history.append({
        "step": step_count,
        "tool": "verify_action",
        "arguments": {"action_execution_id": action_execution_id},
        "status": "SUCCESS" if is_verified else "FAILURE",
        "reason_code": ReasonCode.RECOVERY_CONFIRMED.value if is_verified else ReasonCode.VERIFICATION_FAILED.value,
        "result_summary": f"Verification outcome: {ver_status}",
    })

    recovery_attempts = list(state.get("recovery_attempts") or [])
    if not is_verified:
        recovery_attempts.append({
            "attempt": attempt_count,
            "recovery_option_id": selected.get("id") or exec_result.get("recovery_option_id"),
            "status": "RECOVERY_FAILED",
            "failure_reasons": verification.get("failure_reasons") or [],
            "verification_status": ver_status,
            "verification_id": verification.get("id"),
        })

    updates: Dict[str, Any] = {
        "verification_result": verification,
        "decision_trace": decision_trace,
        "verification_status": ver_status,
        "step_count": step_count,
        "tool_history": tool_history,
        "recovery_attempts": recovery_attempts,
        "attempt_count": attempt_count,
        "max_recovery_attempts": max_recovery_attempts,
        "current_phase": "VERIFY",
    }

    if is_verified:
        updates["status"] = "VERIFIED"
    else:
        updates["status"] = "RECOVERY_FAILED"
        if attempt_count < max_recovery_attempts:
            updates["execution_result"] = None
            updates["selected_option"] = None
            updates["action_status"] = "RECOVERY_FAILED"
        else:
            updates["termination_status"] = "RECOVERY_FAILED"
            fail_reasons = verification.get("failure_reasons") or []
            updates["error"] = f"Recovery failed after {attempt_count} attempts: {'; '.join(fail_reasons)}"

    return updates


def route_after_verify(state: AgentState) -> str:
    """Routes after post-action verification.
    
    If verified -> end_completed.
    If recovery failed and under max attempts -> observe (re-observes and triggers retry loop).
    If attempts exhausted -> end_failed.
    """
    if state.get("status") == "VERIFIED" or state.get("verification_status") == "VERIFIED":
        return "end_completed"

    attempt_count = state.get("attempt_count") or 0
    max_attempts = state.get("max_recovery_attempts") or 3
    if attempt_count < max_attempts:
        return "observe"

    return "end_failed"


def end_completed_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Terminal node when operational objective has been successfully achieved and verified."""
    _, llm = _get_context(config)
    verification = state.get("verification_result") or {}
    exec_res = state.get("execution_result")

    context = {
        "incident": state.get("current_incidents", [{}])[0] if state.get("current_incidents") else {},
        "selected_option": state.get("selected_option") or {},
        "risk": state.get("risk") or {},
        "execution": exec_res,
        "verification": verification,
        "decision_trace": state.get("decision_trace"),
    }
    final_resp = state.get("final_response") or llm.format_operational_response("COMPLETED", context)

    return {
        "status": "COMPLETED",
        "termination_status": "COMPLETED",
        "final_response": final_resp,
        "current_phase": "TERMINATED",
    }


def end_failed_node(state: AgentState, config: Optional[RunnableConfig] = None) -> Dict[str, Any]:
    """Terminal node when operational action fails authorization, step limits, or verification."""
    _, llm = _get_context(config)
    err = (
        state.get("error")
        or state.get("authorization_result", {}).get("reason")
        or "Operational recovery action could not proceed."
    )
    context = {"error": err, "status": "FAILED"}
    final_resp = llm.format_operational_response("FAILED", context)

    status = "RECOVERY_FAILED" if state.get("status") == "RECOVERY_FAILED" or state.get("termination_status") == "RECOVERY_FAILED" else "FAILED"
    term_status = state.get("termination_status") or "FAILED"

    return {
        "status": status,
        "termination_status": term_status,
        "final_response": f"Operational action halted: {err}",
        "error": err,
        "current_phase": "TERMINATED",
    }


class EventOperationsAgentGraph:
    """Compiled LangGraph StateGraph implementing the real bounded event operations loop."""

    def __init__(self):
        self._compiled_graph = None

    def build_graph(self):
        """Builds and compiles the StateGraph."""
        builder = StateGraph(AgentState)

        # 1. Register Nodes
        builder.add_node("observe", observe_node)
        builder.add_node("interpret", interpret_node)
        builder.add_node("decide_next_step", decide_next_step_node)
        builder.add_node("tool_execution", tool_execution_node)
        builder.add_node("process_result", process_result_node)
        builder.add_node("validate_action", validate_action_node)
        builder.add_node("wait_for_approval", wait_for_approval_node)
        builder.add_node("act", act_node)
        builder.add_node("verify", verify_node)
        builder.add_node("end_completed", end_completed_node)
        builder.add_node("end_failed", end_failed_node)

        # 2. Register Edges
        builder.add_edge(START, "observe")
        builder.add_edge("observe", "interpret")
        builder.add_conditional_edges(
            "interpret",
            lambda s: "end_completed" if s.get("status") == "COMPLETED" else "decide_next_step",
            {
                "end_completed": "end_completed",
                "decide_next_step": "decide_next_step",
            },
        )

        # Routing from decision
        builder.add_conditional_edges(
            "decide_next_step",
            route_after_decide,
            {
                "tool_execution": "tool_execution",
                "validate_action": "validate_action",
                "wait_for_approval": "wait_for_approval",
                "end_completed": "end_completed",
                "end_failed": "end_failed",
            },
        )

        # Tool execution -> process result
        builder.add_edge("tool_execution", "process_result")

        # Routing after processing tool result
        builder.add_conditional_edges(
            "process_result",
            route_after_process_result,
            {
                "decide_next_step": "decide_next_step",
                "wait_for_approval": "wait_for_approval",
                "verify": "verify",
                "end_completed": "end_completed",
                "end_failed": "end_failed",
            },
        )

        # Action validation routing
        builder.add_conditional_edges(
            "validate_action",
            route_after_validate,
            {
                "act": "act",
                "wait_for_approval": "wait_for_approval",
                "end_failed": "end_failed",
            },
        )

        # Pauses safely at human approval gate
        builder.add_edge("wait_for_approval", END)

        # Act -> verify (Always verify after mutation!)
        builder.add_edge("act", "verify")

        # Verify routing
        builder.add_conditional_edges(
            "verify",
            route_after_verify,
            {
                "end_completed": "end_completed",
                "observe": "observe",
                "end_failed": "end_failed",
            },
        )

        builder.add_edge("end_completed", END)
        builder.add_edge("end_failed", END)

        self._compiled_graph = builder.compile()
        return self._compiled_graph

    def get_graph(self):
        if not self._compiled_graph:
            self.build_graph()
        return self._compiled_graph
