# NextStep Service — Technology Reference

> Comprehensive reference distilled from the Final Project Definition.
> For use in all future implementation iterations of the NextStep-Service backend.

---

## 1. Project Overview

**NextStep** is a personalized financial guidance system for young adults (18–28).
It connects to bank data via **Open Finance APIs** (Israeli Open Banking standard), analyzes the user's financial state using **Python/Pandas** pre-processing + **Google Gemini 1.5 Flash** AI, and generates a step-by-step roadmap based on the **Financial Hierarchy of Needs** (5 stages).

The system applies three behavioral economics concepts:
- **Financial Hierarchy of Needs** — 5-stage progression model (see §5)
- **Nudge Theory** — breaking goals into micro-tasks to reduce intimidation
- **Prospect Theory / Loss Aversion** — showing "cost of inaction" alerts to motivate users

**Repos:**
- Client: https://github.com/carmelsagy13/NextStep-Client (React)
- Service: https://github.com/carmelsagy13/NextStep-Service (NestJS)
- Project Board: https://github.com/users/carmelsagy13/projects/1

**Team (Group 202):**
- Carmel Sagy — product manager, content & UI
- Amit Dahan — product manager, tech lead & system dev
- Dani Shevchenko — dev lead engineer & research
- Nogga Ovadya — QA, content governance, regulatory compliance
- Paz Ben Arohe — dev lead & AI lead

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | NestJS (Node.js, TypeScript) |
| **Client** | React |
| **Database** | PostgreSQL |
| **ORM** | TypeORM (with @nestjs/typeorm) |
| **AI / LLM** | Google Gemini 1.5 Flash |
| **Data Processing** | Python + Pandas (pre-processing pipeline) |
| **Banking Integration** | Open Finance API (Israeli Open Banking, https://www.open-finance.co.il) |
| **Auth** | JWT access tokens (passport-jwt) |
| **Validation** | class-validator + class-transformer |
| **API Docs** | Swagger (@nestjs/swagger) |
| **Notifications** | Push notifications (scheduled via @nestjs/schedule + trigger-based) |
| **HTTP Client** | Axios (for Open Finance & Gemini API calls) |
| **Scrum** | GitHub Projects |

---

## 3. Functional Requirements Summary

### 3.1 Core Requirements
1. Collect personal & financial data from user bank accounts via Open Finance
2. Analyze user's financial situation
3. Calculate user's current financial position on the hierarchy
4. Present a questionnaire for obligations (rent, tuition) and goals (trip, car)
5. Generate a personalized financial roadmap
6. Present next actionable steps as sub-goals (user can personalize)
7. Provide data, explanations, and general info about financial options
8. Send push notifications with reminders and summaries
9. Detect significant financial actions → advance roadmap → notify user

### 3.2 Onboarding Flow (2-step)
**Step 1 — Consent & Data Integration:**
- User grants consent → system retrieves via Open Finance API:
  - Bank account metadata
  - Real-time account balances
  - Historical transactions (up to 24 months)
  - Recurring income identification
- Must comply with GDPR + Israeli privacy regulations
- Maintain consent audit log

**Step 2 — Profile & Goals Questionnaire:**
- User provides: existing assets, liabilities, long-term objectives
- System validates mandatory fields, logical consistency
- AI classifies user into a "Financial Maturity Stage" using liquidity ratios, debt-to-income
- System generates structured roadmap: current baseline → strategic milestones → future outlook

### 3.3 Ongoing Engagement
- **Push notifications:** progress tracking, behavioral encouragement
- **Login sync:** auto data refresh on each session (Open Finance API)
- **Goal status visualization:** current vs. target side-by-side
- **Loss aversion alerts:** "By not moving to X, you lose ~Y/month"
- **Knowledge Hub:** non-advisory financial data bank (regulatory constraint — no investment advice)

### 3.4 Usage Scenarios
1. **First-time onboarding** — register → consent → data retrieval → financial overview
2. **Goals & roadmap creation** — questionnaire → AI analysis → personalized roadmap with mini-goals
3. **Action detection** — user deposits money → system detects → updates progress → new goals
4. **Routine use** — login → data sync → status summary → notifications → next steps

---

## 4. NestJS Server Modules

### 4.1 Auth Module
**Purpose:** User registration, login, logout, access token management.
| Endpoint | Method | Description |
|---|---|---|
| `/auth/register` | POST | Validate input (email, password, profile fields), create user in DB, return `{ accessToken, userId }` |
| `/auth/login` | POST | Validate credentials, return `{ accessToken, userId }` |
| `/auth/logout` | POST | Revoke access token, return success/failure |

### 4.2 User Profile & Questionnaire Module
**Purpose:** Store user-provided personal inputs — questionnaire answers, preferences, goals. Track onboarding state.
| Endpoint | Method | Description |
|---|---|---|
| `/questionnaire` | POST | Validate and store onboarding questionnaire answers |
| `/profile/notificationPreferences` | POST | Save notification settings (e.g., quiet hours) |
- Inputs feed into: Roadmap Generation + Notification Service

### 4.3 OpenFinance Integration Module
**Purpose:** Redirect-based consent flow, secure token storage, bank data fetching.
| Endpoint | Method | Description |
|---|---|---|
| `/openfinance/connect` | POST | Create consent record in DB, call Open Finance to get consent URL, return `{ consentUrl }` |
| `/openfinance/callback` | GET | Handle redirect, exchange auth code for tokens, store encrypted tokens, mark consent complete |
| `/openfinance/sync` | POST | Fetch latest transactions (optional date range), update DB, return sync summary |
- **Critical rule:** Raw transactions are NEVER stored — only computed indicators/events
- After sync completes, triggers Event Detection module internally

### 4.4 Financial Analysis Module
**Purpose:** Calculation layer converting Open Finance data into aggregate indicators.
| Endpoint | Method | Description |
|---|---|---|
| `/finance/snapshot` | GET | Compute and return financial metrics |
- **Computed metrics:** monthly income estimate, monthly expenses estimate, total savings, total debt, liquidity ratio, debt-to-income ratio
- Reads from: latest sync results + financial indicators stored in DB

### 4.5 Progress Tracking & Event Detection Module
**Purpose:** Detect significant financial actions after new transaction data, update progress state.
| Endpoint | Method | Description |
|---|---|---|
| `/events` | GET | Return recent detected events for client display |
- **Trigger:** Runs automatically after `POST /openfinance/sync`
- Compares new transactions since last sync
- Detects events: salary deposit, large expense, goal milestone reached
- Writes detected events to DB, updates progress state if needed

### 4.6 Roadmap Generation Module
**Purpose:** Convert user metrics and goals into a structured roadmap.
| Endpoint | Method | Description |
|---|---|---|
| `/roadmap` | GET | Return current roadmap, progress %, and goals |
| `/roadmap` | POST | Store updated roadmap state in DB |
- **Internally reads:** financial snapshots, questionnaire answers, user goals
- Uses LLM Orchestrator output to structure the roadmap

### 4.7 Goal Module
**Purpose:** Manage user-defined goals and progress.
| Endpoint | Method | Description |
|---|---|---|
| `/goals` | GET | Return goals list with progress |
| `/goals` | POST | Create new goal in DB |
| `/goals/update` | POST | Update goal by `goalId` |
| `/goals/delete` | POST | Delete goal by `goalId` |

### 4.8 Notification Module
**Purpose:** Generate notifications based on recent activity and user preferences.
| Endpoint | Method | Description |
|---|---|---|
| `/notifications` | GET | Return all user notifications |
| `/profile/notificationPreferences` | POST | Save user notification settings |
| `/notifications/readNotifications` | POST | Mark notification IDs as read |
- **Two modes:** scheduled (cron via @nestjs/schedule) + event-triggered (post-sync, goal reached)
- Push notifications supported

### 4.9 LLM Orchestrator Module
**Purpose:** Control how the server interacts with the AI model. Builds prompts, sends to Gemini, validates responses.
- **Input:** questionnaire answers + user goals + computed financial metrics (snapshot)
- **Process:** Build structured prompt → send to Gemini 1.5 Flash → parse & validate response → normalize output
- **Output:** stage placement (1–5), step recommendation, explanation text, suggested goals
- The orchestrator MUST validate and normalize LLM responses before using them
- This is an internal service — no direct client-facing API endpoint

---

## 5. Database Schema (PostgreSQL)

### Users
| Column | Type | Notes |
|---|---|---|
| user_id | UUID | PK |
| email | VARCHAR(255) | Unique, Not Null |
| password_hash | VARCHAR(255) | Not Null |
| created_at | TIMESTAMP | Default: NOW |

### UserProfiles
| Column | Type |
|---|---|
| profile_id | UUID PK |
| user_id | UUID FK → Users |
| age | INT |
| risk_tolerance | VARCHAR(50) |
| knowledge_level | VARCHAR(50) |
| occupation | VARCHAR(100) |

### BankConsents
| Column | Type |
|---|---|
| consent_id | UUID PK |
| user_id | UUID FK → Users |
| status | VARCHAR(20) |
| expiration_date | TIMESTAMP |

### BankTokens
| Column | Type | Notes |
|---|---|---|
| token_id | UUID PK | |
| consent_id | UUID FK → BankConsents | |
| access_token_enc | TEXT | Encrypted |
| refresh_token_enc | TEXT | Encrypted |

### FinancialSnapshots
| Column | Type |
|---|---|
| snapshot_id | UUID PK |
| user_id | UUID FK → Users |
| monthly_income | DECIMAL(12,2) |
| monthly_expenses | DECIMAL(12,2) |
| total_savings | DECIMAL(12,2) |
| total_debt | DECIMAL(12,2) |
| created_at | TIMESTAMP |

### FinancialEvents
| Column | Type |
|---|---|
| event_id | UUID PK |
| user_id | UUID FK → Users |
| event_type | VARCHAR(50) |
| amount | DECIMAL(12,2) |
| event_date | TIMESTAMP |

### UserGoals
| Column | Type |
|---|---|
| goal_id | UUID PK |
| user_id | UUID FK → Users |
| goal_name | VARCHAR(100) |
| target_amount | DECIMAL(12,2) |
| current_amount | DECIMAL(12,2) |
| target_date | DATE |

### RoadmapSteps *(static/seed data)*
| Column | Type |
|---|---|
| step_id | INT PK |
| title | VARCHAR(100) |
| description | TEXT |
| criteria | JSONB |

### RoadmapStates
| Column | Type |
|---|---|
| state_id | UUID PK |
| user_id | UUID FK → Users |
| current_step_id | INT FK → RoadmapSteps |
| progress_percent | INT |

### LLMGuidanceLogs
| Column | Type |
|---|---|
| log_id | UUID PK |
| user_id | UUID FK → Users |
| context_snapshot | JSONB |
| guidance_text | TEXT |
| created_at | TIMESTAMP |

### NotificationTemplates *(static/seed data)*
| Column | Type |
|---|---|
| template_id | VARCHAR(50) PK |
| title | VARCHAR(100) |
| body | TEXT |
| trigger_type | VARCHAR(50) |

### UserNotifications
| Column | Type |
|---|---|
| notification_id | UUID PK |
| user_id | UUID FK → Users |
| template_id | VARCHAR(50) FK → NotificationTemplates |
| is_read | BOOLEAN (default FALSE) |
| sent_at | TIMESTAMP |

---

## 6. Roadmap Stages (5 Levels)

| Stage | Name | Goal | Key Metrics |
|---|---|---|---|
| 1 | Basic Needs & Cash Flow | Control cash flow, eliminate overdraft | Can cover monthly obligations |
| 2 | Financial Safety | Build emergency fund, insurance coverage | 3–6 months expenses saved |
| 3 | Wealth Accumulation | Short/medium-term savings & investing | Active savings/investment tracks |
| 4 | Financial Freedom | Long-term stability, independence | Diversified portfolio, reduced work dependency |
| 5 | Future & Legacy Creation | Retirement planning, legacy building | Pension optimized, intergenerational planning |

**Stage placement is done by the AI (Gemini)** using: liquidity ratio, debt-to-income, emergency fund existence, investment presence, and questionnaire data.

Each stage has:
- **Mini-goals** (micro-tasks following Nudge Theory)
- **Loss aversion alerts** (opportunity cost of inaction)
- **Target cards** (quantitative goals with schedules)

---

## 7. AI / LLM Pipeline

### Phase 1 — Pre-processing (Python / Pandas)
- Securely connect to banking APIs (Open Banking standard)
- Pull: current account transactions, credit card transactions, balances
- Load into Pandas DataFrames → clean data → classify expense categories → identify trends
- **Output:** "Financial Snapshot" — disposable income %, debt-to-income ratio, emergency fund existence
- This snapshot (NOT raw transactions) is what gets passed to the AI

### Phase 2 — AI Analysis (Gemini 1.5 Flash)
- Send financial snapshot + 5-stage hierarchy definitions to Gemini
- Model performs "Qualitative Inference" → cross-references data with hierarchy
- Determines user's exact stage on the financial ladder
- **Model choice:** `gemini-1.5-flash` for low latency (real-time roadmap updates)

### Phase 3 — Output (Strategic Roadmap Alignment)
1. **Current Phase Localization:** Cross-reference existing capital with stages — user doesn't start at zero, credit for past achievements
2. **Milestone Goal Setting:** For each roadmap station, AI creates a personalized "Target Card" with quantitative goals, schedules, and execution instructions

---

## 8. Security Requirements

- **No raw transactions stored** — only computed indicators and events
- **Encrypted tokens:** `access_token_enc`, `refresh_token_enc` stored encrypted in DB
- **JWT** for all authenticated API calls
- Consent audit log must be maintained
- Compliance with GDPR and local Israeli privacy regulations

---

## 9. NestJS Project Structure (Recommended)

```
src/
├── auth/
├── user-profile/
├── questionnaire/
├── open-finance/
├── financial-analysis/
├── event-detection/
├── roadmap/
├── goals/
├── notifications/
├── llm-orchestrator/
├── database/         # TypeORM / Prisma config + migrations
├── common/           # Guards, decorators, interceptors, pipes
└── main.ts
```

---

## 10. Key Implementation Notes

- **NestJS** is explicitly specified in the document as the server framework
- All client communication goes through the REST API — client never talks directly to DB or Open Finance
- The **LLM Orchestrator** must validate and normalize Gemini responses before using them
- **Event Detection** runs as an internal service triggered post-sync, not a direct client endpoint
- Push notifications need both scheduled (cron) and event-triggered modes
- The Knowledge Hub is a **non-advisory** data repository (regulatory constraint — no investment advice)

---

## 11. Client-Side API Consumption Summary

The React client communicates ONLY through the REST API. It never touches DB or Open Finance directly.

| Feature | Endpoints Used |
|---|---|
| **Auth** | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` — stores access token for session |
| **Consent & Bank** | `POST /openfinance/connect` (start consent), `GET /openfinance/callback` (server handles redirect) |
| **Questionnaire** | `POST /questionnaire` |
| **Financial Snapshot** | `GET /finance/snapshot` |
| **Roadmap** | `GET /roadmap`, `POST /roadmap` |
| **Goals** | `GET /goals`, `POST /goals`, `POST /goals/update`, `POST /goals/delete` |
| **Notifications** | `GET /notifications`, `POST /profile/notificationPreferences`, `POST /notifications/readNotifications` |

---

## 12. POC Scope

### In Scope
- Basic UI/UX wireframes (Roadmap view + Task list)
- Simulated Open Finance JSON data processing
- Validation with diverse synthetic personas
- Basic 5-stage placement algorithm implementation
- Automated stage-appropriate behavioral task generation
- End-to-end flow: data ingestion → analysis → roadmap → task assignment

### Out of Scope (for POC)
- Personal questionnaire & details page
- Full production UI/UX
- Production-level security (ISO, SOC2)
- Advanced portfolio optimization

### Success Criteria
- ≥85% classification accuracy (user → correct stage)
- ≥85% correlation between financial gaps and assigned tasks
- Successful end-to-end flow from data ingestion to first task display
