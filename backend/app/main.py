from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from . import models
from .config import settings
from .database import Base, engine
from .routes import admin_router, meetings_router, router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrations = {
        "users": {
            "approval_status": "VARCHAR(20) NOT NULL DEFAULT 'approved'",
        },
        "meeting_participants": {
            "role": "VARCHAR(40) NOT NULL DEFAULT 'Meeting participant'",
        },
        "meetings": {
            "code": "VARCHAR(30)",
            "passcode": "VARCHAR(30) NOT NULL DEFAULT '123456'",
        },
    }
    with engine.begin() as connection:
        for table_name, columns in migrations.items():
            existing_columns = {column["name"] for column in inspect(connection).get_columns(table_name)}
            for column_name, definition in columns.items():
                if column_name not in existing_columns:
                    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))
        # Ensure any existing meetings without code get a unique code
        existing_cols = {column["name"] for column in inspect(connection).get_columns("meetings")}
        if "code" in existing_cols:
            rows = connection.execute(text("SELECT id FROM meetings WHERE code IS NULL")).fetchall()
            for row in rows:
                generated = models.generate_meeting_code()
                connection.execute(text(f"UPDATE meetings SET code = '{generated}' WHERE id = {row[0]}"))
    yield


app = FastAPI(title="Gather Meeting Assistant API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)
app.include_router(router)
app.include_router(admin_router)
app.include_router(meetings_router)


@app.get("/health")
def health():
    return {"status": "ok", "llm_provider": settings.llm_provider}