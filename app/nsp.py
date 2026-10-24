"""NSP course authoring and per-account learning records in the activity database."""
import html
import json
import re
import uuid
import os
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urlsplit
import requests
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from app.database import get_db
from app.accounts import get_accounts_db
from app.auth import get_account_type
from app.year_scope import current_year_id


def now():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def web_url(value):
    if value and (urlsplit(value).scheme not in ("https", "http") or not urlsplit(value).hostname):
        raise ValueError("請使用 http 或 https 網址")
    return value


class SafeHTML(HTMLParser):
    tags = {"p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "a"}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.output = []
        self.blocked = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "iframe", "object", "svg", "math"):
            self.blocked += 1
        if self.blocked or tag not in self.tags:
            return
        attributes = ""
        if tag == "a":
            href = dict(attrs).get("href", "")
            try:
                valid = urlsplit(href).scheme in ("https", "http")
            except ValueError:
                valid = False
            if valid:
                attributes = ' href="' + html.escape(href, quote=True) + '" target="_blank" rel="noopener noreferrer"'
        self.output.append(f"<{tag}{attributes}>")
    def handle_endtag(self, tag):
        if tag in ("script", "style", "iframe", "object", "svg", "math"):
            self.blocked = max(0, self.blocked - 1)
            return
        if not self.blocked and tag in self.tags and tag != "br":
            self.output.append(f"</{tag}>")
    def handle_data(self, value):
        if not self.blocked:
            self.output.append(html.escape(value))


def clean_html(value):
    parser = SafeHTML()
    parser.feed(value)
    return "".join(parser.output)


_ready = set()


def initialize():
    from app import database as db
    key = (db.DB_PATH, os.getenv("TURSO_DATABASE_URL", ""))
    if key in _ready:
        return
    statements = [
        """CREATE TABLE IF NOT EXISTS nsp_terms (id INTEGER PRIMARY KEY AUTOINCREMENT, year_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(year_id,kind,name))""",
        """CREATE TABLE IF NOT EXISTS nsp_instructors (id INTEGER PRIMARY KEY AUTOINCREMENT, year_id INTEGER NOT NULL, name TEXT NOT NULL, staff_id INTEGER NOT NULL, bio TEXT NOT NULL, expertise TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS nsp_courses (id INTEGER PRIMARY KEY AUTOINCREMENT, year_id INTEGER NOT NULL, title TEXT NOT NULL, category_id INTEGER NOT NULL, cover_url TEXT NOT NULL, info_html TEXT NOT NULL, content_json TEXT NOT NULL, instructor_json TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS nsp_progress (year_id INTEGER NOT NULL, account_type TEXT NOT NULL, user_id INTEGER NOT NULL, course_id INTEGER NOT NULL, lesson_id TEXT NOT NULL, position REAL NOT NULL, watched REAL NOT NULL, completed INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(year_id,account_type,user_id,course_id,lesson_id))""",
        """CREATE TABLE IF NOT EXISTS nsp_bookmarks (year_id INTEGER NOT NULL, account_type TEXT NOT NULL, user_id INTEGER NOT NULL, course_id INTEGER NOT NULL, PRIMARY KEY(year_id,account_type,user_id,course_id))""",
    ]
    with get_db(unscoped=True) as conn:
        for sql in statements:
            conn.cursor().execute(sql)
        # Public category numbers are independent of the IDs used by course links.
        numbering = [
            """CREATE TABLE IF NOT EXISTS nsp_term_numbers (term_id INTEGER PRIMARY KEY, year_id INTEGER NOT NULL, kind TEXT NOT NULL, number INTEGER NOT NULL, UNIQUE(year_id,kind,number))""",
            """INSERT OR IGNORE INTO nsp_term_numbers (term_id,year_id,kind,number) SELECT id,year_id,kind,ROW_NUMBER() OVER (PARTITION BY year_id,kind ORDER BY id) FROM nsp_terms""",
            """CREATE TRIGGER IF NOT EXISTS nsp_term_number_on_insert AFTER INSERT ON nsp_terms BEGIN INSERT INTO nsp_term_numbers (term_id,year_id,kind,number) SELECT NEW.id,NEW.year_id,NEW.kind,COALESCE(MAX(number),0)+1 FROM nsp_term_numbers WHERE year_id=NEW.year_id AND kind=NEW.kind; END""",
        ]
        cursor = conn.cursor()
        if hasattr(cursor, "execute_transaction"):
            cursor.execute_transaction(numbering)
        else:
            cursor.execute("BEGIN IMMEDIATE")
            for sql in numbering:
                cursor.execute(sql)
        if "email" not in {r["name"] for r in cursor.execute("PRAGMA table_info(nsp_instructors)").fetchall()}:
            cursor.execute("ALTER TABLE nsp_instructors ADD COLUMN email TEXT NOT NULL DEFAULT ''")
        legacy = cursor.execute("SELECT id,staff_id FROM nsp_instructors WHERE email='' AND staff_id>0").fetchall()
        if legacy:
            with get_accounts_db() as accounts:
                emails = {r["id"]:r["email"] for r in accounts.cursor().execute("SELECT id,email FROM admin").fetchall()}
            for row in legacy:
                if row["staff_id"] in emails:
                    cursor.execute("UPDATE nsp_instructors SET email=? WHERE id=? AND email=''", (emails[row["staff_id"]], row["id"]))
    _ready.add(key)


