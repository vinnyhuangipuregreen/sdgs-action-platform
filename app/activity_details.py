"""Structured activity plans and outcomes and their readable exports."""
import json
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

PLAN_FIELDS = {
    "purpose": "1. 活動目的與理念", "process": "2. 活動流程與內容",
    "features": "3. 活動創意與特色", "audience": "4. 預計參與對象",
}
RESULT_FIELDS = {
    "participants": "實際參與人數", "volunteers": "服務義工人數",
    "results": "5. 活動成果與效益", "feedback": "6. 參與者回饋與感受",
    "improvements": "7. 檢討與改善建議",
}
TEMPLATE_FIELDS = {**PLAN_FIELDS, **RESULT_FIELDS}


class ActivityDetails(BaseModel):
    phase: Literal["before", "after"] = "before"
    name: str = ""
    start_date: str = ""
    end_date: str = ""
    purpose: str = ""
    process: str = ""
    features: str = ""
    audience: str = ""
    participants: Optional[int] = Field(default=None, ge=0)
    volunteers: Optional[int] = Field(default=None, ge=0)
    results: str = ""
    feedback: str = ""
    improvements: str = ""

    @model_validator(mode="after")
    def require_plan_fields(self):
        if bool(self.start_date) != bool(self.end_date):
            raise ValueError("請完整填寫活動開始與結束日期。")
        for value in (self.start_date, self.end_date):
            if value:
                try:
                    valid = date.fromisoformat(value).isoformat() == value
                except ValueError:
                    valid = False
                if not valid:
                    raise ValueError("活動日期請填寫有效的西元年、月、日。")
        if self.start_date > self.end_date:
            raise ValueError("活動結束日期不可早於開始日期。")
        for field, label in PLAN_FIELDS.items():
            if not getattr(self, field).strip():
                raise ValueError(f"請填寫{label}！")
        return self

def activity_text(details):
    if isinstance(details, str):
        details = json.loads(details)
    if not details:
        return ""
    lines = [f"活動日期區間：{details.get('start_date') or '未填寫'} ～ {details.get('end_date') or '未填寫'}",
             "活動前｜規劃" if details.get("phase") == "before" else "活動後｜成果", f"活動名稱：{details.get('name', '')}"]
    fields = {**PLAN_FIELDS, **(RESULT_FIELDS if details.get("phase") == "after" else {})}
    lines.extend(f"{label}：{details.get(field) if details.get(field) is not None else ''}" for field, label in fields.items())
    return "\n".join(lines)
