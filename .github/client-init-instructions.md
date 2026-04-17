# NextStep Client — Initialization Instructions

> These instructions are for initializing the **NextStep-Client** (React) to be fully coordinated with the **NextStep-Service** (NestJS) backend.

---

## 1. Project Setup

Initialize a **React + TypeScript** project (Vite recommended):

```bash
npm create vite@latest NextStep-Client -- --template react-ts
cd NextStep-Client
npm install
```

### Required Dependencies
```bash
npm install axios react-router-dom zustand
npm install -D @types/react-router-dom
```

- **axios** — HTTP client for all API calls to the backend
- **react-router-dom** — client-side routing
- **zustand** — lightweight state management (for auth state, user data)

---

## 2. Backend Connection

The NestJS backend runs on `http://localhost:3000` with CORS enabled.
Swagger docs are available at `http://localhost:3000/api/docs`.

### API Client Setup

Create `src/api/client.ts`:

```typescript
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses (redirect to login)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default apiClient;
```

Create `.env` in client root:
```
VITE_API_URL=http://localhost:3000
```

---

## 3. Complete API Contract

All endpoints the client needs to consume, matching the backend controllers exactly:

### 3.1 Auth (no token required)

| Method | Endpoint | Request Body | Response |
|--------|----------|-------------|----------|
| POST | `/auth/register` | `{ email: string, password: string }` | `{ accessToken: string, userId: string }` |
| POST | `/auth/login` | `{ email: string, password: string }` | `{ accessToken: string, userId: string }` |
| POST | `/auth/logout` | — | `{ message: string }` |

**Validation rules:**
- `email` — must be valid email format
- `password` — minimum 6 characters

After register/login, store `accessToken` in localStorage and attach as `Bearer` token on all subsequent requests.

### 3.2 Questionnaire (🔒 requires JWT)

| Method | Endpoint | Request Body | Response |
|--------|----------|-------------|----------|
| POST | `/questionnaire` | `{ answers: object }` | `{ message: string }` |

Used during onboarding step 2 — user provides assets, liabilities, long-term objectives.

### 3.3 User Profile (🔒 requires JWT)

| Method | Endpoint | Request Body | Response |
|--------|----------|-------------|----------|
| POST | `/profile/notificationPreferences` | `{ preferences: object }` | `{ message: string }` |

### 3.4 Open Finance (🔒 requires JWT for connect/sync)

| Method | Endpoint | Request Body / Params | Response |
|--------|----------|-----------------------|----------|
| POST | `/openfinance/connect` | `{ userId: string }` | `{ consentUrl: string }` |
| GET | `/openfinance/callback` | Query params from redirect | `{ message: string }` |
| POST | `/openfinance/sync` | `{ dateRange?: { from, to } }` | `{ message: string, transactionsProcessed: number }` |

**Flow:**
1. Client calls `POST /openfinance/connect` → gets `consentUrl`
2. Client redirects user to `consentUrl` (Open Finance bank consent page)
3. Bank redirects back to `/openfinance/callback` (handled by server)
4. Client calls `POST /openfinance/sync` to fetch latest data

### 3.5 Financial Analysis (🔒 requires JWT)

| Method | Endpoint | Response |
|--------|----------|----------|
| GET | `/finance/snapshot` | `{ snapshotId, userId, monthlyIncome, monthlyExpenses, totalSavings, totalDebt, createdAt }` |

### 3.6 Events (🔒 requires JWT)

| Method | Endpoint | Response |
|--------|----------|----------|
| GET | `/events` | `Array<{ eventId, userId, eventType, amount, eventDate }>` |

Event types: `salary_deposit`, `large_expense`, `goal_reached`, etc.

### 3.7 Roadmap (🔒 requires JWT)

| Method | Endpoint | Request Body | Response |
|--------|----------|-------------|----------|
| GET | `/roadmap` | — | `{ state: { stateId, userId, currentStepId, progressPercent }, steps: Array<{ stepId, title, description, criteria }> }` |
| POST | `/roadmap` | `{ updates: object }` | `{ message: string }` |

The 5 roadmap steps (static):
| stepId | title |
|--------|-------|
| 1 | Basic Needs & Cash Flow |
| 2 | Financial Safety |
| 3 | Wealth Accumulation |
| 4 | Financial Freedom |
| 5 | Future & Legacy Creation |

### 3.8 Goals (🔒 requires JWT)

| Method | Endpoint | Request Body | Response |
|--------|----------|-------------|----------|
| GET | `/goals` | — | `Array<{ goalId, userId, goalName, targetAmount, currentAmount, targetDate }>` |
| POST | `/goals` | `{ goalName, targetAmount, targetDate? }` | Created goal object |
| POST | `/goals/update` | `{ goalId, ...fieldsToUpdate }` | `{ message: string }` |
| POST | `/goals/delete` | `{ goalId: string }` | `{ message: string }` |

### 3.9 Notifications (🔒 requires JWT)

| Method | Endpoint | Request Body | Response |
|--------|----------|-------------|----------|
| GET | `/notifications` | — | `Array<{ notificationId, userId, templateId, isRead, sentAt, template: { title, body, triggerType } }>` |
| POST | `/notifications/readNotifications` | `{ notificationIds: string[] }` | `{ message: string }` |

