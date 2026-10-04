"""WhatsApp Notification and Response Templates."""
from typing import Any, Dict, Optional


def format_whatsapp_approval_request(
    event_name: str,
    title: str,
    proposed_summary: str,
    reply_code: Optional[str],
    deep_link: str,
) -> str:
    """Builds a concise, actionable WhatsApp approval message using only provided data."""
    event_prefix = f"[{event_name.strip()}]" if event_name else "[EVENT]"
    headline = title.strip() if title else "Operational Action Required"
    
    code_prompt = f" YES {reply_code} to approve or NO {reply_code} to reject" if reply_code else " YES to approve or NO to reject"

    msg_lines = [
        f"{event_prefix} {headline}",
    ]
    if proposed_summary:
        msg_lines.append(f"Proposed: {proposed_summary.strip()}")
    msg_lines.append(f"Reply{code_prompt}.")
    if deep_link:
        msg_lines.append(f"Details: {deep_link}")

    return "\n".join(msg_lines)


def build_proposed_summary_from_action(requested_action: Optional[Dict[str, Any]]) -> str:
    """Extracts proposed action summary strictly from requested_action without inventing facts."""
    if not requested_action:
        return ""

    # Check for direct summary or description
    if requested_action.get("proposed_summary"):
        return str(requested_action["proposed_summary"])
    if requested_action.get("description"):
        return str(requested_action["description"])

    parts = []
    action = requested_action.get("action") or requested_action.get("action_type")
    vendor_name = (
        requested_action.get("vendor_name")
        or requested_action.get("candidate_name")
        or requested_action.get("replacement_vendor_name")
    )
    if vendor_name:
        parts.append(f"replace with {vendor_name}")
    elif action:
        parts.append(str(action))

    # Cost differential or cost if specified
    delta_cost = requested_action.get("cost_delta") or requested_action.get("additional_cost") or requested_action.get("budget_impact")
    if delta_cost is not None:
        try:
            val = float(delta_cost)
            sign = "+" if val >= 0 else "-"
            parts.append(f"({sign}₹{abs(val):,.0f})")
        except (ValueError, TypeError):
            parts.append(f"({delta_cost})")
    elif requested_action.get("proposed_cost") is not None:
        try:
            val = float(requested_action["proposed_cost"])
            parts.append(f"(₹{val:,.0f})")
        except (ValueError, TypeError):
            pass

    return " ".join(parts) if parts else str(requested_action.get("title", ""))


def format_approval_confirmed(action_type: str = "Action") -> str:
    return f"Approved: {action_type}. Executing mutation and verifying..."


def format_rejection_confirmed(action_type: str = "Action", reason: Optional[str] = None) -> str:
    suffix = f" (Reason: {reason})" if reason else ""
    return f"Rejected: {action_type} will not proceed{suffix}."


def format_stale_warning() -> str:
    return "STALE: Event state has changed since this approval request was created. Please review the updated event state in your dashboard."


def format_expired_notice() -> str:
    return "Expired: This approval request has expired and cannot be approved. The agent will replan accordingly."


def format_unauthorized_notice() -> str:
    return "Unauthorized: You do not have the required permissions or role to approve this request."


def format_multiple_pending_notice(codes: list) -> str:
    code_list = ", ".join(codes) if codes else "code"
    return f"You have multiple pending approvals ({code_list}). Please specify the code in your reply, e.g. 'YES <CODE>' or 'NO <CODE>'."


def format_verification_result(status: str, summary: Optional[str] = None) -> str:
    if status.upper() in ("VERIFIED", "SUCCESS"):
        detail = f": {summary}" if summary else ""
        return f"Verified successfully{detail}. Event operations continuing."
    else:
        detail = f": {summary}" if summary else ""
        return f"Verification failed{detail}. Please check event alerts."
