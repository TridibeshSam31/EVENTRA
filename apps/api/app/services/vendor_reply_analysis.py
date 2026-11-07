"""Understands what a vendor answered (WhatsApp reply or call transcript), in any language.

Produces a small, fixed-shape verdict the organizer can act on: did the vendor say
yes or no, are they available, what price did they quote, and what to do next. The
analysis is advisory only; nothing is sent to the vendor automatically.
"""
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

DECISIONS = {"YES", "NO", "MAYBE", "QUESTION", "UNCLEAR"}

ANALYSIS_PROMPT = """You analyse a vendor's reply to an event organizer's inquiry. The vendor may write in any
language or mix (Hindi, Hinglish, English, Tamil, ...). Read it carefully and answer ONLY with JSON:
{{
  "decision": "YES" | "NO" | "MAYBE" | "QUESTION" | "UNCLEAR",
  "available": true | false | null,
  "quoted_price": <number in rupees or null>,
  "summary": "<one short sentence in English>",
  "language": "<language the vendor used>"
}}
Rules:
- YES = vendor agrees / is available / will do it. NO = declines, not available, or refuses the offered price.
- MAYBE = conditional or undecided. QUESTION = vendor mainly asked something back.
- quoted_price: the total the vendor asked for, as a plain number ("25 hazaar" -> 25000, "1.5 lakh" -> 150000).
- Never invent a price that the vendor did not state.

Inquiry context: {context}

Vendor's reply:
\"\"\"{reply}\"\"\"
"""

_NO_WORDS = re.compile(
    r"\b(no|nahi|nahin|nhi|nai|na|not available|busy|booked|can'?t|cannot|nahi ho|nahi hoga|mushkil)\b|नहीं|ना\b|नही",
    re.IGNORECASE,
)
_YES_WORDS = re.compile(
    r"\b(yes|yeah|yep|haan|han|ha|ji|ok|okay|sure|available|done|theek|thik|kar dunga|ho jayega)\b|हाँ|हां|जी|ठीक",
    re.IGNORECASE,
)
_PRICE = re.compile(r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|hazaar|hazar|thousand|lakh|lac|हज़ार|हजार|लाख)?", re.IGNORECASE)


def _keyword_analysis(reply: str) -> Dict[str, Any]:
    """Deterministic fallback when the LLM is unavailable."""
    text = reply or ""
    said_no, said_yes = bool(_NO_WORDS.search(text)), bool(_YES_WORDS.search(text))
    decision = "NO" if said_no else "YES" if said_yes else "QUESTION" if "?" in text else "UNCLEAR"
    price = None
    for match in _PRICE.finditer(text):
        try:
            value = float(match.group(1).replace(",", ""))
        except ValueError:
            continue
        unit = (match.group(2) or "").lower()
        if unit in ("k", "hazaar", "hazar", "thousand", "हज़ार", "हजार"):
            value *= 1000
        elif unit in ("lakh", "lac", "लाख"):
            value *= 100000
        has_marker = bool(unit) or bool(re.match(r"\s*(₹|rs|inr)", match.group(0), re.IGNORECASE))
        looks_like_year = not has_marker and 1900 <= value <= 2100
        if value >= 100 and not looks_like_year:  # ignore dates, years, counts and other small numbers
            price = value
            break
    return {
        "decision": decision,
        "available": False if decision == "NO" and price is None else True if decision == "YES" else None,
        "quoted_price": price,
        "summary": "Keyword-based reading (AI analysis unavailable).",
        "language": None,
        "method": "KEYWORDS",
    }


def _normalize(raw: Dict[str, Any]) -> Dict[str, Any]:
    decision = str(raw.get("decision") or "UNCLEAR").upper()
    price = raw.get("quoted_price")
    try:
        price = float(price) if price not in (None, "") else None
    except (TypeError, ValueError):
        price = None
    available = raw.get("available")
    return {
        "decision": decision if decision in DECISIONS else "UNCLEAR",
        "available": available if isinstance(available, bool) else None,
        "quoted_price": price if price and price > 0 else None,
        "summary": str(raw.get("summary") or "")[:300],
        "language": (str(raw["language"])[:40] if raw.get("language") else None),
        "method": "AI",
    }


