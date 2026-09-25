# TASK 00 Audit

## Existing architecture
The relevant files, classes, and functions currently present in the EVENTRA codebase:

- **Agent / LangGraph + Tool Registry**:
  - [`apps/api/app/agent/graph.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/graph.py): `EventOperationsAgent` (LangGraph agent workflow graph orchestrating autonomous event operations).
  - [`apps/api/app/agent/agent.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/agent.py): `run_agent()`, `agent_loop()` execution routines.
  - [`apps/api/app/agent/state.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/state.py): `AgentState` schema.
  - [`apps/api/app/agent/tools/registry.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/tools/registry.py): `AgentToolRegistry`, `AgentTool`, `ToolDefinition` (Central registry enforcing input validation, approval gating, and trace logging).
  - [`apps/api/app/agent/tools/provider_tools.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/tools/provider_tools.py): `DiscoverProvidersTool`, `QualifyProviderTool`, `CheckProviderAvailabilityTool`, `CompareCandidatesTool`, `ShortlistVendorsTool`, `SubmitVendorOutcomeTool`, `ValidateVendorOutcomeTool`, `BindVendorToTaskTool`.
  - [`apps/api/app/agent/tools/communication_tools.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/tools/communication_tools.py): `contact_provider()`, `negotiate_with_provider()`, `request_provider_approval()`, `confirm_provider_engagement()`, `simulate_provider_response()`, `get_provider_negotiation_history()`.
  - [`apps/api/app/agent/tools/recovery_tools.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/tools/recovery_tools.py): `GenerateRecoveryOptionsTool`, `ValidateRecoveryOptionTool`.

- **Vendor Models / Discovery / Outcome Pipeline**:
  - [`apps/api/app/models/vendor.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/models/vendor.py): `Vendor` DB model.
  - [`apps/api/app/models/vendor_outcome.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/models/vendor_outcome.py): `VendorOutcome` DB model.
  - [`apps/api/app/models/vendor_outcome_validation.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/models/vendor_outcome_validation.py): `VendorOutcomeValidation` DB model.
  - [`apps/api/app/models/vendor_assignment.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/models/vendor_assignment.py): `VendorAssignment` DB model.
  - [`apps/api/app/services/vendor_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/vendor_service.py): `VendorService.generate_deterministic_shortlist()`, `VendorService.discover_providers()`.
  - [`apps/api/app/services/vendor_outcome_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/vendor_outcome_service.py): `VendorOutcomeService.record_outcome()`.
  - [`apps/api/app/services/vendor_outcome_validation_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/vendor_outcome_validation_service.py): `VendorOutcomeValidationService.parse_outcome()`, `VendorOutcomeValidationService.validate_claims()`.
  - [`apps/api/app/services/vendor_task_binding_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/vendor_task_binding_service.py): `VendorTaskBindingService.evaluate_feasibility()`, `VendorTaskBindingService.bind_vendor_to_task()`.

- **NegotiationService**:
  - [`apps/api/app/services/negotiation_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/negotiation_service.py): `NegotiationService` (`initiate_engagement()`, `negotiate()`, `process_provider_response()`, `resolve_provider_by_phone()`, `find_active_assignment()`, `request_approval()`, `confirm_engagement()`).

- **ApprovalService**:
  - [`apps/api/app/services/approval_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/approval_service.py): `ApprovalService` (`create_request()`, `approve()`, `reject()`).

- **RecoveryService / Phase 10 (P3)**:
  - [`apps/api/app/services/recovery_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/recovery_service.py): `RecoveryService` (`generate_recovery_options()`, `list_recovery_options()`, `get_recovery_option()`).
  - [`apps/api/app/engines/recovery/generator.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/engines/recovery/generator.py): `RecoveryGenerator`.
  - [`apps/api/app/engines/recovery/simulator.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/engines/recovery/simulator.py): `RecoverySimulator`.
  - [`apps/api/app/engines/recovery/validator.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/engines/recovery/validator.py): `RecoveryValidator`.

- **Pause/Resume / Phase 11**:
  - [`apps/api/app/services/pause_resume_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/pause_resume_service.py): `PauseResumeService` (`pause_event()`, `resume_event()`, `get_execution_state()`).

