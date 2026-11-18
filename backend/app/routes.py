import hmac

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, WebSocket, WebSocketDisconnect, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Meeting, MeetingParticipant, User
from .schemas import (
    AdminCreateUserRequest,
    AdminReviewRequest,
    AdminRoleUpdate,
    LoginRequest,
    MeetingCreateRequest,
    MeetingParticipantResponse,
    MeetingResponse,
    ProfileUpdate,
    RegisterRequest,
    UserResponse,
)
from .security import (
    ACCESS_COOKIE,
    ALGORITHM,
    CSRF_COOKIE,
    create_access_token,
    create_csrf_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["authentication"])
admin_router = APIRouter(prefix="/api/admin", tags=["administration"])
meetings_router = APIRouter(prefix="/api/meetings", tags=["meetings"])
call_rooms: dict[int, dict[int, tuple[WebSocket, dict]]] = {}
active_calls: dict[int, int] = {}
ready_call_users: dict[int, set[int]] = {}


@router.get("/csrf")
def csrf(response: Response):
    token = create_csrf_token()
    response.set_cookie(
        CSRF_COOKIE,
        token,
        httponly=False,
        secure=settings.app_env == "production",
        samesite="lax",
        path="/",
    )
    return {"csrf_token": token}


def set_session_cookies(response: Response, user_id: int, remember: bool = False) -> None:
    token, max_age = create_access_token(user_id, remember)
    csrf_token = create_csrf_token()
    cookie_options = {
        "secure": settings.app_env == "production",
        "samesite": "lax",
        "path": "/",
    }
    response.set_cookie(ACCESS_COOKIE, token, httponly=True, max_age=max_age, **cookie_options)
    response.set_cookie(CSRF_COOKIE, csrf_token, httponly=False, max_age=max_age, **cookie_options)


def require_csrf(
    request: Request,
    x_csrf_token: str | None = Header(default=None),
) -> None:
    cookie_token = request.cookies.get(CSRF_COOKIE, "")
    if not cookie_token or not x_csrf_token or not hmac.compare_digest(cookie_token, x_csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")


def current_user(request: Request, database: Session = Depends(get_db)) -> User:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required") from None
    user = database.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required")
    if user.approval_status != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is not approved")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "Workspace administrator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


def prevent_last_admin_removal(user: User, database: Session) -> None:
    if user.role != "Workspace administrator" or user.approval_status != "approved":
        return
    admin_count = database.scalar(
        select(func.count(User.id)).where(
            User.role == "Workspace administrator",
            User.approval_status == "approved",
        )
    )
    if admin_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The last active administrator cannot be removed or demoted",
        )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    _csrf: None = Depends(require_csrf),
    database: Session = Depends(get_db),
):
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match")
    user = User(
        full_name=payload.full_name.strip(),
        email=str(payload.email).lower(),
        password_hash=hash_password(payload.password),
        approval_status="pending",
    )
    database.add(user)
    try:
        database.commit()
    except IntegrityError:
        database.rollback()
        raise HTTPException(status_code=409, detail="An account with that email already exists") from None
    database.refresh(user)
    return user


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest,
    response: Response,
    _csrf: None = Depends(require_csrf),
    database: Session = Depends(get_db),
):
    user = database.scalar(select(User).where(User.email == str(payload.email).lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    if user.approval_status == "pending":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account is awaiting administrator approval")
    if user.approval_status == "rejected":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account request was rejected. Contact an administrator.")
    set_session_cookies(response, user.id, payload.remember)
    return user


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(current_user)):
    return user


@router.patch("/profile", response_model=UserResponse)
def update_profile(
    payload: ProfileUpdate,
    _csrf: None = Depends(require_csrf),
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
):
    user.full_name = payload.full_name.strip()
    user.email = str(payload.email).lower()
    try:
        database.commit()
    except IntegrityError:
        database.rollback()
        raise HTTPException(status_code=409, detail="That email address is already in use") from None
    database.refresh(user)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, _csrf: None = Depends(require_csrf)):
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@admin_router.get("/users", response_model=list[UserResponse])
def list_users(
    _admin: User = Depends(require_admin),
    database: Session = Depends(get_db),
):
    return database.scalars(select(User).order_by(User.id.desc())).all()


