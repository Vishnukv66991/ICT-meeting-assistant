import secrets
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from .config import settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"
ACCESS_COOKIE = "gather_access"
CSRF_COOKIE = "gather_csrf"


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: int, remember: bool = False) -> tuple[str, int]:
    max_age = 60 * 60 * 24 * 30 if remember else 60 * 60 * 12
    expires = datetime.now(timezone.utc) + timedelta(seconds=max_age)
    token = jwt.encode({"sub": str(user_id), "exp": expires}, settings.secret_key, algorithm=ALGORITHM)
    return token, max_age


def create_csrf_token() -> str:
    return secrets.token_urlsafe(32)