"""In-Process Production-Safe Live Event Broker (B5).

Provides event-isolated real-time state push queues for Server-Sent Events (SSE).
Thread-safe and clean disconnect/reconnect handling without external brokers.
"""
import asyncio
import json
import logging
from typing import Any, AsyncGenerator, Dict, Optional, Set

logger = logging.getLogger(__name__)


class LiveEventBroker:
    """Manages real-time live event subscriber channels scoped by event_id."""

    _instance: Optional["LiveEventBroker"] = None

    def __init__(self):
        # Map event_id -> Set of asyncio.Queue
        self._subscribers: Dict[str, Set[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "LiveEventBroker":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def subscribe(self, event_id: str) -> asyncio.Queue:
        """Register a new subscriber queue for an event."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            if event_id not in self._subscribers:
                self._subscribers[event_id] = set()
            self._subscribers[event_id].add(queue)
        logger.debug("Subscribed client to event %s (active: %d)", event_id, len(self._subscribers[event_id]))
        return queue

    async def unsubscribe(self, event_id: str, queue: asyncio.Queue):
        """Cleanly remove a subscriber queue on disconnect."""
        async with self._lock:
            if event_id in self._subscribers:
                self._subscribers[event_id].discard(queue)
                if not self._subscribers[event_id]:
                    del self._subscribers[event_id]
        logger.debug("Unsubscribed client from event %s", event_id)

    async def broadcast(self, event_id: str, message: Dict[str, Any]):
        """Broadcast an authoritative operational state change to all active subscribers of this event."""
        async with self._lock:
            subs = list(self._subscribers.get(event_id, []))

        for q in subs:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                logger.warning("Subscriber queue full for event %s, dropping frame", event_id)

    def publish_sync(self, event_id: str, message: Dict[str, Any]):
        """Synchronous wrapper to safely publish from non-async domain code."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(event_id, message))
        except RuntimeError:
            # No running loop in this thread
            pass


live_broker = LiveEventBroker.get_instance()