- **Communication Provider Abstractions**:
  - [`apps/api/app/integrations/base.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/integrations/base.py): `ProviderCommunicationProvider` (Abstract base interface: `send_message()`, `get_messages()`, `receive_inbound()`).
  - [`apps/api/app/integrations/registry.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/integrations/registry.py): `IntegrationRegistry.get_communication_provider()`.
  - [`apps/api/app/services/provider_communication_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/provider_communication_service.py): `ProviderCommunicationService`.
  - [`apps/api/app/integrations/whatsapp/client.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/integrations/whatsapp/client.py): `OpenWACommunicationAdapter`, `WhatsAppAdapter`.
  - [`apps/api/app/integrations/communication/mock.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/integrations/communication/mock.py): `MockCommunicationProvider`.

- **API / WebSocket Infrastructure**:
  - [`apps/api/app/main.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/main.py): FastAPI app initialization and route registration.
  - [`apps/api/app/api/routes/integrations.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/api/routes/integrations.py): Routes for `/webhooks/openwa`, `/integrations/openwa/webhook`, `/events/{event_id}/providers/{provider_id}/messages`.
  - [`apps/api/app/api/routes/vendors.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/api/routes/vendors.py): Routes for vendor discovery, outcomes, validation, binding.
  - WebSocket routes for voice stream endpoints: NOT FOUND (need to be added in Phase voice integration).

- **Config / Env Setup**:
  - [`apps/api/app/core/config.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/core/config.py): `Settings` class (Pydantic BaseSettings loading from `.env`).
  - [`apps/api/requirements.txt`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/requirements.txt): Existing dependencies include `google-genai>=1.0.0`, `websockets>=12.0`, `fastapi`, `uvicorn`, `httpx`, `langgraph`, `sqlalchemy`, `pydantic`.

- **Tests**:
  - [`apps/api/tests/unit/agent/test_vendor_outcome.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/tests/unit/agent/test_vendor_outcome.py)
  - [`apps/api/tests/unit/agent/test_vendor_outcome_validation.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/tests/unit/agent/test_vendor_outcome_validation.py)
  - [`apps/api/tests/unit/agent/test_vendor_binding.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/tests/unit/agent/test_vendor_binding.py)
  - [`apps/api/tests/unit/agent/test_p3_agentic_recovery.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/tests/unit/agent/test_p3_agentic_recovery.py)
  - [`apps/api/tests/unit/agent/test_task11_pause_resume.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/tests/unit/agent/test_task11_pause_resume.py)

---

## Vendor outcome flow
The existing flow for processing vendor outcomes follows a strict deterministic lifecycle:

`communication → outcome → validation → task binding/recalculation`

1. **Communication**:
   Inbound/Outbound message or interaction handled via `ProviderCommunicationService` (or OpenWA / future Exotel call adapter). Phone number is resolved via `NegotiationService.resolve_provider_by_phone()`.
2. **Outcome Recording**:
   Raw text or call transcript is ingested into `VendorOutcomeService.record_outcome()`. It normalizes prices, currency, and availability fields, sets explicit provenance tags (`source="ORGANIZER_REPORTED"` or `"AI_VOICE_CALL"`, `verification_status="UNVERIFIED"`), and logs an immutable `AuditRecord`. It guarantees zero side-effect mutations to `task.provider_id` or task state.
3. **Outcome Validation**:
   `VendorOutcomeValidationService.parse_outcome()` uses LLM structured output parsing to extract `ExtractedClaim`s (price, availability, capacity, terms). Then `validate_claims()` deterministically verifies claims against authoritative Event budget, capacity, requirements, calendar slots, and vendor data, producing a `VendorOutcomeValidation` record with verification status (`VALIDATED`, `PARTIALLY_VALIDATED`, `FAILED`, `CONFLICT`).
