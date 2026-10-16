"""Database-backed center actions and the two-column XLSX interchange format."""
import io
import json
import unicodedata
from zipfile import ZipFile

from fastapi import HTTPException
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from pydantic import BaseModel, Field, ValidationError

from app.database import get_db, init_db


class CategoryItem(BaseModel):
    model_config = {"str_strip_whitespace": True}
    category: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=300)


def list_actions(search=""):
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, category, name FROM action_catalog ORDER BY id")
        items = [dict(row) for row in cursor.fetchall()]
    terms = unicodedata.normalize("NFKC", search).casefold().split()
    return [item for item in items if all(
        term in unicodedata.normalize("NFKC", f"{item['category']} {item['name']}").casefold()
        for term in terms
    )]


def save_action(item, item_id=None):
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()
        if item_id is None:
            cursor.execute("INSERT OR IGNORE INTO action_catalog (category, name) VALUES (?, ?) RETURNING id",
                           (item.category, item.name))
        else:
            cursor.execute("SELECT id FROM action_catalog WHERE id = ?", (item_id,))
            if not cursor.fetchone():
                raise HTTPException(404, "找不到此分類項目，請重新整理")
            cursor.execute("UPDATE OR IGNORE action_catalog SET category = ?, name = ? WHERE id = ? RETURNING id",
                           (item.category, item.name, item_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(409, "相同主題類別與活動內容已存在")
        return {"id": int(row[0]), **item.model_dump()}


def delete_action(item_id):
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM action_catalog WHERE id = ? RETURNING id", (item_id,))
        if not cursor.fetchone():
            raise HTTPException(404, "找不到此分類項目，請重新整理")


def read_import(content):
    if not content or len(content) > 2 * 1024 * 1024:
        raise HTTPException(400, "請上傳 2 MB 以內的 XLSX 檔案")
    try:
        with ZipFile(io.BytesIO(content)) as archive:
            if sum(entry.file_size for entry in archive.infolist()) > 20 * 1024 * 1024:
                raise HTTPException(400, "檔案解壓縮後過大，請減少資料筆數")
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=False)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "無法讀取檔案，請使用有效的 XLSX 格式")
    try:
        sheet = workbook.worksheets[0]
        rows = sheet.iter_rows(max_col=2)
        header = next(rows, ())
        if [str(cell.value or "").strip() for cell in header] != ["主題類別", "活動內容"]:
            raise HTTPException(400, "第一張工作表的 A1、B1 須為「主題類別」、「活動內容」")
        items = []
        for number, cells in enumerate(rows, 2):
            if number > 2001:
                raise HTTPException(400, "每次最多匯入 2,000 列資料")
            if all(cell.value is None or str(cell.value).strip() == "" for cell in cells):
                continue
            if any(cell.data_type == "f" for cell in cells):
                raise HTTPException(400, f"第 {number} 列含有公式，請先轉為純文字")
            try:
                item = CategoryItem(category=cells[0].value, name=cells[1].value)
            except ValidationError:
                raise HTTPException(400, f"第 {number} 列資料無效：兩欄皆須為文字且不可空白，類別最多 80 字、活動最多 300 字")
            items.append(item.model_dump())
        if not items:
            raise HTTPException(400, "檔案沒有可匯入的分類項目")
        return items
    finally:
        workbook.close()


def import_actions(items):
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()
        # One SQL statement keeps the import atomic on SQLite and Turso alike.
        cursor.execute("""INSERT OR IGNORE INTO action_catalog (category, name)
            SELECT json_extract(value, '$.category'), json_extract(value, '$.name')
            FROM json_each(?) RETURNING id""", (json.dumps(items, ensure_ascii=False),))
        imported = len(cursor.fetchall())
    return {"imported_count": imported, "skipped_count": len(items) - imported}


def export_actions():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "分類"
    sheet.append(["主題類別", "活動內容"])
    for item in list_actions():
        sheet.append([item["category"], item["name"]])
    for row in sheet:
        for cell in row:
            cell.data_type = "s"  # Activity text must never become an Excel formula.
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="047857")
    sheet.column_dimensions["A"].width = 24
    sheet.column_dimensions["B"].width = 70
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)
    return output
