"""Expose the existing matching-game administration inside the unified console."""
import re
import requests
from fastapi import HTTPException, Response

MATCHING_ORIGIN = "https://sdgs-matching-game.vercel.app"
ALLOWED_ROUTES = {
    "GET": r"(?:stats|records|targets|settings|export/csv|goals)",
    "PUT": r"(?:targets/\d+|settings/[a-zA-Z0-9_]+)",
    "DELETE": r"records/\d+",
}


def proxy_matching_request(request, path, body):
    if not re.fullmatch(ALLOWED_ROUTES.get(request.method, r"(?!)"), path):
        raise HTTPException(status_code=404, detail="找不到此配對賽管理功能")
    token = request.headers.get("authorization", "").removeprefix("Bearer ") or request.query_params.get("token", "")
    upstream_path = "/api/game/goals" if path == "goals" else f"/api/admin/{path}"
    try:
        # The fixed destination and route allowlist prevent arbitrary proxy requests.
        response = requests.request(
            request.method, MATCHING_ORIGIN + upstream_path,
            params=[(key, value) for key, value in request.query_params.multi_items() if key != "token"],
            data=body or None,
            headers={"Authorization": f"Bearer platform:{token}", "Content-Type": "application/json"},
            timeout=(5, 25), allow_redirects=False,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="配對挑戰賽暫時無法連線，請稍後再試")
    if 300 <= response.status_code < 400:
        raise HTTPException(status_code=502, detail="配對挑戰賽回應異常，請稍後再試")
    headers = {key: value for key, value in response.headers.items() if key.lower() in ("content-type", "content-disposition")}
    return Response(content=response.content, status_code=response.status_code, headers=headers)
