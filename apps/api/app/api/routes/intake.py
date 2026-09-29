import logging
import re
import time
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, UploadFile, File, Form, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session, get_current_user_id
from app.services.intake_service import IntakeService
from app.services.speech_service import get_speech_provider, TranscriptResult
from app.services.activity_log_service import ActivityLogService
from app.services.autonomous_operations_service import AutonomousOperationsService
from app.services.negotiation_service import NegotiationService
from app.models.enums import EventType
from app.core.exceptions import NotFoundException, BadRequestException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["Event Intake & Autonomous Operations"])

# In-memory sliding-window rate limiter for audio transcription (15 requests/min per operator)
_TRANSCRIBE_RATE_LIMIT = defaultdict(list)
_MAX_TRANSCRIBE_PER_MINUTE = 15

ALLOWED_AUDIO_MIME_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/aac",
    "audio/flac",
}
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB


def _check_transcribe_rate_limit(client_id: str) -> None:
    now = time.time()
    window = now - 60.0
    timestamps = [t for t in _TRANSCRIBE_RATE_LIMIT[client_id] if t > window]
    if len(timestamps) >= _MAX_TRANSCRIBE_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Voice transcription rate limit exceeded. Please wait a moment before trying again.",
        )
    timestamps.append(now)
    _TRANSCRIBE_RATE_LIMIT[client_id] = timestamps


def _find_evidence_quote(text: str, keywords: List[str]) -> Optional[str]:
    """Finds a sentence or clause in the transcript containing any of the keywords."""
    if not text or not keywords:
        return None
    sentences = re.split(r"[.,!?\n]+", text)
    for s in sentences:
        s_clean = s.strip()
        if not s_clean:
            continue
        s_lower = s_clean.lower()
        if any(kw.lower() in s_lower for kw in keywords if kw and len(kw) > 1):
            return s_clean
    return None


# ---------------------------------------------------------------------------
# Request & Response Schemas
# ---------------------------------------------------------------------------

class IntakeRequest(BaseModel):
    message: str = Field(..., description="Natural language description of the event or organizer intent.")
    event_id: Optional[str] = Field(None, description="Optional existing event ID if continuing a session.")
    force_plan: bool = Field(False, description="If true, generates plan immediately with sensible defaults.")


class ModifyPlanRequest(BaseModel):
    modification: str = Field(..., description="Natural language modification (e.g. 'Remove photography and add security', 'Increase budget to 10 lakh').")


class ProviderQuoteRequest(BaseModel):
    amount: float = Field(..., gt=0, description="Quoted amount received from provider.")
    notes: Optional[str] = Field(None, description="Optional quote notes or terms.")


class TranscribeResponse(BaseModel):
    text: str
    detected_language: str
    english_text: str
    confidence: Optional[float] = None
    provider: str


class FieldProvenance(BaseModel):
    value: Any
    source: str = Field(..., description="'stated' | 'inferred' | 'default'")
    confidence: float = Field(0.9, ge=0.0, le=1.0)
    evidence_quote: Optional[str] = Field(None, description="Transcript snippet supporting this field value")


class VoiceIntakeSuggestion(BaseModel):
    id: str
    type: str = "category"
    label: str
    value: str
    source: str = "inferred"
    reason: str
    accepted: bool = False


class VoicePreviewRequest(BaseModel):
    transcript: str = Field(..., min_length=1, description="Original language transcript")
    english_text: Optional[str] = Field(None, description="English rendering / translation")
    detected_language: Optional[str] = Field("en", description="Detected language code")
    event_id: Optional[str] = Field(None, description="Optional event ID")


class VoiceIntakePreview(BaseModel):
    fields: Dict[str, FieldProvenance]
    missing_fields: List[str]
    clarifying_questions: List[str]
    suggestions: List[VoiceIntakeSuggestion]
    detected_language: str
    original_transcript: str
    english_transcript: str


class VoiceConfirmRequest(BaseModel):
    fields: Dict[str, Any] = Field(..., description="Approved edited event attributes")
    accepted_suggestions: List[str] = Field(default_factory=list, description="IDs or values of accepted suggestions")
    detected_language: Optional[str] = "en"
    original_transcript: Optional[str] = None
    explicit_defaults_accepted: bool = Field(default=False, description="Explicit acknowledgment if defaults are used for unspecified parameters")
    idempotency_key: Optional[str] = Field(default=None, description="Client idempotency token to prevent double-click duplicates")


