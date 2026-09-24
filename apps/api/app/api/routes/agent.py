"""API Endpoints: Event Operations Agent & Agent Tool Layer."""
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.agent.agent import EventOperationsAgent
from app.agent.tools.registry import get_agent_tool_registry

router = APIRouter(tags=["Event Operations Agent"])


@router.get("/agent/tools", status_code=status.HTTP_200_OK)
def list_agent_tools() -> List[Dict[str, Any]]:
    """Lists all available agent tools in EVENTRA with their metadata and schemas.

    STRICT SECURITY: Exposes only safe operational metadata without secrets or credentials.
    Disabled or unsupported tools are excluded from the available tool list.
    """
    registry = get_agent_tool_registry()
    tools = registry.list_tools(available_only=True)
    return [t.to_summary_dict() for t in tools]


@router.get("/agent/events/{event_id}/tools", status_code=status.HTTP_200_OK)
def list_event_agent_tools(event_id: str) -> List[Dict[str, Any]]:
    """Contextual endpoint returning available agent tools for a specific event."""
    registry = get_agent_tool_registry()
    tools = registry.list_tools(available_only=True)
    return [t.to_summary_dict() for t in tools]


@router.post("/agent/events/{event_id}/run", response_model=AgentRunResponse, status_code=status.HTTP_200_OK)
def run_agent_endpoint(
    event_id: str,
    payload: AgentRunRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Executes the Event Operations Agent loop for a live event."""
    agent = EventOperationsAgent(db)
    result = agent.run(
        event_id=event_id,
        message=payload.message,
        user_id=current_user_id,
        approval_id=payload.approval_id,
    )
    return result