4. **Task Binding / Recalculation**:
   `VendorTaskBindingService.evaluate_feasibility()` checks binding feasibility against individual validated claims. If feasible, `bind_vendor_to_task()` updates `task.provider_id`, `task.status = ASSIGNED`, creates `VendorAssignment`, runs `DependencyGraph` & CPM (`CriticalPathCalculator`), recalculates schedule (`ScheduleEngine`), commits budget (`BudgetCalculator`), and updates state transition and audit logs.

---

## P3 / Recovery integration point
- `call_vendor()` will plug in via a new agent tool `CallVendorTool` in [`apps/api/app/agent/tools/provider_tools.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/tools/provider_tools.py) (or `voice_tools.py`) registered in [`apps/api/app/agent/tools/registry.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/tools/registry.py).
- When `RecoveryService` ([`apps/api/app/services/recovery_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/recovery_service.py)) generates or executes vendor replacement recovery options, or when `EventOperationsAgent` ([`apps/api/app/agent/graph.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/agent/graph.py)) initiates outbound vendor outreach, the agent calls `call_vendor(db, event_id, task_id, provider_id, negotiation_context)`.
- `call_vendor()` triggers an outbound PSTN call via Exotel, attaches session metadata, and launches the Gemini Live WebSocket voice session.

---

## Communication integration point
- The abstract base class `ProviderCommunicationProvider` in [`apps/api/app/integrations/base.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/integrations/base.py) currently defines `send_message()`, `get_messages()`, `receive_inbound()`.
- An `ExotelVoiceAdapter` will be created in [`apps/api/app/integrations/communication/exotel.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/integrations/communication/exotel.py) implementing `make_call()` / `send_message()` and registered in `IntegrationRegistry` ([`apps/api/app/integrations/registry.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/integrations/registry.py)).
- Incoming voice transcripts will feed into `ProviderCommunicationService` ([`apps/api/app/services/provider_communication_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/provider_communication_service.py)) and `NegotiationService.process_provider_response()`.

---

## Voice repo findings
Findings from inspecting `AI-Voice-Support-Agent/main.py`:

- **What can be reused**:
  - System Prompting Strategy: Structuring rules (language preference selection, concise responses, pricing guardrails, single-question flow, polite exit greetings).
  - Gemini Realtime Configuration Concepts: Gemini Live API parameters, voice selection (`voice="Leda"`), `response_modalities=["AUDIO"]`, and system instructions setup.
- **What MUST be replaced**:
  - VideoSDK framework (`videosdk.agents`, `Pipeline`, `JobContext`, `RoomOptions`, `WorkerJob`, `GeminiRealtime`). VideoSDK assumes WebRTC audio/video room conferencing. For PSTN telephony via Exotel, VideoSDK is NOT used. Audio stream handling will be handled directly via FastAPI WebSockets (`websockets`) and Gemini Live API (`google-genai`).

---

## Proposed architecture

```
EVENTRA (LangGraph Agent / NegotiationService / P3 Recovery)
  │
  ▼
Call Orchestrator (Exotel Call Trigger & Session Manager)
  │
  ▼
Exotel Outbound Call (PSTN Telephony to Vendor Phone Number)
  │
  ▼
Vendor (Human Telephony Audio)
  ↕
Bidirectional WebSocket (Audio Streams / Media Stream Gateway)
  ↕
Voice Gateway (Format Conversion: G.711/PCM ↔ Gemini Audio)
  ↕
Gemini Live API (Bidirectional Audio / Multimodal Live Session)
  │
  ▼
Transcript Ingestion (Call Summary + Turn-by-Turn Audio Transcript)
  │
  ▼
existing VendorOutcomeService (record_outcome -> ORGANIZER_REPORTED / AI_VOICE_CALL)
  │
  ▼
existing VendorOutcomeValidationService (parse_outcome via LLM -> validate_claims)
  │
  ▼
existing deterministic EVENTRA services (VendorTaskBindingService -> NegotiationService -> ApprovalService -> RecoveryService)
```

---

