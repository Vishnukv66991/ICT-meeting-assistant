import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker

from backend.app import main
from backend.app.database import get_db
from backend.app.models import User
from backend.app.security import hash_password


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'meetings.db'}",
        connect_args={"check_same_thread": False},
    )
    test_sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(main, "engine", engine)

    def override_get_db():
        database = test_sessions()
        try:
            yield database
        finally:
            database.close()

    main.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()
    engine.dispose()


def create_account(database: Session, name: str, email: str, role: str, status: str = "approved") -> User:
    user = User(
        full_name=name,
        email=email,
        password_hash=hash_password("correct-horse"),
        role=role,
        approval_status=status,
    )
    database.add(user)
    database.flush()
    return user


def login(client, email: str):
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    return client.post(
        "/api/auth/login",
        headers={"X-CSRF-Token": csrf_token},
        json={"email": email, "password": "correct-horse"},
    )


def test_admin_creates_meeting_with_roles_and_access_is_limited(client):
    with Session(main.engine) as database:
        admin = create_account(database, "Admin", "meeting-admin@example.com", "Workspace administrator")
        attendee = create_account(database, "Attendee", "attendee@example.com", "Meeting participant")
        reviewer = create_account(database, "Reviewer", "reviewer@example.com", "Reviewer/editor")
        outside = create_account(database, "Outside", "outside@example.com", "Meeting participant")
        pending = create_account(database, "Pending", "pending@example.com", "Meeting participant", "pending")
        admin_id = admin.id
        attendee_id = attendee.id
        reviewer_id = reviewer.id
        outside_id = outside.id
        pending_id = pending.id
        database.commit()

    assert login(client, "meeting-admin@example.com").status_code == 200
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/admin/meetings",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "title": "Sprint planning",
            "starts_at": "2026-11-18T14:30:00Z",
            "agenda": "Review priorities and agree the sprint goal.",
            "participants": [
                {"user_id": attendee_id, "role": "Meeting participant"},
                {"user_id": reviewer_id, "role": "Reviewer/editor"},
            ],
        },
    )
    assert response.status_code == 201, response.text
    meeting = response.json()
    assert meeting["title"] == "Sprint planning"
    roles = {participant["id"]: participant["role"] for participant in meeting["participants"]}
    assert roles == {
        admin_id: "Meeting organiser",
        attendee_id: "Meeting participant",
        reviewer_id: "Reviewer/editor",
    }

    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/admin/meetings",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "title": "Invalid invite",
            "starts_at": "2026-11-18T14:30:00Z",
            "participants": [{"user_id": pending_id, "role": "Meeting participant"}],
        },
    )
    assert response.status_code == 422

    meeting_id = meeting["id"]
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf_token}).status_code == 204
    assert login(client, "attendee@example.com").status_code == 200
    response = client.get("/api/meetings")
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [meeting_id]
    assert client.get(f"/api/meetings/{meeting_id}").status_code == 200
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/admin/meetings",
        headers={"X-CSRF-Token": csrf_token},
        json={"title": "No permission", "starts_at": "2026-11-19T14:30:00Z"},
    )
    assert response.status_code == 403

    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf_token}).status_code == 204
    assert login(client, "outside@example.com").status_code == 200
    assert client.get("/api/meetings").json() == []
    assert client.get(f"/api/meetings/{meeting_id}").status_code == 404
    assert outside_id not in roles


