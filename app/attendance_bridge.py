"""Keep the existing course tools inside the unified, authenticated console."""
import re
import time
import requests
from fastapi import Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from starlette.concurrency import run_in_threadpool

ORIGIN = "https://sdgs-attendance-record.vercel.app"
PREFIX = "/attendance-admin"
COOKIE = "attendance_admin_session"
ROUTES = {
    "GET": r"(?:admin(?:/courses/\d+/(?:attendance|leaves|pathdemy)|/students/\d+/dashboard)?|api/admin/(?:courses|pathdemy)/sample-excel|api/admin/courses/\d+/pathdemy/sample-excel|api/admin/courses/\d+/(?:attendance|leaves|pathdemy)/export|static/css/(?:design-system|attendance)\.css|static/js/attendance-dashboard\.js)",
    "POST": r"api/admin/(?:courses(?:/import|/\d+/pathdemy/import)?|attendance/students/\d+/(?:checkin|leave|makeup))",
    "PUT": r"api/admin/courses/\d+",
    "DELETE": r"api/admin/courses/\d+(?:/(?:leaves|pathdemy)/\d+)?",
}


def proxy_course_request(request, path, body, token):
    if not re.fullmatch(ROUTES.get(request.method, r"(?!)"), path):
        raise HTTPException(404, "找不到此課程管理功能")
    try:
        upstream = requests.request(request.method, ORIGIN + "/" + path,
            params=[(key, value) for key, value in request.query_params.multi_items() if key != "token"],
            headers={"Authorization": "Bearer " + token, "X-Platform-Embedded": "1",
                     "Content-Type": request.headers.get("content-type", "application/json")},
            data=body or None, timeout=(5, 30), allow_redirects=False)
    except requests.RequestException as error:
        raise HTTPException(503, "課程管理暫時無法連線，請稍後重試") from error
    if 300 <= upstream.status_code < 400:
        raise HTTPException(401, "課程管理登入已失效，請重新登入系統")
    headers = {key: value for key, value in upstream.headers.items()
               if key.lower() in {"content-type", "content-disposition"}}
    headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    if path.startswith("static/css/"):
        headers["Cache-Control"] = "public, max-age=3600"
    content = upstream.content
    if path.startswith("static/css/"):
        content = content.decode("utf-8").replace("/static/images/", ORIGIN + "/static/images/").encode("utf-8")
    if "text/html" in upstream.headers.get("Content-Type", ""):
        html = content.decode("utf-8")
        # Both navigation links and the original inline fetch calls stay in this gateway.
        html = re.sub(r'''(["'`])(/(?:admin|api/admin|static/(?:css|js))(?=[/"'`?]))''',
                      lambda match: match[1] + PREFIX + match[2], html)
        if path == "admin":
            html = html.replace("location.reload()", "location.replace('/attendance-admin/admin')")
        content = html.encode("utf-8")
    return Response(content, status_code=upstream.status_code, headers=headers)


def install_attendance_admin(app, require_admin, get_current_user):
    def open_view(request, user, path):
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        response = proxy_course_request(request, path, b"", token)
        if response.status_code == 404:
            raise HTTPException(404, "此學年度查無此學員" if path.startswith("admin/students/") else "此學年度查無此課程")
        if response.status_code != 200 or "text/html" not in response.headers.get("content-type", ""):
            raise HTTPException(503, "原課程後台暫時無法載入，請稍後重試")
        response.set_cookie(COOKIE, token, path=PREFIX, httponly=True,
                            secure=request.url.scheme == "https", samesite="strict",
                            max_age=max(0, int(user["exp"] - time.time())))
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/attendance-admin/view")
    def start_session(request: Request, user=Depends(require_admin)):
        return open_view(request, user, "admin")

    @app.get("/api/attendance-admin/students/{student_id}/view")
    def student_view(student_id: int, request: Request, user=Depends(require_admin)):
        return open_view(request, user, f"admin/students/{student_id}/dashboard")

    @app.get("/api/attendance-admin/courses/{course_id}/makeup/view")
    def makeup_view(course_id: int, request: Request, user=Depends(require_admin)):
        response = open_view(request, user, f"admin/courses/{course_id}/pathdemy")
        response.body = response.body.replace(b'onclick="history.back()"', b"onclick=\"parent.postMessage({type:'nsp-makeup-close'},parent.location.origin)\"")
        response.headers["content-length"] = str(len(response.body))
        return response

    @app.api_route(PREFIX + "/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def course_admin(request: Request, path: str):
        if request.method == "GET" and path.startswith("static/css/"):
            return await run_in_threadpool(proxy_course_request, request, path, b"", "")
        token = request.cookies.get(COOKIE, "")
        user = await run_in_threadpool(get_current_user, authorization="Bearer " + token, token=None)
        if not user:
            if path.startswith("admin"):
                return HTMLResponse('<p>登入已失效，請重新登入系統。</p><script>parent.postMessage({type:"attendance-admin-expired"},location.origin)</script>',
                                    status_code=401, headers={"Cache-Control": "no-store"})
            raise HTTPException(401, "請先登入系統")
        if user.get("role") not in {"admin", "teacher"}:
            raise HTTPException(403, "需要管理員或講師權限")
        if request.method != "GET" and request.headers.get("origin") != str(request.base_url).rstrip("/"):
            raise HTTPException(403, "不允許跨網站修改課程資料")
        return await run_in_threadpool(proxy_course_request, request, path, await request.body(), token)