## Proposed implementation order
1. **Task 01: Exotel Foundation & Telephony Adapter**: Configure `EXOTEL_*` env variables in `config.py` and create `ExotelVoiceAdapter` in `apps/api/app/integrations/communication/exotel.py` for triggering PSTN outbound calls.
2. **Task 02: Voice WebSocket Gateway**: Add FastAPI WebSocket route `/api/v1/voice/stream/{session_id}` in `apps/api/app/api/routes/voice.py` to stream bidirectional audio frames with Exotel.
3. **Task 03: Gemini Live API Integration**: Build `GeminiLiveSession` manager using `google-genai` / `websockets` to bridge telephony audio streams directly with Gemini Live API.
4. **Task 04: Call Orchestrator & Dynamic System Prompts**: Build `VendorVoiceOrchestrator` to load event/task/vendor context, negotiation bounds, and generate dynamic system prompts for the call.
5. **Task 05: Real-time Transcript & Outcome Pipeline Bridge**: Build transcript aggregator to collect call transcripts upon call hangup and post them into `VendorOutcomeService.record_outcome()`.
6. **Task 06: Voice Outcome Validation & Negotiation Integration**: Connect voice outcome records to `VendorOutcomeValidationService` and `NegotiationService` to update assignment states or request human approvals.
7. **Task 07: `call_vendor()` Agent Tool & Tool Registry Binding**: Implement `CallVendorTool` in `apps/api/app/agent/tools/voice_tools.py` and register it in `apps/api/app/agent/tools/registry.py` for agent/P3 invocation.
8. **Task 08: End-to-End Testing & Verification**: Implement unit and integration tests (`tests/unit/agent/test_voice_call_pipeline.py`) simulating Exotel WebSockets, Gemini Live sessions, and downstream outcome/binding pipelines.

---

## Risks/blockers
- **Exotel Media Stream WebSocket Protocol Schema**: Exact payload structure, framing format, and encoding (G.711 mulaw vs PCM) for Exotel outbound media stream WebSockets. Marked as **UNKNOWN (Exotel stream schema details)**.
- **Audio Sample Rate Conversion**: Resampling between PSTN 8kHz G.711 mulaw audio and Gemini Live 16kHz/24kHz PCM16 audio without introducing latency.
- **WebSocket Latency**: Maintaining sub-500ms round-trip latency over double WebSocket connection (Exotel ↔ EVENTRA ↔ Gemini Live) for natural conversation flow.

---

## Do-not-touch
The following core deterministic components MUST remain unchanged:
- [`apps/api/app/engines/dependency/graph.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/engines/dependency/graph.py) (`DependencyGraph`)
- [`apps/api/app/engines/dependency/traversal.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/engines/dependency/traversal.py) (`CriticalPathCalculator`)
- [`apps/api/app/engines/schedule/scheduler.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/engines/schedule/scheduler.py) (`ScheduleEngine`)
- [`apps/api/app/engines/budget/calculator.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/engines/budget/calculator.py) (`BudgetCalculator`)
- [`apps/api/app/services/vendor_task_binding_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/vendor_task_binding_service.py) (`VendorTaskBindingService`)
- [`apps/api/app/services/approval_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/approval_service.py) (`ApprovalService`)
- [`apps/api/app/services/pause_resume_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/pause_resume_service.py) (`PauseResumeService`)
- [`apps/api/app/services/vendor_outcome_service.py`](file:///Users/aayushdutta/Documents/codes/EVENtRA-dax/EVENTRA/apps/api/app/services/vendor_outcome_service.py) (`VendorOutcomeService`)

---

## Verification
Relevant existing test suites and commands to execute for future verification:
- `pytest apps/api/tests/unit/agent/test_vendor_outcome.py`
- `pytest apps/api/tests/unit/agent/test_vendor_outcome_validation.py`
- `pytest apps/api/tests/unit/agent/test_vendor_binding.py`
- `pytest apps/api/tests/unit/agent/test_p3_agentic_recovery.py`
- `pytest apps/api/tests/unit/agent/test_task11_pause_resume.py`
- New voice integration test suite: `pytest apps/api/tests/unit/agent/test_voice_call_pipeline.py`
