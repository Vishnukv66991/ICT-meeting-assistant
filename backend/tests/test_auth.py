import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.app import main
from backend.app.database import get_db
from backend.app.models import User
from backend.app.security import hash_password


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
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


def csrf_headers(client):
    response = client.get("/api/auth/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def test_register_edit_profile_and_logout(client):
    response = client.post(
        "/api/auth/register",
        headers=csrf_headers(client),
        json={
            "full_name": "Alex Morgan",
            "email": "alex@example.com",
            "password": "correct-horse",
            "confirm_password": "correct-horse",
        },
    )
    assert response.status_code == 201
    assert response.json()["role"] == "Meeting participant"
    assert response.json()["approval_status"] == "pending"
    assert client.get("/api/auth/me").status_code == 401
    response = client.post(
        "/api/auth/login",
        headers=csrf_headers(client),
        json={"email": "alex@example.com", "password": "correct-horse"},
    )
    assert response.status_code == 403

    with Session(main.engine) as database:
        user = database.query(User).filter_by(email="alex@example.com").one()
        user.approval_status = "approved"
        database.commit()

    response = client.post(
        "/api/auth/login",
        headers=csrf_headers(client),
        json={"email": "alex@example.com", "password": "correct-horse"},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 200

    response = client.patch(
        "/api/auth/profile",
        headers=csrf_headers(client),
        json={"full_name": "Alex Rivera", "email": "alex@example.com"},
    )
    assert response.status_code == 200
    assert response.json()["full_name"] == "Alex Rivera"

    response = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert response.status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_rejects_missing_csrf_and_mismatched_passwords(client):
    payload = {
        "full_name": "Alex Morgan",
        "email": "alex@example.com",
        "password": "correct-horse",
        "confirm_password": "not-the-same",
    }
    assert client.post("/api/auth/register", json=payload).status_code == 403
    response = client.post("/api/auth/register", headers=csrf_headers(client), json=payload)
    assert response.status_code == 422


def test_admin_can_list_users_but_member_cannot(client):
    for email in ("admin@example.com", "member@example.com"):
        response = client.post(
            "/api/auth/register",
            headers=csrf_headers(client),
            json={
                "full_name": email.split("@")[0].title(),
                "email": email,
                "password": "correct-horse",
                "confirm_password": "correct-horse",
            },
        )
        assert response.status_code == 201

    with Session(main.engine) as database:
        admin = database.query(User).filter_by(email="admin@example.com").one()
        admin.role = "Workspace administrator"
        admin.approval_status = "approved"
        member = database.query(User).filter_by(email="member@example.com").one()
        member.approval_status = "approved"
        database.commit()

    login_headers = csrf_headers(client)
    response = client.post(
        "/api/auth/login",
        headers=login_headers,
        json={"email": "admin@example.com", "password": "correct-horse"},
    )
    assert response.status_code == 200
    response = client.get("/api/admin/users")
    assert response.status_code == 200
    assert len(response.json()) == 2
    assert all("password_hash" not in user for user in response.json())

    response = client.post(
        "/api/admin/users",
        headers=csrf_headers(client),
        json={
            "full_name": "New Teammate",
            "email": "new-teammate@example.com",
            "password": "temporary-password",
            "confirm_password": "temporary-password",
        },
    )
    assert response.status_code == 201
    assert response.json()["role"] == "Meeting participant"
    assert response.json()["approval_status"] == "approved"
    assert "password_hash" not in response.json()
    assert len(client.get("/api/admin/users").json()) == 3

    admin_users = client.get("/api/admin/users").json()
    member = next(user for user in admin_users if user["email"] == "member@example.com")
    new_user = next(user for user in admin_users if user["email"] == "new-teammate@example.com")
    response = client.patch(
        f"/api/admin/users/{member['id']}/role",
        headers=csrf_headers(client),
        json={"role": "Meeting organiser"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "Meeting organiser"
    response = client.delete(f"/api/admin/users/{new_user['id']}", headers=csrf_headers(client))
    assert response.status_code == 204
    assert len(client.get("/api/admin/users").json()) == 2
    admin_user = next(user for user in client.get("/api/admin/users").json() if user["email"] == "admin@example.com")
    response = client.patch(
        f"/api/admin/users/{admin_user['id']}/role",
        headers=csrf_headers(client),
        json={"role": "Meeting participant"},
    )
    assert response.status_code == 409
    response = client.delete(f"/api/admin/users/{admin_user['id']}", headers=csrf_headers(client))
    assert response.status_code == 409

    response = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert response.status_code == 204
    login_headers = csrf_headers(client)
    response = client.post(
        "/api/auth/login",
        headers=login_headers,
        json={"email": "member@example.com", "password": "correct-horse"},
    )
    assert response.status_code == 200
    assert client.get("/api/admin/users").status_code == 403
    response = client.post(
        "/api/admin/users",
        headers=csrf_headers(client),
        json={
            "full_name": "Blocked User",
            "email": "blocked@example.com",
            "password": "temporary-password",
            "confirm_password": "temporary-password",
            "role": "Meeting participant",
        },
    )
    assert response.status_code == 403
    response = client.delete("/api/admin/users/1", headers=csrf_headers(client))
    assert response.status_code == 403


def test_admin_approves_and_rejects_signup_requests(client):
    with Session(main.engine) as database:
        admin = User(
            full_name="Workspace Admin",
            email="approval-admin@example.com",
            password_hash=hash_password("correct-horse"),
            role="Workspace administrator",
            approval_status="approved",
        )
        database.add(admin)
        database.commit()

    for email in ("approve@example.com", "reject@example.com"):
        response = client.post(
            "/api/auth/register",
            headers=csrf_headers(client),
            json={
                "full_name": email.split("@")[0],
                "email": email,
                "password": "correct-horse",
                "confirm_password": "correct-horse",
            },
        )
        assert response.status_code == 201

    response = client.post(
        "/api/auth/login",
        headers=csrf_headers(client),
        json={"email": "approval-admin@example.com", "password": "correct-horse"},
    )
    assert response.status_code == 200
    pending = client.get("/api/admin/users").json()
    approve_user = next(user for user in pending if user["email"] == "approve@example.com")
    reject_user = next(user for user in pending if user["email"] == "reject@example.com")

    response = client.patch(
        f"/api/admin/users/{approve_user['id']}/approval",
        headers=csrf_headers(client),
        json={"status": "approved", "role": "Reviewer/editor"},
    )
    assert response.status_code == 200
    assert response.json()["approval_status"] == "approved"
    assert response.json()["role"] == "Reviewer/editor"

    response = client.patch(
        f"/api/admin/users/{reject_user['id']}/approval",
        headers=csrf_headers(client),
        json={"status": "rejected"},
    )
    assert response.status_code == 200
    assert response.json()["approval_status"] == "rejected"

    response = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert response.status_code == 204
    response = client.post(
        "/api/auth/login",
        headers=csrf_headers(client),
        json={"email": "approve@example.com", "password": "correct-horse"},
    )
    assert response.status_code == 200
    response = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert response.status_code == 204
    response = client.post(
        "/api/auth/login",
        headers=csrf_headers(client),
        json={"email": "reject@example.com", "password": "correct-horse"},
    )
    assert response.status_code == 403


def test_admin_cannot_demote_last_admin_via_approval_endpoint(client):
    with Session(main.engine) as database:
        admin = User(
            full_name="Single Admin",
            email="single-admin@example.com",
            password_hash=hash_password("correct-horse"),
            role="Workspace administrator",
            approval_status="approved",
        )
        database.add(admin)
        database.commit()
        admin_id = admin.id

    assert login(client, "single-admin@example.com").status_code == 200

    response = client.patch(
        f"/api/admin/users/{admin_id}/approval",
        headers=csrf_headers(client),
        json={"status": "approved", "role": "Meeting participant"},
    )
    assert response.status_code == 409
    assert "cannot remove your own administrator role" in response.json()["detail"]

    me_resp = client.get("/api/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["role"] == "Workspace administrator"