_PROCESSED_INTAKE_CACHE: Dict[str, Tuple[datetime, Dict[str, Any]]] = {}



# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/intake", status_code=status.HTTP_200_OK)
def process_intake(
    req: IntakeRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Process natural language organizer input.
    
    Extracts intent, detects missing information, prompts conversationally,
    or generates the full authoritative operational plan.
    """
    service = IntakeService(db)
    try:
        result = service.process_intake(
            message=req.message,
            event_id=req.event_id,
            force_plan=req.force_plan,
        )
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process event intake: {str(exc)}",
        )


@router.post("/intake/voice/transcribe", response_model=TranscribeResponse, status_code=status.HTTP_200_OK)
async def transcribe_voice(
    file: UploadFile = File(...),
    language_hint: Optional[str] = Form(None),
    current_user_id: str = Depends(get_current_user_id),
) -> TranscribeResponse:
    """Transcribes organizer speech via Gemini Audio Understanding or Whisper API.

    Audio is processed directly from memory/temporary stream and is NEVER retained.
    """
    _check_transcribe_rate_limit(current_user_id)

    raw_mime = (file.content_type or "audio/webm").lower()
    clean_mime = raw_mime.split(";")[0].strip()

    if clean_mime not in ALLOWED_AUDIO_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio format '{clean_mime}'. Allowed formats: webm, ogg, mp4, m4a, wav, mp3.",
        )

    try:
        audio_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not read uploaded audio: {str(exc)}",
        )

    if not audio_bytes or len(audio_bytes) < 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded audio is empty or corrupt.",
        )

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Audio payload exceeds maximum allowed size of 25MB.",
        )

    try:
        provider = get_speech_provider()
        result: TranscriptResult = provider.transcribe(
            audio_bytes=audio_bytes,
            mime_type=clean_mime,
            language_hint=language_hint,
        )
        return TranscribeResponse(
            text=result.text,
            detected_language=result.detected_language,
            english_text=result.english_text,
            confidence=result.confidence,
            provider=result.provider,
        )
    except ValueError as ve:
        logger.error("Speech transcription configuration error: %s", ve)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(ve))
    except Exception as exc:
        logger.error("Speech transcription failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transcription failed: {str(exc)}",
        )


@router.post("/intake/voice/preview", response_model=VoiceIntakePreview, status_code=status.HTTP_200_OK)
def preview_voice_intake(
    req: VoicePreviewRequest,
    db: Session = Depends(get_db_session),
) -> VoiceIntakePreview:
    """Extracts structured intent from transcript for verification WITHOUT persisting any Event rows."""
    service = IntakeService(db)
    effective_text = req.english_text if req.english_text and len(req.english_text.strip()) > 0 else req.transcript

    # Non-persistent intent extraction
    extracted = service.extract_intent(text=effective_text)

    transcript_orig = req.transcript
    combined_search = f"{req.transcript} {req.english_text or ''}".lower()

    # 1. Location
    loc_val = extracted.get("location")
    loc_quote = None
    loc_source = "stated" if loc_val else "default"
    if loc_val:
        loc_quote = _find_evidence_quote(transcript_orig, [loc_val]) or _find_evidence_quote(req.english_text or "", [loc_val])
        if not loc_quote:
            loc_source = "inferred"

    # 2. Guest Count (Hard rule: no invented numbers)
    guest_val = extracted.get("guest_count")
    guest_quote = None
    guest_source = "stated" if guest_val else "default"
    has_guest_spoken = any(k in combined_search for k in ["guest", "attendee", "people", "log", "pax", "person", "crowd", "audience", "लोग", "मेहमान", "mehmaan", "mehman", "students"]) or any(c.isdigit() for c in combined_search)
    if guest_val is not None:
        if not has_guest_spoken:
            guest_val = None
            guest_source = "default"
        else:
            guest_quote = _find_evidence_quote(transcript_orig, ["guest", "attendee", "people", "log", "pax", "person", "लोग", "मेहमान", str(guest_val)]) or _find_evidence_quote(req.english_text or "", ["guest", "attendee", "people", "pax", str(guest_val)])

    # 3. Budget (Hard rule: missing budget must yield budget in missing_fields, not a guessed number)
    budget_val = extracted.get("total_budget")
    budget_quote = None
    budget_source = "stated" if budget_val else "default"
    has_budget_spoken = any(k in combined_search for k in ["budget", "lakh", "lac", "crore", "thousand", "rupees", "inr", "$", "dollar", "rs", "cost", "spend", "paisa", "rupaye", "rupiya", "paise", "रुपए", "लाख", "हजार", "बजट", "खर्च"])
    if budget_val is not None:
        if not has_budget_spoken:
            budget_val = None
            budget_source = "default"
        else:
            budget_quote = _find_evidence_quote(transcript_orig, ["budget", "lakh", "lac", "crore", "thousand", "rupees", "inr", "$", "rs", "paisa", "rupaye", "रुपए", "लाख", "हजार", "बजट", str(int(budget_val))]) or _find_evidence_quote(req.english_text or "", ["budget", "lakh", "lac", "thousand", "$", "cost"])

    # 4. Event Type
    type_val = extracted.get("event_type") or "CONFERENCE"
    type_quote = None
    type_source = "stated"
    if any(k in combined_search for k in ["wedding", "shaadi", "marriage", "reception", "vivah", "शादी", "विवाह"]):
        type_quote = _find_evidence_quote(transcript_orig, ["wedding", "shaadi", "marriage", "reception", "vivah", "शादी", "विवाह"]) or _find_evidence_quote(req.english_text or "", ["wedding", "marriage", "reception"])
    elif any(k in combined_search for k in ["conference", "summit", "corporate", "convention", "सम्मेलन"]):
        type_quote = _find_evidence_quote(transcript_orig, ["conference", "summit", "corporate", "convention", "सम्मेलन"]) or _find_evidence_quote(req.english_text or "", ["conference", "summit"])
    elif any(k in combined_search for k in ["fest", "hackathon", "college"]):
        type_quote = _find_evidence_quote(transcript_orig, ["fest", "hackathon", "college"]) or _find_evidence_quote(req.english_text or "", ["fest", "hackathon"])
    else:
        type_source = "default"

    # 5. Name (Suggested if organizer did not state one)
    intent_model = extracted.get("intent_model")
    stated_title = intent_model.event_title if intent_model else None
    name_quote = None
    name_source = "inferred"
    if stated_title and stated_title.lower() in combined_search:
        name_val = stated_title
        name_source = "stated"
        name_quote = _find_evidence_quote(transcript_orig, [stated_title])
    else:
        name_val = extracted.get("name") or f"{loc_val or 'City'} {type_val.title()} 2026"
        name_source = "inferred"

    # 6. Dates & Timing
    date_expr_val = extracted.get("date_expression")
    start_time_val = extracted.get("start_time")
    end_time_val = extracted.get("end_time")
    date_quote = None
    date_source = "stated" if (date_expr_val or start_time_val) else "default"
    if date_expr_val:
        date_quote = _find_evidence_quote(transcript_orig, [date_expr_val, "tomorrow", "next week", "next month", "december", "november", "october", "january", "february", "march", "april", "may", "june", "july", "august", "september", "नवंबर", "दिसंबर", "तारीख"]) or _find_evidence_quote(req.english_text or "", [date_expr_val])


    # 7. Currency
    currency_val = extracted.get("currency") or "INR"
    curr_quote = None
    curr_source = "default"
    if any(k in combined_search for k in ["rupee", "inr", "rs", "rupaye"]):
        curr_source = "stated"
        curr_quote = _find_evidence_quote(transcript_orig, ["rupee", "inr", "rs", "rupaye"])
    elif any(k in combined_search for k in ["dollar", "usd", "$"]):
        curr_source = "stated"
        curr_quote = _find_evidence_quote(transcript_orig, ["dollar", "usd", "$"])
    else:
        curr_quote = "Default platform currency"

    # 8. Requirements
    reqs_val = extracted.get("requirements") or []
    reqs_quote = _find_evidence_quote(transcript_orig, [r.lower() for r in reqs_val]) if reqs_val else None

    # Assemble Field Provenance map
    fields: Dict[str, FieldProvenance] = {
        "name": FieldProvenance(value=name_val, source=name_source, confidence=0.92, evidence_quote=name_quote),
        "event_type": FieldProvenance(value=type_val, source=type_source, confidence=0.95, evidence_quote=type_quote),
        "location": FieldProvenance(value=loc_val, source=loc_source, confidence=0.90 if loc_val else 0.5, evidence_quote=loc_quote),
        "guest_count": FieldProvenance(value=guest_val, source=guest_source, confidence=0.90 if guest_val else 0.5, evidence_quote=guest_quote),
        "date_expression": FieldProvenance(value=date_expr_val, source=date_source, confidence=0.88 if date_expr_val else 0.5, evidence_quote=date_quote),
        "start_datetime": FieldProvenance(value=start_time_val.isoformat() if start_time_val else None, source=date_source, confidence=0.88 if start_time_val else 0.5, evidence_quote=date_quote),
        "end_datetime": FieldProvenance(value=end_time_val.isoformat() if end_time_val else None, source=date_source, confidence=0.85 if end_time_val else 0.5, evidence_quote=date_quote),
        "total_budget": FieldProvenance(value=budget_val, source=budget_source, confidence=0.92 if budget_val else 0.5, evidence_quote=budget_quote),
        "currency": FieldProvenance(value=currency_val, source=curr_source, confidence=0.95, evidence_quote=curr_quote),
        "requirements": FieldProvenance(value=reqs_val, source="stated" if reqs_val else "default", confidence=0.85, evidence_quote=reqs_quote),
        "description": FieldProvenance(value=extracted.get("summary") or effective_text[:200], source="inferred", confidence=0.85, evidence_quote=None),
    }

    # Evaluate missing fields & 1-3 targeted clarifying questions
    missing_fields: List[str] = []
    clarifying_questions: List[str] = []

    if not loc_val:
        missing_fields.append("Event Location / City")
        clarifying_questions.append("Which city or venue location do you have in mind?")

    if not guest_val:
        missing_fields.append("Expected Guest Count")
        clarifying_questions.append("How many attendees or guests are you planning for?")

    if not budget_val:
        missing_fields.append("Total Budget")
        clarifying_questions.append("What is your approximate total budget for this event?")

    if not start_time_val and not date_expr_val:
        missing_fields.append("Event Date")
        clarifying_questions.append("When would you like the event to take place?")

    clarifying_questions = clarifying_questions[:3]

    # Suggestions: things LLM proposes to ADD that organizer did NOT say
    CATEGORY_LABELS = {
        "DECOR": ("Add Decor & Floral Styling", "Mandap, stage and entrance design typically required for weddings"),
        "PHOTOGRAPHY": ("Add Photography & Videography", "Professional photo and cinematic video capture"),
        "DJ_MUSIC": ("Add DJ & Music Setup", "Sound system and music entertainment"),
        "CATERING": ("Add Catering & Food Services", "Buffet or multi-cuisine dining options"),
        "AV_TECH": ("Add Audiovisual Tech & Lighting", "Projector screens, mics, stage lights and PA system"),
        "TRANSPORT": ("Add Guest & VIP Transport", "Shuttle and cab logistics for guests"),
        "SECURITY": ("Add Security & Crowd Management", "Bouncers, check-in security and crowd control"),
        "MAKEUP": ("Add Hair & Makeup Styling", "Professional styling services"),
    }

    SUGGESTIONS_BY_TYPE = {
        "WEDDING": ["DECOR", "PHOTOGRAPHY", "DJ_MUSIC", "MAKEUP"],
        "CONFERENCE": ["AV_TECH", "CATERING", "TRANSPORT", "PHOTOGRAPHY"],
        "COLLEGE_FEST": ["AV_TECH", "DJ_MUSIC", "SECURITY", "CATERING"],
        "OTHER": ["AV_TECH", "CATERING", "PHOTOGRAPHY"],
    }

    potential_cats = SUGGESTIONS_BY_TYPE.get(type_val, SUGGESTIONS_BY_TYPE["OTHER"])
    existing_cats = set(reqs_val)

    suggestions: List[VoiceIntakeSuggestion] = []
    for cat in potential_cats:
        if cat not in existing_cats:
            label, reason = CATEGORY_LABELS.get(cat, (f"Add {cat.replace('_', ' ').title()}", f"Recommended for {type_val.title()} operations"))
            suggestions.append(
                VoiceIntakeSuggestion(
                    id=f"sug_{cat.lower()}",
                    type="category",
                    label=label,
                    value=cat,
                    source="inferred",
                    reason=reason,
                    accepted=False,
                )
            )

    return VoiceIntakePreview(
        fields=fields,
        missing_fields=missing_fields,
        clarifying_questions=clarifying_questions,
        suggestions=suggestions,
        detected_language=req.detected_language or "en",
        original_transcript=req.transcript,
        english_transcript=effective_text,
    )


@router.post("/intake/voice/confirm", status_code=status.HTTP_200_OK)
def confirm_voice_intake(
    req: VoiceConfirmRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Applies organizer-approved voice attributes, generates authoritative plan, and logs activity."""
    fields = req.fields or {}

    # 1. Idempotency protection against rapid double-clicks
    now = datetime.now(timezone.utc)
    if req.idempotency_key and req.idempotency_key in _PROCESSED_INTAKE_CACHE:
        cached_time, cached_res = _PROCESSED_INTAKE_CACHE[req.idempotency_key]
        if (now - cached_time).total_seconds() < 120:
            return cached_res

    # 2. Require explicit acceptance if mandatory parameters are missing
    missing_fields = []
    if not fields.get("location"):
        missing_fields.append("location")
    if not fields.get("guest_count"):
        missing_fields.append("guest_count")
    if not fields.get("total_budget"):
        missing_fields.append("total_budget")

    if missing_fields and not req.explicit_defaults_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Missing required event parameters: {', '.join(missing_fields)}. "
                "Please provide these fields or set explicit_defaults_accepted=True to accept standard defaults."
            ),
        )

    name = fields.get("name") or "New Event Operation"
    event_type = fields.get("event_type") or "CONFERENCE"
    location = fields.get("location") or "Delhi"
    guest_count = int(fields.get("guest_count") or 100)
    total_budget = float(fields.get("total_budget") or 500000.0)
    currency = fields.get("currency") or "INR"
    date_expr = fields.get("date_expression") or fields.get("start_datetime") or "Upcoming"

    # Merge approved requirements with accepted suggestions
    reqs = fields.get("requirements") or []
    all_reqs = list(reqs) if isinstance(reqs, list) else [r.strip() for r in str(reqs).split(",") if r.strip()]

    for sug in req.accepted_suggestions:
        cat = sug.replace("sug_", "").upper()
        if cat not in all_reqs:
            all_reqs.append(cat)

    reqs_str = ", ".join(r.replace("_", " ").title() for r in all_reqs) if all_reqs else "Standard operational categories"

    canonical_summary = (
        f"Organize a {event_type} named '{name}' in {location} for {guest_count} attendees "
        f"on {date_expr}. Budget: {total_budget} {currency}. "
        f"Required services: {reqs_str}."
    )

    service = IntakeService(db)
    structured_overrides = {
        "name": name,
        "event_type": event_type,
        "location": location,
        "guest_count": guest_count,
        "total_budget": total_budget,
        "currency": currency,
        "requirements": all_reqs,
        "date_expression": date_expr,
        "start_datetime": fields.get("start_datetime"),
        "end_datetime": fields.get("end_datetime"),
    }
    result = service.process_intake(
        message=canonical_summary,
        force_plan=True,
        user_id=current_user_id,
        structured_overrides=structured_overrides,
    )

    if req.idempotency_key:
        _PROCESSED_INTAKE_CACHE[req.idempotency_key] = (now, result)

    # Activity stream logging
    event_id = result.get("event_id") or (result.get("event", {}).get("id") if result.get("event") else None)
    if event_id:
        activity_service = ActivityLogService(db)
        activity_service.log(
            event_id=event_id,
            category="INTAKE",
            actor="ORGANIZER",
            action="VOICE_INTAKE_CONFIRMED",
            summary=f"Event created via voice intake ({req.detected_language or 'en'})",
            details={
                "detected_language": req.detected_language,
                "original_transcript": req.original_transcript,
                "approved_fields": fields,
                "accepted_suggestions": req.accepted_suggestions,
                "canonical_summary": canonical_summary,
            },
        )
        db.commit()

    return result


