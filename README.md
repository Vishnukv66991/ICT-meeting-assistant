# Gather | ICT AI Meeting Assistant

Prototype account screens for the ICT AI Meeting Assistant assignment. The current workflow includes registration, sign-in, profile editing, and an administrator user dashboard, implemented with the target stack:

- Frontend: Next.js + TypeScript
- Backend: FastAPI
- Database: PostgreSQL via SQLAlchemy
- Background jobs: Celery + Redis
- AI: structured Pydantic output models are defined; provider integration stays disabled until privacy review approves one
- Speech-to-text: not connected; select a provider only after consent and privacy review

This is an MVP prototype, not a production-ready service.

## Requirements

- Node.js 20.9+
- Python 3.10+
- Docker Desktop for local PostgreSQL and Redis

## Run locally

Start the data services:

```powershell
docker compose up -d postgres redis
```

In a backend terminal:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "use-a-long-random-secret-at-least-32-characters"
$env:DATABASE_URL = "postgresql+psycopg://gather:gather@localhost:5432/gather"
$env:REDIS_URL = "redis://localhost:6379/0"
uvicorn backend.app.main:app --reload --port 8000
```

In a frontend terminal:

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_URL = "http://localhost:8000"
npm run dev
```

Open http://localhost:3000. FastAPI's interactive API documentation is at http://localhost:8000/docs. Start a Celery worker from the repository root with `celery -A backend.app.worker.celery_app worker --loglevel=info` after Redis is available.

## Verify

Run the backend tests from the repository root:

```powershell
python -m pytest
```

Build the frontend:

```powershell
cd frontend
npm run build
```

## Current scope and safety

- Self-registration creates a pending account request; pending and rejected accounts cannot sign in. Passwords are Argon2-hashed; session tokens are HttpOnly cookies and unsafe requests require a CSRF token.
- Workspace administrators can review requests, approve with a role, reject, change roles, remove users, and directly create approved accounts. These actions are authorized on the server; the last active administrator cannot be demoted or removed.
- Workspace administrators can create scheduled meeting spaces with an agenda, invite approved users, and assign each invitee a meeting-specific role. The creator is added as meeting organiser; only the creator and invited users can list/open that meeting.
- PostgreSQL is the default database. Tests use temporary SQLite databases and do not require Docker.
- `MeetingSummaryOutput` defines a structured summary/action-item contract with evidence fields. `LLM_PROVIDER=disabled` by default, and the Celery summary task deliberately refuses to run until a provider is approved and configured.
- No live video calls, recording, speech-to-text, meeting editing/deletion, transcript upload, database migration framework, password reset, email verification, or rate limiting is included yet.
- Compose credentials are for local development only. Never expose them publicly or use real meeting data before security, privacy, and operational review.