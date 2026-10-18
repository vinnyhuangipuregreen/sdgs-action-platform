import csv
import io
import json
from pathlib import Path
from docx import Document
from tests import test_activity_description as legacy
from app import database


class ActivityPlanningTests(legacy.ActivityDescriptionTests):
    def plan(self, phase="before"):
        return {"phase":phase,"name":"社區活動","purpose":"目的","process":"流程","features":"特色","audience":"親子"}

    def test_plan_and_results_round_trip_to_admin_csv_and_word(self):
        details = {**self.plan("after"), "participants":0, "volunteers":3,
                   "results":"實際成果", "feedback":"參與者意見", "improvements":"下次改善"}
        self.payload.pop("activity_description")
        self.payload["activity_details"] = details
        worksheet_id = self.save()
        url = f"/api/worksheets/{worksheet_id}"
        loaded = self.client.get(url,headers=self.admin).json()
        self.assertEqual(loaded["activity_details"]["participants"], 0)
        self.assertEqual(loaded["activity_details"]["results"], "實際成果")
        self.assertIn("活動後｜成果",loaded["activity_description"])
        self.assertIn("實際參與人數：0",loaded["activity_description"])
        rows = list(csv.DictReader(io.StringIO(self.client.get("/api/admin/export/csv",headers=self.admin).content.decode("utf-8-sig").lstrip("\ufeff"))))
        self.assertEqual(json.loads(rows[0]["活動規劃與成果資料"])["feedback"], "參與者意見")
        document = Document(io.BytesIO(self.client.get(url+"/export-docx",headers=self.admin).content))
        self.assertIn(loaded["activity_description"],[p.text for p in document.paragraphs])
        self.payload["activity_details"] = self.plan()
        self.assertEqual(self.client.put(url,headers=self.student,json=self.payload).status_code,200)
        self.assertEqual(self.client.get(url,headers=self.student).json()["activity_details"]["phase"],"before")

    def test_four_plan_fields_are_required_and_counts_reject_negative_values(self):
        for field in ("purpose","process","features","audience"):
            payload = {**self.payload,"activity_details":{**self.plan(),field:" \n "}}
            self.assertEqual(self.client.post("/api/worksheets",headers=self.student,json=payload).status_code,422,field)
        for field in ("participants","volunteers"):
            payload = {**self.payload,"activity_details":{**self.plan("after"),field:-1}}
            self.assertEqual(self.client.post("/api/worksheets",headers=self.student,json=payload).status_code,422)

    def test_templates_are_seeded_exactly_and_admin_updates_are_not_reseeded(self):
        source = json.loads((Path(__file__).resolve().parent.parent/"data/activity_templates.json").read_text(encoding="utf-8"))
        catalog = self.client.get("/api/center-actions").json()
        self.assertEqual(len(source),30)
        for item in source:
            actual = next(row for row in catalog if (row["category"],row["name"]) == (item["category"],item["name"]))
            self.assertEqual(actual["template"], item["template"])
        item = catalog[0]
        edited = {"category":item["category"],"name":item["name"],"template":{**item["template"],"purpose":"後台修訂範本"}}
        response = self.client.put(f"/api/admin/categories/{item['id']}",headers=self.admin,json=edited)
        self.assertEqual(response.status_code,200,response.text)
        database._DB_INITIALIZED = False
        database.init_db()
        self.assertEqual(self.client.get("/api/center-actions").json()[0]["template"]["purpose"],"後台修訂範本")
        exported = self.client.get("/api/admin/categories/export.xlsx",headers=self.admin)
        imported = self.client.post("/api/admin/categories/import",headers=self.admin,files={"file":("categories.xlsx",exported.content)})
        self.assertEqual(imported.status_code,200,imported.text)
        self.assertEqual(self.client.get("/api/center-actions").json()[0]["template"]["purpose"],"後台修訂範本")
