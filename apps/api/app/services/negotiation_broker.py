"""In-Process Realtime Negotiation Event Broker (Task 3 & 4).

Provides event- and assignment-isolated real-time state push channels for
the Live Negotiation screen via Server-Sent Events (SSE).

Architecture & Concurrency:
- In-process asyncio.Queue fanout with thread-safe publish_sync wrapper.
- Preserves an in-memory chronological event buffer per assignment/event
  so reconnecting clients can seamlessly catch up via Last-Event-ID or ?since.
- Redis-Ready Interface: Designed with explicit publish/subscribe boundaries so
  an external Redis pub/sub / streams adapter can replace this class in multi-replica
  deployments without modifying callers.

NOTE ON SINGLE-PROCESS LIMITATION:
In multi-worker deployments (e.g., multi-process Uvicorn / Gunicorn or multi-pod Kubernetes),
clients connected to Worker A will only receive events published on Worker A unless backed
by a shared message broker like Redis. For single-process instances (or sticky WebSocket/SSE
affinity), this broker provides zero-dependency, sub-millisecond local delivery.
"""
import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


class NegotiationEventBroker:
    """Manages real-time negotiation subscribers and replay history buffer."""

    _instance: Optional["NegotiationEventBroker"] = None

    def __init__(self, max_history_per_assignment: int = 100):
        # Map event_id -> Set of asyncio.Queue
        self._subscribers: Dict[str, Set[asyncio.Queue]] = {}
        # Map assignment_id -> Set of asyncio.Queue
        self._assignment_subscribers: Dict[str, Set[asyncio.Queue]] = {}
        # Chronological buffer: assignment_id -> list of event dicts with sequential IDs
        self._event_history: Dict[str, List[Dict[str, Any]]] = {}
        self._event_counter: int = 0
        self._max_history: int = max_history_per_assignment
        self._lock = asyncio.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    @classmethod
    def get_instance(cls) -> "NegotiationEventBroker":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def subscribe(
        self, event_id: str, assignment_id: Optional[str] = None
    ) -> asyncio.Queue:
        """Register a new subscriber queue for an event and optional assignment."""
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            if event_id not in self._subscribers:
                self._subscribers[event_id] = set()
            self._subscribers[event_id].add(queue)

            if assignment_id:
                if assignment_id not in self._assignment_subscribers:
                    self._assignment_subscribers[assignment_id] = set()
                self._assignment_subscribers[assignment_id].add(queue)

        logger.debug(
            "Subscribed client to negotiation stream [event=%s, assignment=%s]",
            event_id,
            assignment_id,
        )
        return queue

    async def unsubscribe(
        self, event_id: str, queue: asyncio.Queue, assignment_id: Optional[str] = None
    ) -> None:
        """Cleanly remove a subscriber queue on disconnect."""
        async with self._lock:
            if event_id in self._subscribers:
                self._subscribers[event_id].discard(queue)
                if not self._subscribers[event_id]:
                    del self._subscribers[event_id]

            if assignment_id and assignment_id in self._assignment_subscribers:
                self._assignment_subscribers[assignment_id].discard(queue)
                if not self._assignment_subscribers[assignment_id]:
                    del self._assignment_subscribers[assignment_id]

        logger.debug(
            "Unsubscribed client from negotiation stream [event=%s, assignment=%s]",
            event_id,
            assignment_id,
        )

    def get_history_since(
        self,
        event_id: str,
        assignment_id: Optional[str] = None,
        since_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Returns buffered events published after `since_id`."""
        all_events: List[Dict[str, Any]] = []
        if assignment_id and assignment_id in self._event_history:
            history = self._event_history[assignment_id]
        else:
            # Aggregate across all assignments for the event
            history = []
            for evs in self._event_history.values():
                for e in evs:
                    if e.get("event_id") == event_id:
                        history.append(e)
            history.sort(key=lambda x: x.get("sequence", 0))

        if not since_id:
            return list(history)

        idx = -1
        for i, item in enumerate(history):
            if str(item.get("id")) == str(since_id) or str(item.get("sequence")) == str(since_id):
                idx = i
                break

        if idx >= 0:
            return history[idx + 1 :]
        return list(history)

    async def broadcast(
        self,
        event_id: str,
        assignment_id: str,
        event_type: str,
        data: Dict[str, Any],
    ) -> None:
        """Broadcasts a negotiation event to all active subscribers and appends to history."""
        self._event_counter += 1
        seq = self._event_counter
        event_msg = {
            "id": f"neg_evt_{seq}",
            "sequence": seq,
            "type": event_type,
            "event_id": event_id,
            "assignment_id": assignment_id,
            "timestamp": time.time(),
            "data": data,
        }

        # Append to bounded history
        if assignment_id not in self._event_history:
            self._event_history[assignment_id] = []
        hist = self._event_history[assignment_id]
        hist.append(event_msg)
        if len(hist) > self._max_history:
            hist.pop(0)

        # Distribute to listeners
        async with self._lock:
            # Combine subscribers for this specific assignment and event-wide listeners
            targets: Set[asyncio.Queue] = set(self._subscribers.get(event_id, []))
            if assignment_id in self._assignment_subscribers:
                targets.update(self._assignment_subscribers[assignment_id])

        for q in targets:
            try:
                q.put_nowait(event_msg)
            except asyncio.QueueFull:
                logger.warning(
                    "Negotiation stream queue full for event=%s, dropping frame",
                    event_id,
                )

    def publish_sync(
        self,
        event_id: str,
        assignment_id: str,
        event_type: str,
        data: Dict[str, Any],
    ) -> None:
        """Thread-safe synchronous publisher for non-async services."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(event_id, assignment_id, event_type, data))
        except RuntimeError:
            if self._loop and self._loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    self.broadcast(event_id, assignment_id, event_type, data), self._loop
                )
            else:
                # Still record in history even if no active async loop
                self._event_counter += 1
                seq = self._event_counter
                event_msg = {
                    "id": f"neg_evt_{seq}",
                    "sequence": seq,
                    "type": event_type,
                    "event_id": event_id,
                    "assignment_id": assignment_id,
                    "timestamp": time.time(),
                    "data": data,
                }
                if assignment_id not in self._event_history:
                    self._event_history[assignment_id] = []
                hist = self._event_history[assignment_id]
                hist.append(event_msg)
                if len(hist) > self._max_history:
                    hist.pop(0)


negotiation_broker = NegotiationEventBroker.get_instance()
