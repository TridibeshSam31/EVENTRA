# EVENTRA — Adaptive Event Operations Platform

> **PLAN THE EVENT. RUN THE EVENT. ADAPT WHEN REALITY CHANGES.**

EVENTRA is an Adaptive Event Operations platform engineered to manage live, complex events. Unlike static planning checklists, EVENTRA maintains a persistent, dependency-aware representation of the event and adapts dynamically when real-world disruptions (vendor delays, venue emergencies, resource shortages) occur.

---

## 1. Core Operational Loop

```text
PLAN
  ↓
RUN
  ↓
DETECT CHANGE
  ↓
UNDERSTAND
  ↓
IMPACT
  ↓
RISK
  ↓
RECOVER
  ↓
APPROVE
  ↓
ACT
  ↓
VERIFY
  ↓
UPDATED EVENT STATE
  ↺
```

---

## 2. Core Architectural Principle

> **"The deterministic engine calculates what is feasible.**  
> **The agent decides what should happen next."**

- **Backend (PostgreSQL + Domain Services):** The authoritative source of truth. Holds all state machines, invariants, and permissions.
- **Deterministic Engines:** Mathematical engines computing critical path DAGs, topological sort order, budget arithmetic, capacity constraints, and temporal feasibility.
- **Single Event Operations Agent:** An LLM-powered orchestrator (using LangGraph) that reasons through ambiguous trade-offs, evaluates strategic options, and coordinates execution via strongly typed tools.
- **Frontend (Next.js PWA):** Mobile-first operational control center organized around user workflows.

---

## 3. Repository Structure

```text
eventra/
├── .agents/                    # Persistent AI context layer & engineering memory
├── apps/
│   ├── web/                    # Next.js 14/15 PWA frontend (React, Tailwind CSS, shadcn/ui)
│   └── api/                    # FastAPI backend (SQLAlchemy, Pydantic, LangGraph)
├── packages/
│   ├── contracts/              # Shared TypeScript data models, schemas & enums
│   └── config/                 # Shared configurations (tsconfig, linting)
├── docs/
│   ├── architecture/           # System design & component boundaries
│   ├── api/                    # API route contracts and specifications
│   ├── product/                # MVP scope definitions & taxonomy
│   └── demo/                   # Simulation scenarios (Vendor No-Show, Venue, Shortage)
├── scripts/                    # Helper scripts (dev server, seeding, linting)
├── docker/
│   ├── postgres/               # PostgreSQL initialization script
│   └── nginx/                  # Reverse proxy configuration
├── docker-compose.yml          # Local containerized development stack
├── .env.example                # Environment variable templates
├── package.json                # Monorepo root workspace configuration
└── pnpm-workspace.yaml         # Monorepo package paths definition
```

---

## 4. Architectural Rules

1. **Backend is Source of Truth:** No authoritative event state resides in the frontend or agent memory.
2. **LLM Output is Probabilistic:** Never trust LLM arithmetic or dates without deterministic validation.
3. **Agent Decides, Deterministic Engines Calculate:** Prompts never compute critical paths or budget sums.
4. **All Integrations Isolated:** Google Maps, WhatsApp, and LLMs live strictly in `apps/api/app/integrations/`.
5. **Server-Side RBAC:** Access control and spending thresholds are validated on the backend.
6. **No Attendee Subsystem:** Guest count is strictly an aggregate scalar (`guest_count: int`) for capacity calculations.
7. **Authentic Simulation:** Demo simulations inject legitimate incident payloads; they never fake outputs.

---

## 5. Getting Started & Setup

### Prerequisites
- Node.js >= 20.0.0 & npm >= 10.0.0
- Python >= 3.11
- Docker & Docker Compose (optional, for containerized PostgreSQL)

### 1. Environment Configuration

Copy `.env.example` to `.env` in the root repository and customize for your environment:
```bash
cp .env.example .env
```

