from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    email: EmailStr


class AdminCreateUserRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class AdminReviewRequest(BaseModel):
    status: Literal["approved", "rejected"]
    role: Literal[
        "Workspace administrator",
        "Meeting organiser",
        "Meeting participant",
        "Reviewer/editor",
    ] | None = None


class AdminRoleUpdate(BaseModel):
    role: Literal[
        "Workspace administrator",
        "Meeting organiser",
        "Meeting participant",
        "Reviewer/editor",
    ]


MeetingRole = Literal["Meeting organiser", "Meeting participant", "Reviewer/editor"]


class MeetingInviteRequest(BaseModel):
    user_id: int = Field(gt=0)
    role: MeetingRole


class MeetingCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    starts_at: datetime
    agenda: str = Field(default="", max_length=5000)
    participants: list[MeetingInviteRequest] = Field(default_factory=list)

    @field_validator("starts_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Meeting start time must include a timezone")
        return value.astimezone(timezone.utc)


class MeetingParticipantResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: MeetingRole


class MeetingResponse(BaseModel):
    id: int
    title: str
    starts_at: datetime
    agenda: str
    created_by_id: int
    created_at: datetime
    participants: list[MeetingParticipantResponse]


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: EmailStr
    role: str
    approval_status: str


class ActionItemOutput(BaseModel):
    task: str
    owner: str | None = None
    due_date: str | None = None
    priority_suggestion: str | None = None
    evidence_excerpt: str
    source_segment_id: str | None = None


class MeetingSummaryOutput(BaseModel):
    overview: str
    topics: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    action_items: list[ActionItemOutput] = Field(default_factory=list)