def test_only_meeting_organizer_can_start_and_end_call(client):
    with Session(main.engine) as database:
        admin = create_account(database, "Admin", "call-admin@example.com", "Workspace administrator")
        attendee = create_account(database, "Attendee", "call-attendee@example.com", "Meeting participant")
        attendee_id = attendee.id
        database.commit()

    assert login(client, "call-admin@example.com").status_code == 200
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/admin/meetings",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "title": "Call permissions",
            "starts_at": "2026-11-18T14:30:00Z",
            "participants": [{"user_id": attendee_id, "role": "Meeting participant"}],
        },
    )
    assert response.status_code == 201
    meeting_id = response.json()["id"]

    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf_token}).status_code == 204
    assert login(client, "call-attendee@example.com").status_code == 200
    with client.websocket_connect(f"/api/meetings/{meeting_id}/call", headers={"origin": "http://localhost:3000"}) as socket:
        assert socket.receive_json()["type"] == "waiting"
        socket.send_json({"type": "start"})
        assert "organiser" in socket.receive_json()["message"]

    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf_token}).status_code == 204
    assert login(client, "call-admin@example.com").status_code == 200
    with client.websocket_connect(f"/api/meetings/{meeting_id}/call", headers={"origin": "http://localhost:3000"}) as socket:
        assert socket.receive_json()["type"] == "waiting"
        socket.send_json({"type": "start"})
        assert socket.receive_json()["type"] == "call_started"
        assert client.get(f"/api/meetings/{meeting_id}/call-status").json()["active"] is True
        socket.send_json({"type": "end"})
        assert socket.receive_json()["type"] == "call_ended"
        assert client.get(f"/api/meetings/{meeting_id}/call-status").json()["active"] is False


def test_call_members_receive_peer_ready_events_for_group_connections(client):
    with Session(main.engine) as database:
        admin = create_account(database, "Admin", "mesh-admin@example.com", "Workspace administrator")
        attendee = create_account(database, "Attendee", "mesh-attendee@example.com", "Meeting participant")
        admin_id = admin.id
        attendee_id = attendee.id
        database.commit()

    assert login(client, "mesh-admin@example.com").status_code == 200
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/admin/meetings",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "title": "Group call",
            "starts_at": "2026-11-18T14:30:00Z",
            "participants": [{"user_id": attendee_id, "role": "Meeting participant"}],
        },
    )
    assert response.status_code == 201
    meeting_id = response.json()["id"]

    with client.websocket_connect(
        f"/api/meetings/{meeting_id}/call",
        headers={"origin": "http://localhost:3000"},
    ) as admin_socket:
        assert admin_socket.receive_json()["type"] == "waiting"
        admin_socket.send_json({"type": "start"})
        assert admin_socket.receive_json()["type"] == "call_started"
        admin_socket.send_json({"type": "join_call"})

        csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
        assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf_token}).status_code == 204
        assert login(client, "mesh-attendee@example.com").status_code == 200
        with client.websocket_connect(
            f"/api/meetings/{meeting_id}/call",
            headers={"origin": "http://localhost:3000"},
        ) as attendee_socket:
            assert attendee_socket.receive_json()["type"] == "call_started"
            attendee_socket.send_json({"type": "join_call"})

            attendee_ready = attendee_socket.receive_json()
            admin_ready = admin_socket.receive_json()
            while admin_ready["type"] != "participant_ready":
                admin_ready = admin_socket.receive_json()
            assert attendee_ready == {
                "type": "participant_ready",
                "participant": {
                    "user_id": admin_id,
                    "name": "Admin",
                    "role": "Meeting organiser",
                },
            }
            assert admin_ready == {
                "type": "participant_ready",
                "participant": {
                    "user_id": attendee_id,
                    "name": "Attendee",
                    "role": "Meeting participant",
                },
            }


def test_delete_meeting_and_remove_user_succeeds(client):
    with Session(main.engine) as database:
        admin = create_account(database, "Meeting Admin", "del-admin@example.com", "Workspace administrator")
        user = create_account(database, "Meeting User", "del-user@example.com", "Meeting participant")
        admin_id = admin.id
        user_id = user.id
        database.commit()

    assert login(client, "del-admin@example.com").status_code == 200
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/admin/meetings",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "title": "To be deleted",
            "starts_at": "2026-11-18T14:30:00Z",
            "participants": [{"user_id": user_id, "role": "Meeting participant"}],
        },
    )
    assert response.status_code == 201
    meeting_id = response.json()["id"]

    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    del_response = client.delete(f"/api/meetings/{meeting_id}", headers={"X-CSRF-Token": csrf_token})
    assert del_response.status_code == 204

    assert client.get(f"/api/meetings/{meeting_id}").status_code == 404

    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    assert client.delete(f"/api/admin/users/{user_id}", headers={"X-CSRF-Token": csrf_token}).status_code == 204