#### Real vs. Mock Operation Configuration
By default, the backend falls back to `MockCommunicationProvider` and logs a prominent warning on startup. To enable real integrations:

| Component | Required Environment Variables | Notes |
| :--- | :--- | :--- |
| **WhatsApp (OpenWA)** | `COMMUNICATION_PROVIDER=openwa`<br>`OPENWA_ENABLED=true`<br>`OPENWA_BASE_URL=http://localhost:2785`<br>`OPENWA_API_KEY=your_key`<br>`OPENWA_SESSION_ID=eventra_ops` | Requires running OpenWA container (`docker-compose up -d openwa`) and scanning QR code. |
| **AI Voice Telephony (Exotel + Gemini)** | `COMMUNICATION_PROVIDER=exotel`<br>`EXOTEL_ENABLED=true`<br>`EXOTEL_ACCOUNT_SID=...`<br>`EXOTEL_API_KEY=...`<br>`EXOTEL_API_TOKEN=...`<br>`EXOTEL_CALLER_ID=...`<br>`EXOTEL_STREAM_URL=wss://<tunnel>/api/v1/voice/exotel/stream`<br>`GEMINI_API_KEY=...` | Must provide a public `wss://` endpoint (e.g. ngrok tunnel) for audio streaming. Requires KYC compliance on Exotel. |
| **Real Provider Discovery** | Network access to OpenStreetMap Overpass API or `APIFY_API_KEY` for Google Maps | Vendor discovery uses `GoogleMapsScraperAdapter`. |

### 2. Services Setup (Docker)

Start PostgreSQL and the OpenWA WhatsApp Automate container:
```bash
docker-compose up -d postgres openwa
```

#### WhatsApp QR Linking Flow (First-Time Setup)
1. Ensure the `openwa` container is running: `docker-compose ps openwa`
2. Navigate to `http://localhost:2785` in your browser (or check container logs: `docker-compose logs -f openwa`).
3. Scan the generated QR code using WhatsApp on your phone (**Linked Devices → Link a Device**).
4. Once authenticated, session state is preserved inside the `openwa_sessions` named Docker volume across restarts.
5. Verify messaging with `python apps/api/scripts/test_whatsapp_send.py --to 919XXXXXXXXX --message "Hello from EVENTRA"`.

### 3. Exotel Voice & Gemini Live Telephony Bridge Setup

For AI phone calls to vendors via Exotel and Gemini Live:
1. Start local dev tunnel for Exotel to reach your local backend:
   - On Linux/macOS: `./scripts/dev_tunnel.sh 8000`
   - On Windows (PowerShell): `.\scripts\dev_tunnel.ps1 -Port 8000`
2. Copy the printed `wss://.../api/v1/voice/exotel/stream` URL and set it as `EXOTEL_STREAM_URL` in your `.env`.
3. Note: The Exotel account must be KYC-verified in the Exotel dashboard to dial real PSTN phone numbers.

### 4. Backend Setup
```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
On startup, watch the console banner for **EVENTRA INTEGRATION ADAPTER RESOLUTION** to confirm whether adapters resolved to `REAL` or `MOCK`.

### 5. Frontend Setup
```bash
# In workspace root
npm install
npm run dev --workspace=apps/web
```

---

## 6. MVP Implementation Sequence (20 Phases)

```text
01. Database Model                     11. Risk Engine
02. Event Setup                        12. Recovery Engine
03. Event Specification                13. Agent (Single Operations Agent)
04. Venue / Location Discovery         14. Collaboration + Approval/RBAC
05. Provider Network & Assignments     15. Action + Autonomy Policy
06. Planning Engine                    16. Verification
07. Dependency Engine (DAG)            17. PWA / UI Workflows
08. Live State Engine                  18. Notifications & Integrations
09. Incident Engine                    19. Analytics & Audit
10. Impact Engine (Blast Radius)       20. Simulation / Demo Hardening
```