@router.post("/{event_id}/modify-plan", status_code=status.HTTP_200_OK)
def modify_plan(
    event_id: str,
    req: ModifyPlanRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Modifies an existing event plan via natural language and regenerates tasks and dependencies."""
    service = IntakeService(db)
    try:
        result = service.modify_plan(event_id=event_id, modification_text=req.modification)
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to modify plan: {str(exc)}",
        )


@router.post("/{event_id}/start-operations", status_code=status.HTTP_200_OK)
def start_operations(
    event_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Transitions event to LIVE and initiates autonomous operations & discovery in background.
    (Decision 1: start_operations must not run discovery synchronously in the request)
    """
    service = AutonomousOperationsService(db)
    try:
        init_result = service.initiate_operations_run(event_id=event_id, user_id=current_user_id)
        if init_result.get("status") != "ALREADY_RUNNING":
            background_tasks.add_task(
                AutonomousOperationsService.run_background_operations,
                event_id=event_id,
                run_id=init_result.get("run_id"),
                user_id=current_user_id,
            )
        return init_result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except BadRequestException as bre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(bre))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start operations: {str(exc)}",
        )


@router.get("/{event_id}/operations/status", status_code=status.HTTP_200_OK)
def get_operations_status(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Retrieves live operations telemetry, sourcing progress, budget allocation, and pending approvals."""
    service = AutonomousOperationsService(db)
    try:
        result = service.get_operations_status(event_id=event_id)
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch operations status: {str(exc)}",
        )


@router.post("/{event_id}/providers/{vendor_id}/quote", status_code=status.HTTP_200_OK)
def handle_provider_quote(
    event_id: str,
    vendor_id: str,
    req: ProviderQuoteRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Processes a provider quote, performs budget validation, and triggers counter-offer or approval gate."""
    service = NegotiationService(db)
    try:
        # Find assignment for provider
        assignment = service.find_active_assignment(vendor_id=vendor_id, event_id=event_id)
        if not assignment:
            assignment = db.query(VendorAssignment).filter(
                VendorAssignment.event_id == event_id,
                VendorAssignment.vendor_id == vendor_id,
            ).first()

        if not assignment:
            raise NotFoundException(f"No assignment found for vendor '{vendor_id}' in event '{event_id}'")

        result = service.process_quote(
            assignment_id=assignment.id,
            quoted_amount=req.amount,
            notes=req.notes,
        )
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except BadRequestException as bre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(bre))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process quote: {str(exc)}",
        )


class RecoveryApproveRequest(BaseModel):
    approval_id: str = Field(..., description="Approval request ID to authorize and execute.")


@router.post("/{event_id}/incidents/simulate-cancellation", status_code=status.HTTP_200_OK)
def simulate_cancellation_incident(
    event_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Simulates a sudden catering provider cancellation incident, triggers impact analysis,
    and synthesizes recovery alternatives with an approval request (Competition Scenario).
    """
    service = AutonomousOperationsService(db)
    try:
        result = service.simulate_caterer_cancellation(event_id=event_id, user_id=current_user_id)
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to simulate incident: {str(exc)}",
        )


@router.post("/{event_id}/recovery/approve", status_code=status.HTTP_200_OK)
def approve_recovery_action(
    event_id: str,
    req: RecoveryApproveRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Authorizes and executes an approved recovery substitution, verifies post-mutation state,
    unblocks the affected task, and restores the event state to LIVE/NORMAL.
    """
    service = AutonomousOperationsService(db)
    try:
        result = service.approve_and_execute_recovery(
            event_id=event_id,
            approval_id=req.approval_id,
            user_id=current_user_id,
        )
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute recovery approval: {str(exc)}",
        )