@admin_router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminCreateUserRequest,
    _csrf: None = Depends(require_csrf),
    _admin: User = Depends(require_admin),
    database: Session = Depends(get_db),
):
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match")
    user = User(
        full_name=payload.full_name.strip(),
        email=str(payload.email).lower(),
        password_hash=hash_password(payload.password),
        role="Meeting participant",
        approval_status="approved",
    )
    database.add(user)
    try:
        database.commit()
    except IntegrityError:
        database.rollback()
        raise HTTPException(status_code=409, detail="An account with that email already exists") from None
    database.refresh(user)
    return user


@admin_router.patch("/users/{user_id}/approval", response_model=UserResponse)
def review_user(
    user_id: int,
    payload: AdminReviewRequest,
    _csrf: None = Depends(require_csrf),
    admin: User = Depends(require_admin),
    database: Session = Depends(get_db),
):
    user = database.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if payload.status == "approved" and payload.role is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose a role to approve this account")
    if payload.status == "rejected":
        if user.id == admin.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot reject your own account")
        prevent_last_admin_removal(user, database)

    if payload.role is not None and payload.role != user.role:
        if user.id == admin.id and payload.role != "Workspace administrator":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You cannot remove your own administrator role",
            )
        if user.role == "Workspace administrator" and payload.role != "Workspace administrator":
            prevent_last_admin_removal(user, database)
        user.role = payload.role

    user.approval_status = payload.status
    database.commit()
    database.refresh(user)
    return user


@admin_router.patch("/users/{user_id}/role", response_model=UserResponse)
def change_user_role(
    user_id: int,
    payload: AdminRoleUpdate,
    _csrf: None = Depends(require_csrf),
    admin: User = Depends(require_admin),
    database: Session = Depends(get_db),
):
    user = database.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id and payload.role != "Workspace administrator":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot remove your own administrator role")
    if payload.role != "Workspace administrator":
        prevent_last_admin_removal(user, database)
    user.role = payload.role
    database.commit()
    database.refresh(user)
    return user


@admin_router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_user(
    user_id: int,
    _csrf: None = Depends(require_csrf),
    admin: User = Depends(require_admin),
    database: Session = Depends(get_db),
):
    user = database.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot remove your own administrator account")
    prevent_last_admin_removal(user, database)
    owned_meetings = database.scalar(select(func.count(Meeting.id)).where(Meeting.created_by_id == user_id))
    if owned_meetings:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account organizes meetings. Transfer or remove those meetings before removing the account.",
        )
    database.execute(delete(MeetingParticipant).where(MeetingParticipant.user_id == user_id))
    database.delete(user)
    database.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def meeting_response(meeting: Meeting, database: Session) -> MeetingResponse:
    members = database.execute(
        select(User, MeetingParticipant.role)
        .join(MeetingParticipant, MeetingParticipant.user_id == User.id)
        .where(MeetingParticipant.meeting_id == meeting.id)
        .order_by(User.full_name)
    ).all()
    return MeetingResponse(
        id=meeting.id,
        title=meeting.title,
        starts_at=meeting.starts_at,
        agenda=meeting.agenda,
        created_by_id=meeting.created_by_id,
        created_at=meeting.created_at,
        participants=[
            MeetingParticipantResponse(
                id=user.id,
                full_name=user.full_name,
                email=user.email,
                role=role,
            )
            for user, role in members
        ],
    )