def database():
    initialize()
    return get_db(unscoped=True)


class TermWrite(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class InstructorWrite(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=1, max_length=254)
    bio: str = Field(min_length=1, max_length=10000)
    expertise: str = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def validate_profile(self):
        self.email = self.email.strip()
        self.bio = self.bio.strip()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", self.email):
            raise ValueError("請填寫有效的電子郵件")
        if not self.bio:
            raise ValueError("請填寫講師簡介")
        return self


class Lesson(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    title: str = Field(min_length=1, max_length=250)
    url: str = Field(min_length=1, max_length=2000)
    duration: float = Field(default=0, ge=0, le=86400)


class Section(BaseModel):
    title: str = Field(min_length=1, max_length=250)
    lessons: list[Lesson] = Field(default_factory=list, max_length=200)


class Material(BaseModel):
    category_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=250)
    url: str = Field(min_length=1, max_length=2000)
    note: str = Field(default="", max_length=1000)


class CourseWrite(BaseModel):
    title: str = Field(min_length=1, max_length=250)
    category_id: int = Field(gt=0)
    cover_url: str = Field(default="", max_length=2000)
    info_html: str = Field(default="", max_length=100000)
    instructor_ids: list[int] = Field(default_factory=list, max_length=50)
    sections: list[Section] = Field(default_factory=list, max_length=100)
    materials: list[Material] = Field(default_factory=list, max_length=200)
    status: str = Field(default="draft", pattern=r"^(draft|published)$")
    version: int = 0

    @model_validator(mode="after")
    def validate_content(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("請填寫課程名稱")
        web_url(self.cover_url)
        self.info_html = clean_html(self.info_html)
        ids = []
        for section in self.sections:
            if not section.title.strip():
                raise ValueError("請填寫章節標題")
            for lesson in section.lessons:
                web_url(lesson.url)
                if not lesson.title.strip():
                    raise ValueError("請填寫課程影片標題")
                ids.append(lesson.id)
        if len(ids) != len(set(ids)):
            raise ValueError("影片編號重複，請重新載入課程")
        for material in self.materials:
            web_url(material.url)
        if self.status == "published" and (not self.cover_url or not re.sub(r"<[^>]*>", "", self.info_html).strip() or not self.instructor_ids or not ids or any(lesson.duration <= 0 for section in self.sections for lesson in section.lessons)):
            raise ValueError("發布前請填妥封面、課程資訊、講師、課程影片及影片長度")
        return self


class ProgressWrite(BaseModel):
    position: float = Field(ge=0, le=86400)
    watched_delta: float = Field(default=0, ge=0, le=30)


def identity(user):
    return (current_year_id.get(), get_account_type(user), user["user_id"])


def get_course(conn, course_id, user, admin=False):
    row = conn.cursor().execute("SELECT * FROM nsp_courses WHERE year_id=? AND id=?", (current_year_id.get(), course_id)).fetchone()
    if not row or (not admin and row["status"] != "published"):
        raise HTTPException(404, "找不到此學年度的課程")
    return course_data(row)


def course_data(row):
    result = dict(row)
    result.update(json.loads(result.pop("content_json")))
    result["instructor_ids"] = json.loads(result.pop("instructor_json"))
    return result


def install_nsp(app, require_user, require_admin):
    @app.get("/api/nsp/admin/options")
    def options(user=Depends(require_admin)):
        with database() as conn:
            terms = [dict(r) for r in conn.cursor().execute("SELECT t.*,n.number FROM nsp_terms t JOIN nsp_term_numbers n ON n.term_id=t.id WHERE t.year_id=? ORDER BY t.id", (current_year_id.get(),)).fetchall()]
            instructors = [dict(r) for r in conn.cursor().execute("SELECT * FROM nsp_instructors WHERE year_id=? ORDER BY id", (current_year_id.get(),)).fetchall()]
        return {"terms": terms, "instructors": instructors}

    @app.get("/api/nsp/admin/catalog")
    def catalog(request: Request, user=Depends(require_admin)):
        # The attendance module verifies the same token and selected academic year.
        try:
            response = requests.get("https://sdgs-attendance-record.vercel.app/api/admin/courses/catalog", headers={"Authorization": request.headers.get("authorization", "")}, timeout=(5, 20))
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            raise HTTPException(503, "原課程清單暫時無法讀取，可選「其他」輸入課程名稱") from error

    def term_kind(kind):
        if kind not in ("course", "material"):
            raise HTTPException(404, "找不到此分類")

    @app.post("/api/nsp/admin/terms/{kind}")
    def add_term(kind: str, req: TermWrite, user=Depends(require_admin)):
        term_kind(kind)
        name = req.name.strip()
        if not name:
            raise HTTPException(400, "請填寫分類名稱")
        with database() as conn:
            if conn.cursor().execute("SELECT id FROM nsp_terms WHERE year_id=? AND kind=? AND name=?", (current_year_id.get(), kind, name)).fetchone():
                raise HTTPException(409, "分類名稱已存在")
            conn.cursor().execute("INSERT INTO nsp_terms (year_id,kind,name,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)", (current_year_id.get(), kind, name, user["email"], now(), user["email"], now()))
        return {"success": True}

    @app.put("/api/nsp/admin/terms/{kind}/{item_id}")
    def edit_term(kind: str, item_id: int, req: TermWrite, user=Depends(require_admin)):
        term_kind(kind)
        if not req.name.strip():
            raise HTTPException(400, "請填寫分類名稱")
        with database() as conn:
            row = conn.cursor().execute("SELECT id FROM nsp_terms WHERE year_id=? AND kind=? AND id=?", (current_year_id.get(), kind, item_id)).fetchone()
            if not row:
                raise HTTPException(404, "找不到分類")
            if conn.cursor().execute("SELECT id FROM nsp_terms WHERE year_id=? AND kind=? AND name=? AND id<>?", (current_year_id.get(), kind, req.name.strip(), item_id)).fetchone():
                raise HTTPException(409, "分類名稱已存在")
            conn.cursor().execute("UPDATE nsp_terms SET name=?,updated_by=?,updated_at=? WHERE year_id=? AND id=?", (req.name.strip(), user["email"], now(), current_year_id.get(), item_id))
        return {"success": True}

    @app.post("/api/nsp/admin/instructors")
    def add_instructor(req: InstructorWrite, user=Depends(require_admin)):
        return save_instructor(req, user)

    @app.put("/api/nsp/admin/instructors/{item_id}")
    def edit_instructor(item_id: int, req: InstructorWrite, user=Depends(require_admin)):
        return save_instructor(req, user, item_id)

    def save_instructor(req, user, item_id=None):
        if not req.name.strip() or not req.expertise.strip():
            raise HTTPException(400, "請填寫講師名稱與專長")
        with database() as conn:
            if item_id is None:
                conn.cursor().execute("INSERT INTO nsp_instructors (year_id,name,staff_id,email,bio,expertise,created_by,created_at,updated_by,updated_at) VALUES (?,?,0,?,?,?,?,?,?,?)", (current_year_id.get(), req.name.strip(), req.email, req.bio, req.expertise.strip(), user["email"], now(), user["email"], now()))
            else:
                if not conn.cursor().execute("SELECT id FROM nsp_instructors WHERE year_id=? AND id=?", (current_year_id.get(), item_id)).fetchone():
                    raise HTTPException(404, "找不到講師")
                conn.cursor().execute("UPDATE nsp_instructors SET name=?,email=?,bio=?,expertise=?,updated_by=?,updated_at=? WHERE year_id=? AND id=?", (req.name.strip(), req.email, req.bio, req.expertise.strip(), user["email"], now(), current_year_id.get(), item_id))
        return {"success": True}

    @app.get("/api/nsp/admin/courses")
    def admin_courses(user=Depends(require_admin)):
        with database() as conn:
            return [course_data(row) for row in conn.cursor().execute("SELECT * FROM nsp_courses WHERE year_id=? ORDER BY id DESC", (current_year_id.get(),)).fetchall()]

    @app.post("/api/nsp/admin/courses")
    def add_course(req: CourseWrite, user=Depends(require_admin)):
        return save_course(req, user)

    @app.put("/api/nsp/admin/courses/{course_id}")
    def edit_course(course_id: int, req: CourseWrite, user=Depends(require_admin)):
        return save_course(req, user, course_id)

    def save_course(req, user, course_id=None):
        year = current_year_id.get()
        with database() as conn:
            terms = {r[0]: r[1] for r in conn.cursor().execute("SELECT id,kind FROM nsp_terms WHERE year_id=?", (year,)).fetchall()}
            if terms.get(req.category_id) != "course" or any(terms.get(m.category_id) != "material" for m in req.materials):
                raise HTTPException(400, "請選擇此學年度的課程及教材分類")
            valid = {r[0] for r in conn.cursor().execute("SELECT id FROM nsp_instructors WHERE year_id=?", (year,)).fetchall()}
            if any(i not in valid for i in req.instructor_ids):
                raise HTTPException(400, "請選擇此學年度的講師")
            data = json.dumps({"sections": [s.model_dump() for s in req.sections], "materials": [m.model_dump() for m in req.materials]}, ensure_ascii=False)
            values = (req.title, req.category_id, req.cover_url, req.info_html, data, json.dumps(list(dict.fromkeys(req.instructor_ids))), req.status)
            if course_id is None:
                cursor = conn.cursor()
                cursor.execute("INSERT INTO nsp_courses (year_id,title,category_id,cover_url,info_html,content_json,instructor_json,status,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (year, *values, user["email"], now(), user["email"], now()))
                course_id = int(cursor.lastrowid)
            else:
                previous = get_course(conn, course_id, user, True)
                if previous["version"] != req.version:
                    raise HTTPException(409, "課程已由其他管理員修改，請重新載入後編輯")
                cursor = conn.cursor()
                cursor.execute("UPDATE nsp_courses SET title=?,category_id=?,cover_url=?,info_html=?,content_json=?,instructor_json=?,status=?,version=version+1,updated_by=?,updated_at=? WHERE year_id=? AND id=? AND version=?", (*values, user["email"], now(), year, course_id, req.version))
                if cursor.rowcount != 1:
                    raise HTTPException(409, "課程已更新，請重新載入")
                changed = {l["id"]: (l["url"], l["duration"]) for s in previous["sections"] for l in s["lessons"]}
                for section in req.sections:
                    for lesson in section.lessons:
                        if lesson.id in changed and changed[lesson.id] != (lesson.url, lesson.duration):
                            conn.cursor().execute("DELETE FROM nsp_progress WHERE year_id=? AND course_id=? AND lesson_id=?", (year, course_id, lesson.id))
        return {"success": True, "id": course_id}

    @app.delete("/api/nsp/admin/{kind}/{item_id}")
    def delete_item(kind: str, item_id: int, user=Depends(require_admin)):
        tables = {"courses": "nsp_courses", "instructors": "nsp_instructors", "terms": "nsp_terms"}
        if kind not in tables:
            raise HTTPException(404, "找不到此項目")
        with database() as conn:
            if not conn.cursor().execute(f"SELECT id FROM {tables[kind]} WHERE year_id=? AND id=?", (current_year_id.get(), item_id)).fetchone():
                raise HTTPException(404, "找不到此項目")
            if kind != "courses":
                for r in conn.cursor().execute("SELECT category_id,instructor_json,content_json FROM nsp_courses WHERE year_id=?", (current_year_id.get(),)).fetchall():
                    if (kind == "instructors" and item_id in json.loads(r[1])) or (kind == "terms" and (r[0] == item_id or any(m["category_id"] == item_id for m in json.loads(r[2])["materials"]))):
                        raise HTTPException(409, "此項目仍被課程使用，請先修改課程")
            conn.cursor().execute(f"DELETE FROM {tables[kind]} WHERE year_id=? AND id=?", (current_year_id.get(), item_id))
            if kind == "courses":
                for table in ("nsp_progress", "nsp_bookmarks"):
                    conn.cursor().execute(f"DELETE FROM {table} WHERE year_id=? AND course_id=?", (current_year_id.get(), item_id))
        return {"success": True}

    @app.get("/api/nsp/courses")
    def courses(user=Depends(require_user)):
        with database() as conn:
            result = []
            terms = {r[0]: r[1] for r in conn.cursor().execute("SELECT id,name FROM nsp_terms WHERE year_id=?", (current_year_id.get(),)).fetchall()}
            teachers = {r[0]: r[1] for r in conn.cursor().execute("SELECT id,name FROM nsp_instructors WHERE year_id=?", (current_year_id.get(),)).fetchall()}
            records = [dict(r) for r in conn.cursor().execute("SELECT course_id,lesson_id,position,watched,completed FROM nsp_progress WHERE year_id=? AND account_type=? AND user_id=?", identity(user)).fetchall()]
            learners = {r[0]: r[1] for r in conn.cursor().execute("SELECT course_id,COUNT(*) FROM (SELECT DISTINCT course_id,account_type,user_id FROM nsp_progress WHERE year_id=?) GROUP BY course_id", (current_year_id.get(),)).fetchall()}
            bookmarks = {r[0] for r in conn.cursor().execute("SELECT course_id FROM nsp_bookmarks WHERE year_id=? AND account_type=? AND user_id=?", identity(user)).fetchall()}
            for row in conn.cursor().execute("SELECT * FROM nsp_courses WHERE year_id=? AND status='published' ORDER BY id", (current_year_id.get(),)).fetchall():
                course = course_data(row)
                progress = [r for r in records if r["course_id"] == course["id"]]
                lesson_ids = {l["id"] for s in course["sections"] for l in s["lessons"]}
                done = sum(p["completed"] for p in progress if p["lesson_id"] in lesson_ids)
                course.update(category=terms.get(course["category_id"], ""), instructors=[teachers[i] for i in course["instructor_ids"] if i in teachers], progress=progress, total=len(lesson_ids), completed=done, percent=round(done / len(lesson_ids) * 100) if lesson_ids else 0)
                course["learners"] = learners.get(course["id"], 0)
                course["bookmarked"] = course["id"] in bookmarks
                course["material_categories"] = terms
                result.append(course)
            return result

    @app.put("/api/nsp/courses/{course_id}/progress/{lesson_id}")
    def progress(course_id: int, lesson_id: str, req: ProgressWrite, user=Depends(require_user)):
        with database() as conn:
            course = get_course(conn, course_id, user)
            lesson = next((l for s in course["sections"] for l in s["lessons"] if l["id"] == lesson_id), None)
            if not lesson:
                raise HTTPException(404, "找不到此影片")
            key = (*identity(user), course_id, lesson_id)
            duration = lesson["duration"]
            delta = min(duration, req.watched_delta)
            conn.cursor().execute("INSERT INTO nsp_progress VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(year_id,account_type,user_id,course_id,lesson_id) DO UPDATE SET position=excluded.position,watched=MIN(?,nsp_progress.watched+excluded.watched),completed=MAX(nsp_progress.completed,CASE WHEN ?>0 AND nsp_progress.watched+excluded.watched>=?*.9 THEN 1 ELSE 0 END),updated_at=excluded.updated_at", (*key, min(req.position, duration), delta, int(duration > 0 and delta >= duration*.9), now(), duration, duration, duration))
            saved = conn.cursor().execute("SELECT watched,completed FROM nsp_progress WHERE year_id=? AND account_type=? AND user_id=? AND course_id=? AND lesson_id=?", key).fetchone()
            watched, completed = saved[0], saved[1]
        return {"success": True, "watched": watched, "completed": completed}

    @app.put("/api/nsp/courses/{course_id}/bookmark")
    def bookmark(course_id: int, user=Depends(require_user)):
        with database() as conn:
            get_course(conn, course_id, user)
            key = (*identity(user), course_id)
            exists = conn.cursor().execute("SELECT 1 FROM nsp_bookmarks WHERE year_id=? AND account_type=? AND user_id=? AND course_id=?", key).fetchone()
            if exists:
                conn.cursor().execute("DELETE FROM nsp_bookmarks WHERE year_id=? AND account_type=? AND user_id=? AND course_id=?", key)
            else:
                conn.cursor().execute("INSERT INTO nsp_bookmarks VALUES (?,?,?,?)", key)
        return {"bookmarked": not bool(exists)}
