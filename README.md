# EVENTRA — Adaptive Event Operations Platform

<div align="center">

```
  ███████╗██╗   ██╗███████╗███╗   ██╗████████╗██████╗  █████╗ 
  ██╔════╝██║   ██║██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗
  █████╗  ██║   ██║█████╗  ██╔██╗ ██║   ██║   ██████╔╝███████║
  ██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗██╔══██║
  ███████╗ ╚████╔╝ ███████╗██║ ╚████║   ██║   ██║  ██║██║  ██║
  ╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝
```

### **Plan the event. Run the event. Adapt when reality changes.**

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Agent_Orchestration-FF6F00?style=for-the-badge&logo=langchain&logoColor=white)](https://langchain-ai.github.io/langgraph/)
[![Google Gemini Live](https://img.shields.io/badge/Gemini_Live-Multimodal_Telephony-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_Alpine-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose_Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

</div>

---

## 📌 Executive Summary

**EVENTRA** is an enterprise-grade **Adaptive Event Operations Platform** engineered to manage high-stakes, live events under chaotic real-world conditions. 

Unlike traditional event management suites (like Cvent) or project management boards (Trello, Notion, Asana) that treat plans as **static checklists**, EVENTRA maintains a **living, dependency-aware representation of the event**. 

When real-world disruptions strike—such as vendor no-shows, severe weather, power outages, or supply deficits—EVENTRA automatically:
1. **Detects** the deviation via telemetry, IoT, or coordinator alerts.
2. **Computes the blast radius** across the temporal dependency graph (DAG) and critical path.
3. **Synthesizes mathematically feasible recovery plans** (alternative vendors, timeline compression, scope adjustments).
4. **Negotiates and executes verified solutions** via autonomous AI voice calling (Gemini Live + Twilio/Exotel) and WhatsApp (OpenWA).
5. **Enforces human-in-the-loop governance** through strict role-based access control (RBAC) and budget guardrails.

---

## 🔁 The Closed-Loop Operational Cycle

Every event state transition, sensor trigger, or human notification passes through EVENTRA's continuous 11-step operational loop:

```mermaid
flowchart TD
    A([1. PLAN]) --> B([2. RUN])
    B --> C{3. DETECT CHANGE}
    C -->|Telemetry / Alert / Inbound| D[4. UNDERSTAND]
    D --> E[5. IMPACT & BLAST RADIUS]
    E --> F[6. RISK EVALUATION]
    F --> G[7. RECOVERY SYNTHESIS]
    G --> H{8. APPROVE}
    H -->|Within Budget / Pre-authorized| I[9. ACT & EXECUTE]
    H -->|Exceeds Threshold / Scope Shift| J[Human Sign-Off / Escalation]
    J -->|Approved| I
    J -->|Rejected| G
    I --> K[10. VERIFY & AUDIT]
    K --> L[11. UPDATED EVENT STATE]
    L --> B
```

---

## 🏛️ Core Architectural Principle

> ### *"The deterministic engine calculates what is feasible.*  
> ### *The AI agent decides what should happen next."*

EVENTRA eliminates AI hallucinations in critical operations by strictly bifurcating reasoning from computation:

| Domain | Layer / Responsibility | Guarantees |
| :--- | :--- | :--- |
| **Authoritative State** | **PostgreSQL 16 + Domain Services** | Acid-compliant single source of truth. Holds all state machines, invariants, and permission matrices. |
| **Deterministic Engines** | **Mathematical Engines (`apps/api/app/engines/`)** | Zero LLM guessing: Computes critical-path DAGs, topological sorting, temporal feasibility, spatial capacity, and budget arithmetic. |
| **Reasoning & Orchestration** | **Single Operations Agent (LangGraph)** | Evaluates ambiguous trade-offs, coordinates multi-step negotiations, selects recovery strategies, and invokes typed tools. |
| **Real-World Integration** | **Boundary Isolation Layer (`apps/api/app/integrations/`)** | Dedicated adapters for Gemini Multimodal Live, Twilio/Exotel Telephony, OpenWA WhatsApp, and Google Maps Scraper. |
| **Control Surface** | **Next.js 14 Progressive Web App (`apps/web/`)** | Mobile-first real-time operational cockpit, interactive venue floor plans, Gantt schedules, and approval dispatchers. |

---

## 🚫 What EVENTRA Is NOT

To maintain laser focus on operational resilience, EVENTRA strictly defines its anti-goals:
- ❌ **NOT an ungrounded Chatbot:** No free-form unvalidated text; all actions pass through validated Pydantic schemas.
- ❌ **NOT an Attendee/Ticketing App:** No QR ticket scanning, badge printing, or RSVP tracking. Attendee counts are strictly treated as a scalar input (`guest_count: int`) for spatial and catering sizing.
- ❌ **NOT a Consumer Marketplace:** No public bidding or merchant ad platforms.
- ❌ **NOT an Autonomous Payment Bot:** The agent never executes unilateral bank transfers or credit card payments; it issues validated procurement intents for human approval.

---

## ✨ Key Platform Features

### 1. 🎛️ Live Operations Cockpit & Telemetry
- **Dynamic Event Health Score:** Real-time composite health index computed from timeline drift, unresolved risks, and vendor check-ins.
- **WebSocket Telemetry Stream:** Instantaneous state propagation across all coordinators with zero polling.
- **Interactive Venue Canvas:** Floor plan mapping, capacity tracking, zone allocations, and egress monitoring via Leaflet & React Simple Maps.

### 2. ⚡ Deterministic Dependency Graph (DAG) & Blast Radius Engine
- **Topological Sorting & Critical Path:** Instant identification of zero-slack bottleneck tasks.
- **Cascade Impact Analysis:** When a task slips, the engine computes downstream impacts across time, vendor availability, and dependent setups before failure cascades.
- **Spatial Feasibility Checking:** Validates floor plan dimensions, ingress/egress, and acoustic interference constraints.

### 3. 🤖 Single Operations Agent (LangGraph + 20+ Tools)
- Powered by Google Gemini 1.5/2.0/3.x models with LangGraph state graphs.
- Equipped with strongly-typed tools across 7 operational domains:
  - `ProviderTools`: Real-time discovery, qualification, capability matching, and task binding.
  - `CommunicationTools`: Automated outbound inquiries, counter-offer handling, and timeline confirmations.
  - `RecoveryTools`: Autonomous generation, simulation, and validation of contingency options.
  - `PlanningTools`: Dynamic milestone compilation and schedule adjustment.
  - `ApprovalTools`: Policy-gated escalation tickets for human intervention.

### 4. 📞 Multimodal AI Voice Telephony & WhatsApp Gateway
- **Real-Time Voice Streaming:** Bidirectional audio streaming between Gemini Live (`wss://`) and PSTN telecommunication providers (**Twilio** / **Exotel**).
- **Autonomous Vendor Phone Calls:** The AI can pick up the phone, dial a backup vendor, explain the emergency requirement, negotiate prices within budget caps, confirm arrival ETAs, and transcribe the audio call into an auditable outcome.
- **Self-Hosted WhatsApp Gateway:** Integrated OpenWA Docker container for automated WhatsApp notifications, vendor checks, and coordinator confirmations.

### 5. 🛡️ Policy-Gated Autonomy & Human-in-the-Loop RBAC
- **Configurable Autonomy Tiers:**
  - *Tier 1 (Autonomous):* Minor schedule shifts (<15 min) or budget variance within pre-approved emergency reserves.
  - *Tier 2 (Gated Approval):* Critical-path timeline changes, vendor contract reassignments, or budget threshold breaches require coordinator approval.
  - *Tier 3 (Locked Invariant):* Life-safety, maximum physical venue capacity, and legal requirements can never be overridden by AI.
- **Immutable Audit Trail:** Complete tamper-evident record of all AI decisions, coordinator overrides, and state changes.

### 6. 📲 Remote Approval Notifications (Zero-Laptop Mobile Operations)
When the operations agent requires human approval, event organizers are notified instantly on mobile and can authorize or reject decisions on the go without sitting at a laptop:

- **Multi-Channel Notification Fanout:** Fault-isolated delivery across **In-App Notification Ledger**, **WhatsApp (OpenWA)**, and **Web Push (VAPID / Service Worker)**.
- **Two-Way WhatsApp Approval:**
  - Real-time messages with impact tier (`CRITICAL`, `MAJOR`, `MINOR`), cost delta, and a unique 4-character reply code (e.g. `YES K9P2`, `NO K9P2`).
  - Supports English and Hindi/Hinglish reply intents (`yes`, `no`, `approve`, `reject`, `haan`, `nahi`, `theek hai`, `krdo`, `mat karo`).
  - Inbound webhook verifies OpenWA HMAC signatures fail-closed, tracks message IDs for idempotency, verifies real approver eligibility and state freshness (`STALE` guard), and falls back seamlessly to vendor negotiation for non-organizer numbers.
- **Signed One-Tap Deep Links:**
  - HMAC-SHA256 signed URLs (`/events/{eventId}/approvals/{approvalId}?token=...`) with 2-hour TTL.
  - Enables authorized organizers to securely review full diffs, cost impacts, and blast radius on mobile browsers and submit decisions directly.
- **Web Push Progressive Web App (PWA):**
  - Instant push notifications delivered to phones even when browser tabs are closed.
  - Interactive notification click-throughs navigate straight to the relevant approval request.
- **Automated Expiry, Sweeper & Escalation:**
  - Strict TTLs enforced per impact tier (`CRITICAL`: 15 min, `MAJOR`: 30 min, `MINOR`: 60 min, `LOW`: suppressed from outbound push/SMS).
  - Approvals **never auto-approve** on timeout; expired approvals transition to `EXPIRED` and trigger the agent to replan alternatives.
  - Background sweeper sweeps pending approvals every 30s: dispatches reminders at 50% TTL, escalates to the Main Organizer at 75% TTL, and can trigger an urgent voice call for `CRITICAL` approvals.

### 7. 🧪 Authentic Simulation Lab
- Injects non-mocked, legitimate incident payloads to test system resilience:
  1. **Vendor No-Show:** Critical catering/AV supplier cancels 2 hours before curtain; engine calculates impact, locates backup vendors via OSM/Google Maps, negotiates rates via voice/WhatsApp, and routes approval.
  2. **Venue Emergency:** Downpour or electrical fault renders outdoor stage unusable; system calculates spatial delta, checks indoor hall capacity, shifts timeline, and alerts stakeholders.
  3. **Resource Shortage:** Missing 150 chairs; autonomous calculation of local rental options, courier dispatch, and arrival verification.

---

## 📂 Repository Architecture

```text
EVENTRA/
├── apps/
│   ├── api/                            # FastAPI Backend (Domain Services & Engines)
│   │   ├── app/
│   │   │   ├── agent/                  # LangGraph Event Operations Agent & 20+ Tools
│   │   │   ├── analytics/              # Post-event KPI, budget variance & recovery metrics
│   │   │   ├── api/routes/             # Resource-oriented REST & WebSocket endpoints
│   │   │   ├── collaboration/          # Team roles, permissions & live collaboration
│   │   │   ├── core/                   # Security, settings, and logging configuration
│   │   │   ├── db/                     # SQLAlchemy models, sessions & migrations
│   │   │   ├── domains/                # Core business logic & state machines
│   │   │   ├── engines/                # Deterministic DAG, Budget, Risk, Recovery & State
│   │   │   ├── integrations/           # Gemini Live, Twilio, Exotel, OpenWA, Google Maps
│   │   │   ├── models/                 # Authoritative database entity schemas
│   │   │   ├── schemas/                # Inbound/outbound Pydantic validation contracts
│   │   │   ├── seeds/                  # Baseline seed datasets & synthetic venues
│   │   │   ├── services/               # Transactional domain services
│   │   │   └── simulation/             # Authentic scenario runner & fault injection
│   │   ├── tests/                      # Pytest unit, integration & scenario suites
│   │   └── requirements.txt            # Python dependencies
│   │
│   └── web/                            # Next.js 14 PWA Operational Dashboard
│       ├── app/
│       │   ├── (app)/events/[eventId]/ # Event-specific operational sub-modules
│       │   │   ├── activity/           # Real-time event activity feed
│       │   │   ├── analytics/          # KPI dashboards & operational telemetry
│       │   │   ├── approvals/          # Pending human-in-the-loop approval tickets
│       │   │   ├── audit/              # Immutable audit trail
│       │   │   ├── budget/             # Budget allocation, commitments & variance
│       │   │   ├── incidents/          # Incident command center & blast radius view
│       │   │   ├── live/               # Live operational cockpit
│       │   │   ├── recovery/           # Alternative plan comparison & execution
│       │   │   ├── schedule/           # Gantt view & critical-path timeline
│       │   │   ├── tasks/              # Dependency-linked task management
│       │   │   ├── vendors/            # Vendor catalog, communications & assignments
│       │   │   └── venue/              # Interactive spatial map & layout management
│       │   ├── layout.tsx              # Root app layout & theme provider
│       │   └── globals.css             # Tailwind design tokens & dark-mode styling
│       ├── components/                 # Reusable UI components (shadcn/ui, maps, forms)
│       └── package.json                # Frontend dependencies
│
├── packages/
│   ├── contracts/                      # Shared TypeScript types, schemas & enums
│   └── config/                         # Unified ESLint, Prettier & TypeScript configs
│
├── docker/
│   ├── postgres/                       # Postgres 16 init scripts & schemas
│   └── nginx/                          # Reverse proxy configuration
│
├── docs/                               # Architecture, API specifications & guides
│   ├── architecture/                   # System design & structural zones
│   ├── api/                            # Route contracts & endpoint documentation
│   ├── demo/                           # Simulation walkthroughs
│   └── voice_integration/              # Telephony audio streaming & KYC details
│
├── scripts/                            # Operational helper scripts
│   ├── dev_tunnel.ps1                  # PowerShell script to spin up WebSocket tunnel for voice
│   ├── dev_tunnel.sh                   # Bash script to spin up WebSocket tunnel for voice
│   ├── seed.sh                         # Seed database with demo venues and vendors
│   └── audit_frontend_pages.py         # Frontend route & component validation
│
├── tools/
│   └── openwa/                         # WhatsApp automate container configuration
│
├── docker-compose.yml                  # Complete local containerized stack
├── .env.example                        # Comprehensive environment template
├── package.json                        # Root npm monorepo configuration
└── pnpm-workspace.yaml                 # Monorepo workspace configuration
```

---

## 🛠️ Tech Stack & Integrations

| Domain | Technology / Library | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | **Next.js 14 (App Router, PWA)** | Mobile-first event operations cockpit |
| **Frontend Styling** | **Tailwind CSS + shadcn/ui + Framer Motion** | Dark-mode interface, micro-animations, glassmorphic HUD |
| **Maps & Geo** | **Leaflet + React Simple Maps** | Venue floor plans, geospatial vendor tracking |
| **Backend Framework** | **FastAPI (Python 3.11+)** | High-performance asynchronous API & WebSockets |
| **AI Orchestration** | **LangGraph + LangChain Core** | Stateful agent graph, tool dispatch, decision loops |
| **AI Telephony & Voice** | **Gemini Live Multimodal (`gemini-3.8-live`)** | Bidirectional low-latency audio streaming for vendor calls |
| **Telephony Carriers** | **Twilio & Exotel** | Outbound PSTN calling with WebSocket media streams |
| **Messaging** | **OpenWA (Automate)** | Headless WhatsApp container for automated chats |
| **Database & ORM** | **PostgreSQL 16 + SQLAlchemy 2.0 + Alembic** | Authoritative relational state machine & migrations |
| **Validation** | **Pydantic v2 & TypeScript Contracts** | End-to-end typed contracts between Python and Next.js |
| **Containerization** | **Docker & Docker Compose** | Local orchestration for DB, Web, API, and Gateways |

---

## 🚀 Getting Started & Local Setup

### Prerequisites
- **Node.js**: `>= 20.0.0`
- **npm**: `>= 10.0.0`
- **Python**: `>= 3.11`
- **Docker & Docker Compose**: Installed and running

---

### Step 1: Clone & Configure Environment

```bash
# Clone the repository
git clone https://github.com/TridibeshSam31/EVENTRA.git
cd EVENTRA

# Copy the environment template
cp .env.example .env
```

Open `.env` and fill in your keys. Below are the key configuration options:

```dotenv
# Core Database
DATABASE_URL=postgresql://eventra_user:eventra_password@localhost:5432/eventra_db

# AI / LLM Configuration
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
LLM_MODEL=gemini-3.6-flash
GEMINI_LIVE_MODEL=gemini-3.8-live

# Communication Mode (Options: mock, openwa, twilio, exotel)
COMMUNICATION_PROVIDER=mock
```

> [!NOTE]
> By default, `COMMUNICATION_PROVIDER=mock`. The platform will run fully locally using mock communication without requiring active Twilio, Exotel, or WhatsApp accounts.

---

### Step 2: Start Infrastructure (Docker)

Start the PostgreSQL database and OpenWA container:

```bash
docker-compose up -d postgres
```

*(Optional: To run the entire stack via Docker including the frontend, API, OpenWA, and Scraper, run `docker-compose up -d`)*

---

### Step 3: Backend Setup (FastAPI)

```bash
# Navigate to the API application
cd apps/api

# Create and activate virtual environment
python -m venv .venv

# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run migrations and seed baseline venues and vendors
python -m app.seeds.seed_runner

# Launch the FastAPI dev server
uvicorn app.main:app --reload --port 8000
```

The backend will start at **`http://localhost:8000`**.  
Interactive Swagger documentation is available at **`http://localhost:8000/docs`**.

---

### Step 4: Frontend Setup (Next.js PWA)

In a new terminal window at the repository root:

```bash
# Install root and workspace dependencies
npm install

# Start the Next.js development server
npm run dev:web
```

The frontend will be accessible at **`http://localhost:3000`**.

---

## 📡 Live Telephony & WhatsApp Configuration (Real Mode)

To enable real-world vendor calling and WhatsApp messaging:

### 1. WhatsApp Integration (OpenWA)
1. Start the OpenWA service: `docker-compose up -d openwa`
2. Open `http://localhost:2785` in your browser.
3. Link your WhatsApp device by scanning the generated QR code (**WhatsApp → Linked Devices → Link a Device**).
4. Update your `.env`:
   ```dotenv
   COMMUNICATION_PROVIDER=openwa
   OPENWA_ENABLED=true
   OPENWA_BASE_URL=http://localhost:2785
   OPENWA_SESSION_ID=eventra_ops
   ```
5. Test delivery:
   ```bash
   python apps/api/scripts/test_whatsapp_send.py --to 91XXXXXXXXXX --message "EVENTRA live check-in"
   ```

### 2. Autonomous AI Voice Telephony (Twilio / Exotel + Gemini Live)
The agent streams raw bidirectional audio to live telephone networks using Gemini Live:

1. **Start the local tunnel** for PSTN carrier webhooks:
   - On Windows: `.\scripts\dev_tunnel.ps1 -Port 8000`
   - On Linux/macOS: `./scripts/dev_tunnel.sh 8000`
2. Copy the generated `wss://...` URL.
3. **Configure Twilio (Recommended for Hackathons / Demos):**
   ```dotenv
   COMMUNICATION_PROVIDER=twilio
   TWILIO_ENABLED=true
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_CALLER_NUMBER=+1XXXXXXXXXX
   TWILIO_STREAM_URL=wss://<your-tunnel-subdomain>/voice/twilio/stream
   ```
4. **Or Configure Exotel (India PSTN direct):**
   ```dotenv
   COMMUNICATION_PROVIDER=exotel
   EXOTEL_ENABLED=true
   EXOTEL_ACCOUNT_SID=your_sid
   EXOTEL_API_KEY=your_key
   EXOTEL_API_TOKEN=your_token
   EXOTEL_CALLER_ID=your_exotel_virtual_number
   EXOTEL_STREAM_URL=wss://<your-tunnel-subdomain>/api/v1/voice/exotel/stream
   ```

### 3. Web Push Notifications (VAPID)
1. Generate VAPID key pair (or use existing):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Configure `.env`:
   ```dotenv
   VAPID_PUBLIC_KEY=your_vapid_public_key
   VAPID_PRIVATE_KEY=your_vapid_private_key
   VAPID_CLAIM_EMAIL=mailto:admin@eventra.local
   APPROVAL_DEEP_LINK_SECRET=your_secure_random_key_min_32_chars
   APPROVAL_EXPIRY_SWEEPER_ENABLED=true
   ```

### 4. Configuration Matrix (Out-of-the-Box vs Real Credentials)
| Capability | `COMMUNICATION_PROVIDER=mock` (Default) | Real Credentials Required |
| :--- | :--- | :--- |
| **In-App Approvals & Ledger** | Works out of the box (Local DB) | None |
| **Signed Deep Link Review** | Works out of the box (`APPROVAL_DEEP_LINK_SECRET`) | None (uses local secret) |
| **WhatsApp Notifications & Replies** | Dispatches to memory log; simulated inbound webhook | OpenWA Docker container (`OPENWA_*`) |
| **Web Push Notifications** | In-memory push adapter (simulated) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `pywebpush` |
| **AI Voice Telephony & Escalation** | Mock call dispatch | Twilio or Exotel credentials + Public Tunnel |
| **Approval Expiry & Escalation Sweeper** | Background asyncio loop runs every 30s | None |

---

## 🎮 Simulation & Demo Scenarios

EVENTRA includes authentic failure-mode scenarios that test the end-to-end recovery pipeline under realistic conditions:

```bash
# Trigger an authentic Vendor No-Show simulation via the API
curl -X POST http://localhost:8000/api/simulation/scenarios/vendor-no-show \
  -H "Content-Type: application/json" \
  -d '{"event_id": "demo-summit-2026", "vendor_category": "catering"}'
```

| Scenario | Injected Condition | Engine Response | Agent Action |
| :--- | :--- | :--- | :--- |
| **1. Vendor No-Show** | Anchor AV / Catering supplier fails to check in 120 min before start. | Recalculates DAG critical path; detects 4 downstream task blocks; flags threat level **HIGH**. | Discovers top 3 nearby vetted suppliers; places automated phone call to check availability; issues approval ticket to coordinator. |
| **2. Venue Emergency** | Heavy rain / physical fault closes primary outdoor pavilion. | Evaluates covered zones; recalculates spatial guest capacity and power requirements. | Identifies adjacent indoor ballroom; compresses setup schedule; reroutes logistics team. |
| **3. Resource Shortage** | Delivery receipt shows 200 chairs damaged on arrival. | Computes capacity delta; validates reserve budget tolerance. | Finds closest commercial rental store; dispatches courier order; verifies dispatch notice. |

---

## 🔌 API Endpoints Reference

All API endpoints are mounted under `/api` and enforce event-scoped authentication:

```text
GET/POST    /api/events              Event lifecycle state machine (Draft, Planned, Live, Concluded)
GET/POST    /api/setup               Specification, requirements, goals & constraints
GET/POST    /api/venues              Location discovery, spatial capacity & zone layout
GET/POST    /api/vendors             Provider catalog, capability search & assignments
GET/POST    /api/planning            Work breakdown structures & milestone baselines
GET/PUT     /api/tasks               Task dependency tracking & status progression
GET         /api/schedule            Gantt timeline & critical-path calculations
GET/POST    /api/budget              Line-item allocations, commitments & variance tracking
GET/WS      /api/live                Real-time telemetry, active trackers & health metrics
POST        /api/incidents           Incident intake, severity evaluation & blast radius
GET         /api/impact              Graph traversal & cascade impact assessments
GET         /api/risk                Composite risk calculations & threat levels
GET/POST    /api/recovery            Autonomous recovery options & feasibility simulation
GET/PUT     /api/approvals           Pending human-in-the-loop authorization tickets
GET/POST    /api/procurement         Emergency supply manifests & replacement purchase orders
GET/POST    /api/notifications       Coordinator alert broadcasts & push notifications
GET/POST    /api/collaborators       RBAC permission matrix & access tokens
GET         /api/analytics           Post-event operational KPIs & recovery efficiency
GET         /api/audit               Immutable audit trail & state transition ledger
POST        /api/simulation          Authentic incident injection harness
```

---

## 🧪 Testing & Quality Assurance

EVENTRA incorporates comprehensive unit, integration, and scenario tests:

```bash
# Run backend test suite
cd apps/api
pytest -v

# Run specific engine and agent tests
pytest tests/unit/agent/ -v
pytest tests/scenarios/ -v

# Run frontend lint and type checking
cd ../..
npm run lint --workspace=apps/web
npm run typecheck --workspace=apps/web
```

---

## 📄 Monorepo NPM Scripts

From the repository root, you can run:

```bash
npm run dev          # Start web frontend in development mode
npm run dev:api      # Start FastAPI backend server with hot-reload
npm run build        # Build all packages and applications for production
npm run lint         # Run ESLint across all workspaces
npm run typecheck    # Validate TypeScript types across contracts and web
npm run test         # Run all tests across workspaces
```

---

## 🔒 Security & Governance

1. **Server-Side Enforcement:** All authorizations, spend ceilings, and state mutations are validated in the Python domain services—never trusted from frontend clients.
2. **Encrypted Credentials:** API keys, telephony secrets, and webhook signatures are loaded strictly from environment variables or secure key vaults.
3. **Auditability:** Every tool invocation, agent proposal, and coordinator override produces an immutable audit record with timestamps, initiator IDs, and cryptographic hashes.

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<div align="center">

**Built for mission-critical operations where failure is not an option.**

*EVENTRA — Plan the event. Run the event. Adapt when reality changes.*

</div>
