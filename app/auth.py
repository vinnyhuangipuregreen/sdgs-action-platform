import hashlib
import hmac
import json
import base64
import time
import secrets

SECRET_KEY = "sdgs-fgu-climate-action-super-secret-key-2026"

def hash_password(password: str) -> str:
    salt = "fgu_sdgs_salt_2026"
    return hashlib.pbkdf2_hmac('sha256', str(password).encode('utf-8'), salt.encode('utf-8'), 100000).hex()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hmac.compare_digest(hash_password(plain_password), hashed_password)

def get_account_type(user_data: dict) -> str:
    return "staff" if user_data.get("role") in ("admin", "teacher") else "student"

def create_access_token(user_data: dict, expires_in: int = 86400 * 7) -> str:
    payload = {
        "user_id": user_data["id"],
        "session_id": user_data.get("session_id") or secrets.token_urlsafe(24),
        "email": user_data["email"],
        "name": user_data["name"],
        "role": user_data["role"],
        "account_type": get_account_type(user_data),
        "unit_name": user_data.get("unit_name", "佛光學員"),
        "exp": int(time.time()) + expires_in
    }
    payload_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode('utf-8').rstrip('=')
    signature = hmac.new(SECRET_KEY.encode('utf-8'), payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"

def decode_access_token(token: str) -> dict:
    try:
        parts = token.split('.')
        if len(parts) != 2:
            return None
        payload_b64, signature = parts
        expected_sig = hmac.new(SECRET_KEY.encode('utf-8'), payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        pad = len(payload_b64) % 4
        if pad:
            payload_b64 += '=' * (4 - pad)
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes.decode('utf-8'))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None