---

## 4. Recommended Folder Structure

```
src/
├── api/
│   ├── client.ts             # Axios instance with interceptors
│   ├── auth.api.ts           # register(), login(), logout()
│   ├── questionnaire.api.ts  # submitQuestionnaire()
│   ├── openfinance.api.ts    # connect(), sync()
│   ├── finance.api.ts        # getSnapshot()
│   ├── events.api.ts         # getEvents()
│   ├── roadmap.api.ts        # getRoadmap(), updateRoadmap()
│   ├── goals.api.ts          # getGoals(), createGoal(), updateGoal(), deleteGoal()
│   └── notifications.api.ts  # getNotifications(), markAsRead()
├── store/
│   ├── authStore.ts          # Zustand: accessToken, userId, isAuthenticated
│   ├── userStore.ts          # Zustand: profile, questionnaire state
│   └── roadmapStore.ts       # Zustand: current step, progress, goals
├── pages/
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── Onboarding/
│   │   ├── BankConnect.tsx       # Open Finance consent flow
│   │   └── Questionnaire.tsx     # Step 2 questionnaire
│   ├── Dashboard/
│   │   ├── Roadmap.tsx           # Main roadmap view
│   │   ├── GoalManager.tsx       # Goal CRUD
│   │   └── FinancialSnapshot.tsx # Current financial status
│   ├── Notifications.tsx
│   ├── Profile.tsx               # Notification preferences
│   └── KnowledgeHub.tsx          # Financial education content
├── components/
│   ├── ProtectedRoute.tsx    # Redirect to /login if no token
│   ├── RoadmapStage.tsx      # Single stage card in roadmap
│   ├── GoalCard.tsx
│   ├── NotificationItem.tsx
│   └── LossAlert.tsx         # "Cost of inaction" nudge display
├── types/
│   └── index.ts              # Shared TypeScript interfaces (see §5)
└── App.tsx                   # Router setup
```

---

## 5. Shared TypeScript Types

Create `src/types/index.ts` to match backend entities:

```typescript
// Auth
export interface AuthResponse {
  accessToken: string;
  userId: string;
}

// Financial Snapshot
export interface FinancialSnapshot {
  snapshotId: string;
  userId: string;
  monthlyIncome: number;
  monthlyExpenses: number;
  totalSavings: number;
  totalDebt: number;
  createdAt: string;
}

// Financial Event
export interface FinancialEvent {
  eventId: string;
  userId: string;
  eventType: string;
  amount: number;
  eventDate: string;
}

// Goal
export interface UserGoal {
  goalId: string;
  userId: string;
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
}

// Roadmap
export interface RoadmapStep {
  stepId: number;
  title: string;
  description: string;
  criteria: Record<string, any>;
}

export interface RoadmapState {
  stateId: string;
  userId: string;
  currentStepId: number;
  progressPercent: number;
  currentStep?: RoadmapStep;
}

export interface RoadmapResponse {
  state: RoadmapState | null;
  steps: RoadmapStep[];
}

// Notification
export interface NotificationTemplate {
  templateId: string;
  title: string;
  body: string;
  triggerType: string;
}

export interface UserNotification {
  notificationId: string;
  userId: string;
  templateId: string;
  isRead: boolean;
  sentAt: string;
  template: NotificationTemplate;
}
```

---

## 6. Routing Plan

```typescript
// App.tsx routes
<Routes>
  {/* Public */}
  <Route path="/login" element={<Login />} />
  <Route path="/register" element={<Register />} />

  {/* Protected (require JWT) */}
  <Route element={<ProtectedRoute />}>
    {/* Onboarding */}
    <Route path="/onboarding/bank-connect" element={<BankConnect />} />
    <Route path="/onboarding/questionnaire" element={<Questionnaire />} />

    {/* Main App */}
    <Route path="/" element={<Roadmap />} />
    <Route path="/goals" element={<GoalManager />} />
    <Route path="/snapshot" element={<FinancialSnapshot />} />
    <Route path="/notifications" element={<Notifications />} />
    <Route path="/profile" element={<Profile />} />
    <Route path="/knowledge-hub" element={<KnowledgeHub />} />
  </Route>
</Routes>
```

---

## 7. Key Coordination Notes

1. **Auth flow:** Backend returns `{ accessToken, userId }` — store token in localStorage, attach as `Bearer <token>` header on all subsequent requests
2. **Validation:** Backend uses `class-validator` with `whitelist: true` and `forbidNonWhitelisted: true` — do NOT send extra fields in request bodies or they'll be rejected
3. **CORS:** Backend has CORS enabled for all origins in dev
4. **Swagger:** Full API docs at `http://localhost:3000/api/docs` — use this to test endpoints
5. **No direct DB/OpenFinance access:** Client ONLY talks to the NestJS REST API
6. **Knowledge Hub:** Content is non-advisory (regulatory constraint) — display as educational info only, never as investment advice
7. **Loss alerts:** Client should display "cost of inaction" values from the snapshot/roadmap data using Prospect Theory framing