def _llm_analysis(reply: str, context: str) -> Optional[Dict[str, Any]]:
    api_key = settings.GEMINI_API_KEY or settings.LLM_API_KEY
    if not api_key:
        return None
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    for attempt in range(2):  # one retry: the model often returns a transient 503 under load
        try:
            response = client.models.generate_content(
                model=settings.LLM_MODEL,
                contents=ANALYSIS_PROMPT.format(context=context or "event vendor inquiry", reply=reply[:4000]),
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0),
            )
            data = json.loads(response.text or "{}")
            return _normalize(data) if isinstance(data, dict) else None
        except Exception as err:
            logger.warning("Vendor reply analysis via LLM failed (try %s): %s", attempt + 1, err)
            if attempt == 0:
                time.sleep(2)
    return None


def analyze_vendor_reply(
    reply: str,
    context: str = "",
    limits: Optional[Dict[str, Any]] = None,
    vendor_only_text: Optional[str] = None,
) -> Dict[str, Any]:
    """Classifies a vendor reply and, when a price was quoted, checks it against the server-side limits.

    `vendor_only_text` (e.g. just the vendor's lines of a call) is what the keyword fallback
    reads, so the agent's own words are never mistaken for the vendor's answer.
    """
    from app.services.vendor_outreach_service import evaluate_vendor_price

    result = _llm_analysis(reply, context) or _keyword_analysis(vendor_only_text if vendor_only_text is not None else reply)
    if result["quoted_price"] and limits and limits.get("max"):
        price_check = evaluate_vendor_price(limits, result["quoted_price"], 0)
        result["price_check"] = price_check["decision"]
        if price_check.get("counter_offer"):
            result["suggested_counter"] = price_check["counter_offer"]
    result["next_step"] = _next_step(result)
    return result


def _next_step(result: Dict[str, Any]) -> str:
    check = result.get("price_check")
    if check == "WITHIN_BUDGET":
        return "Price is within budget. Confirm the booking with the vendor."
    if check == "COUNTER":
        return f"Price is above target. Suggested counter-offer: {int(result['suggested_counter'])}."
    if check == "ABOVE_BUDGET":
        return "Price is above the budget. Negotiate further or consider another vendor."
    return {
        "YES": "Vendor is interested. Ask for their price and inclusions.",
        "NO": "Vendor declined. Consider another vendor.",
        "MAYBE": "Vendor is undecided. Follow up with the details they need.",
        "QUESTION": "Vendor asked a question. Reply to keep the conversation going.",
    }.get(result["decision"], "Reply was unclear. Follow up with the vendor.")


def transcript_text(transcript: List[Dict[str, Any]], speaker: Optional[str] = None) -> str:
    lines = [t for t in transcript or [] if t.get("text") and (speaker is None or t.get("speaker") == speaker)]
    if speaker:
        return "\n".join(t["text"] for t in lines)
    return "\n".join(f"{t.get('speaker')}: {t.get('text')}" for t in lines)


FOLLOWUP_PROMPT = """You write a short WhatsApp follow-up from an event organizer's assistant to a vendor.
Write in the SAME language and style the vendor used (Hinglish -> Hinglish, Hindi -> Hindi, English -> English).
Keep it to 1-3 short, polite sentences. Do not add a signature.

Rules:
- Never mention a budget, maximum, limit or ceiling, and never offer any amount except one given below.
- Never say the booking is confirmed; the organizer confirms bookings separately.
- Goal for this message: {goal}

Inquiry: {context}
What has happened so far:
{history}

Reply with the message text only."""