@admin_router.post("/meetings", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
def create_meeting(
    payload: MeetingCreateRequest,
    _csrf: None = Depends(require_csrf),
    admin: User = Depends(require_admin),
    database: Session = Depends(get_db),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Meeting title is required")
    invite_ids = [invite.user_id for invite in payload.participants]
    if len(invite_ids) != len(set(invite_ids)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A user can only be invited once")
    if admin.id in invite_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The meeting creator is added automatically")
    if invite_ids:
        approved_ids = set(
            database.scalars(
                select(User.id).where(User.id.in_(invite_ids), User.approval_status == "approved")
            ).all()
        )
        if approved_ids != set(invite_ids):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Meetings can only include approved users",
            )

    meeting = Meeting(
        title=title,
        starts_at=payload.starts_at,
        agenda=payload.agenda.strip(),
        created_by_id=admin.id,
    )
    database.add(meeting)
    database.flush()
    database.add(MeetingParticipant(meeting_id=meeting.id, user_id=admin.id, role="Meeting organiser"))
    database.add_all(
        MeetingParticipant(meeting_id=meeting.id, user_id=invite.user_id, role=invite.role)
        for invite in payload.participants
    )
    database.commit()
    database.refresh(meeting)
    return meeting_response(meeting, database)


@meetings_router.get("", response_model=list[MeetingResponse])
def list_my_meetings(user: User = Depends(current_user), database: Session = Depends(get_db)):
    meetings = database.scalars(
        select(Meeting)
        .outerjoin(MeetingParticipant, MeetingParticipant.meeting_id == Meeting.id)
        .where(or_(Meeting.created_by_id == user.id, MeetingParticipant.user_id == user.id))
        .distinct()
        .order_by(Meeting.starts_at)
    ).all()
    return [meeting_response(meeting, database) for meeting in meetings]


@meetings_router.get("/{meeting_id}", response_model=MeetingResponse)
def get_meeting(
    meeting_id: int,
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
):
    meeting = database.get(Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    is_participant = database.scalar(
        select(MeetingParticipant.user_id).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.user_id == user.id,
        )
    )
    if meeting.created_by_id != user.id and is_participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return meeting_response(meeting, database)


@meetings_router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: int,
    _csrf: None = Depends(require_csrf),
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
):
    meeting = database.get(Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    is_creator = meeting.created_by_id == user.id
    is_admin = user.role == "Workspace administrator"
    participant_role = database.scalar(
        select(MeetingParticipant.role).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.user_id == user.id,
        )
    )
    is_organiser = participant_role == "Meeting organiser"

    if not (is_creator or is_admin or is_organiser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a meeting organiser or workspace administrator can delete this meeting",
        )

    active_calls.pop(meeting_id, None)
    ready_call_users.pop(meeting_id, None)
    if meeting_id in call_rooms:
        await broadcast_call_event(meeting_id, {"type": "call_ended", "by_user_id": user.id})
        call_rooms.pop(meeting_id, None)

    database.execute(delete(MeetingParticipant).where(MeetingParticipant.meeting_id == meeting_id))
    database.delete(meeting)
    database.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@meetings_router.get("/{meeting_id}/call-status")
def get_call_status(
    meeting_id: int,
    user: User = Depends(current_user),
    database: Session = Depends(get_db),
):
    meeting = database.get(Meeting, meeting_id)
    membership = database.get(MeetingParticipant, (meeting_id, user.id))
    if meeting is None or membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return {
        "active": meeting_id in active_calls,
        "host_user_id": active_calls.get(meeting_id),
        "participant_count": len(call_rooms.get(meeting_id, {})) if meeting_id in active_calls else 0,
    }


async def broadcast_call_event(meeting_id: int, event: dict, exclude_user_id: int | None = None):
    room = call_rooms.get(meeting_id, {})
    for participant_id, (socket, _profile) in list(room.items()):
        if participant_id == exclude_user_id:
            continue
        try:
            await socket.send_json(event)
        except Exception:
            room.pop(participant_id, None)


@meetings_router.websocket("/{meeting_id}/call")
async def meeting_call_socket(
    websocket: WebSocket,
    meeting_id: int,
    database: Session = Depends(get_db),
):
    origin = websocket.headers.get("origin")
    if origin not in settings.cors_origins:
        await websocket.close(code=4403, reason="Origin not allowed")
        return
    token = websocket.cookies.get(ACCESS_COOKIE)
    if not token:
        await websocket.close(code=4401, reason="Sign in required")
        return
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        await websocket.close(code=4401, reason="Sign in required")
        return

    user = database.get(User, user_id)
    meeting = database.get(Meeting, meeting_id)
    membership = database.get(MeetingParticipant, (meeting_id, user_id))
    if user is None or user.approval_status != "approved" or meeting is None or membership is None:
        await websocket.close(code=4404, reason="Meeting not found")
        return
    profile = {"user_id": user.id, "name": user.full_name, "role": membership.role}

    await websocket.accept()
    room = call_rooms.setdefault(meeting_id, {})
    previous_connection = room.get(user_id)
    if previous_connection is not None:
        try:
            await previous_connection[0].close(code=4001, reason="A newer connection was opened")
        except Exception:
            pass
    room[user_id] = (websocket, profile)

    if meeting_id in active_calls:
        await websocket.send_json({
            "type": "call_started",
            "host_user_id": active_calls[meeting_id],
            "participants": [member_profile for member_id, (_socket, member_profile) in room.items() if member_id != user_id],
        })
    else:
        await websocket.send_json({"type": "waiting", "host_user_id": None})
    await broadcast_call_event(
        meeting_id,
        {"type": "participant_joined", "participant": profile},
        exclude_user_id=user_id,
    )

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "start":
                if profile["role"] != "Meeting organiser":
                    await websocket.send_json({"type": "error", "message": "Only a meeting organiser can start the call."})
                elif meeting_id in active_calls:
                    await websocket.send_json({"type": "error", "message": "This call is already active."})
                else:
                    active_calls[meeting_id] = user_id
                    ready_call_users.setdefault(meeting_id, set()).add(user_id)
                    await broadcast_call_event(meeting_id, {
                        "type": "call_started",
                        "host_user_id": user_id,
                        "participants": [member_profile for _member_id, (_socket, member_profile) in call_rooms[meeting_id].items()],
                    })
            elif message_type == "join_call":
                host_id = active_calls.get(meeting_id)
                if host_id is None:
                    await websocket.send_json({"type": "error", "message": "The organiser has not started the call yet."})
                    continue
                ready_users = ready_call_users.setdefault(meeting_id, set())
                ready_users.add(user_id)
                for ready_id in ready_users - {user_id}:
                    ready_member = call_rooms.get(meeting_id, {}).get(ready_id)
                    if ready_member is None:
                        continue
                    await websocket.send_json({"type": "participant_ready", "participant": ready_member[1]})
                    await ready_member[0].send_json({"type": "participant_ready", "participant": profile})
            elif message_type == "end":
                if active_calls.get(meeting_id) != user_id:
                    await websocket.send_json({"type": "error", "message": "Only the call organiser can end the call."})
                else:
                    active_calls.pop(meeting_id, None)
                    ready_call_users.pop(meeting_id, None)
                    await broadcast_call_event(meeting_id, {"type": "call_ended", "by_user_id": user_id})
            elif message_type in {"offer", "answer", "ice_candidate"}:
                target_id = message.get("target_user_id")
                target = room.get(target_id) if isinstance(target_id, int) else None
                if target is not None and meeting_id in active_calls and target_id != user_id:
                    relay = {"type": message_type, "from_user_id": user_id}
                    if message_type in {"offer", "answer"}:
                        relay["description"] = message.get("description")
                    else:
                        relay["candidate"] = message.get("candidate")
                    await target[0].send_json(relay)
            elif message_type == "leave":
                break
            else:
                await websocket.send_json({"type": "error", "message": "Unsupported call message."})
    except WebSocketDisconnect:
        pass
    finally:
        current_room = call_rooms.get(meeting_id, {})
        if current_room.get(user_id, (None, None))[0] is websocket:
            current_room.pop(user_id, None)
            await broadcast_call_event(meeting_id, {"type": "participant_left", "user_id": user_id})
        if active_calls.get(meeting_id) == user_id:
            active_calls.pop(meeting_id, None)
            ready_call_users.pop(meeting_id, None)
            await broadcast_call_event(meeting_id, {"type": "call_ended", "by_user_id": user_id})
        else:
            ready_call_users.get(meeting_id, set()).discard(user_id)
        if not current_room:
            call_rooms.pop(meeting_id, None)