def followup_goal(analysis: Optional[Dict[str, Any]], verdict: Optional[Dict[str, Any]]) -> str:
    """What the next WhatsApp message should achieve, from the latest reply and call result."""
    analysis = analysis or {}
    code = (verdict or {}).get("code")
    if analysis.get("price_check") == "COUNTER" and analysis.get("suggested_counter"):
        return f"politely counter-offer {int(analysis['suggested_counter'])} rupees and ask if they can do it"
    if code == "AGREED" or analysis.get("price_check") == "WITHIN_BUDGET":
        return "thank them, restate the agreed price, ask exactly what it includes, and say the organizer will confirm shortly"
    if analysis.get("decision") == "YES" and not analysis.get("quoted_price"):
        return "thank them and ask for their total price and what it includes"
    if analysis.get("quoted_price"):
        return (f"thank them, note their price of {int(analysis['quoted_price'])} rupees, ask exactly what it includes, "
                "and say the organizer will get back to them")
    if analysis.get("decision") == "QUESTION":
        return "answer briefly that the organizer will share any details they need, and ask for their price and availability"
    if analysis.get("decision") == "NO" or code in ("DECLINED", "OVER_BUDGET", "NO_AGREEMENT"):
        return "thank them for their time and say the organizer may reach out again for future events"
    return "politely ask whether they are available and what their total price would be"


_FALLBACK_TEMPLATES = {
    "counter": "Thank you! For this event, could you do it for {counter} rupees?",
    "agreed": "Thank you! Noted the price of {price} rupees. Could you share exactly what it includes? The organizer will confirm shortly.",
    "ask_price": "Thank you for confirming! Could you share your total price and what it includes?",
    "close": "Thank you for your time. The organizer may reach out again for future events.",
    "default": "Hello, could you please confirm your availability and share your total price?",
}


def _fallback_followup(analysis: Dict[str, Any], verdict: Optional[Dict[str, Any]], agreed_price: Optional[float]) -> str:
    code = (verdict or {}).get("code")
    if analysis.get("price_check") == "COUNTER" and analysis.get("suggested_counter"):
        return _FALLBACK_TEMPLATES["counter"].format(counter=f"{int(analysis['suggested_counter']):,}")
    if (code == "AGREED" or analysis.get("price_check") == "WITHIN_BUDGET") and (agreed_price or analysis.get("quoted_price")):
        return _FALLBACK_TEMPLATES["agreed"].format(price=f"{int(agreed_price or analysis['quoted_price']):,}")
    if analysis.get("decision") == "YES":
        return _FALLBACK_TEMPLATES["ask_price"]
    if analysis.get("decision") == "NO" or code in ("DECLINED", "OVER_BUDGET", "NO_AGREEMENT"):
        return _FALLBACK_TEMPLATES["close"]
    return _FALLBACK_TEMPLATES["default"]


def draft_followup(
    context: str,
    history_lines: List[str],
    analysis: Optional[Dict[str, Any]],
    verdict: Optional[Dict[str, Any]],
    agreed_price: Optional[float] = None,
) -> Dict[str, Any]:
    """Drafts the next WhatsApp message for the organizer to review. It is never sent automatically."""
    analysis = analysis or {}
    goal = followup_goal(analysis, verdict)
    if agreed_price and (verdict or {}).get("code") == "AGREED":
        goal += f" (agreed price: {int(agreed_price)} rupees)"
    api_key = settings.GEMINI_API_KEY or settings.LLM_API_KEY
    if api_key:
        try:
            from google import genai
            from google.genai import types

            response = genai.Client(api_key=api_key).models.generate_content(
                model=settings.LLM_MODEL,
                contents=FOLLOWUP_PROMPT.format(goal=goal, context=context, history="\n".join(history_lines[-30:]) or "(nothing yet)"),
                config=types.GenerateContentConfig(temperature=0.3),
            )
            text = (response.text or "").strip().strip('"')
            if text:
                return {"text": text[:1000], "goal": goal, "method": "AI"}
        except Exception as err:
            logger.warning("Follow-up drafting via LLM failed, using a template: %s", err)
    return {"text": _fallback_followup(analysis, verdict, agreed_price), "goal": goal, "method": "TEMPLATE"}
