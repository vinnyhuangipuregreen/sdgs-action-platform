import unittest
from unittest.mock import patch
from app import database
from app.auth import decode_access_token
from app.year_scope import scoped_sql, MODULE_TABLES, current_year_id
from tests import test_activity_details as fixtures
from app import sdgs_check


class AcademicYearTests(unittest.TestCase):
    headers = fixtures.ActivityDetailsTests.headers

    def setUp(self):
        fixtures.ActivityDetailsTests.setUp(self)
        self.users_patch = patch.object(sdgs_check,'_USERS_VERIFIED',True)
        self.goals_patch = patch.object(sdgs_check,'_SDGS_VERIFIED',False)
        self.users_patch.start(); self.goals_patch.start()

    def tearDown(self):
        self.users_patch.stop(); self.goals_patch.stop()
        fixtures.ActivityDetailsTests.tearDown(self)

    def create_year(self):
        with patch('app.academic_years.module_call', return_value={}):
            response = self.client.post('/api/admin/academic-years', headers=self.admin,
                json={'year':2027,'start_month':'202709','end_month':'202806','source_id':1})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()['id']

    def switch(self, year_id):
        response = self.client.post(f'/api/auth/academic-year/{year_id}',headers=self.admin)
        self.assertEqual(response.status_code,200,response.text)
        token=response.json()['token']
        self.assertEqual(decode_access_token(token)['academic_year_id'],year_id)
        return {'Authorization':'Bearer '+token}

    def test_old_data_keeps_ids_new_year_copies_materials_but_no_records_or_roster(self):
        self.client.get('/api/sdgs/goals')
        self.assertEqual(self.client.post('/api/worksheets',headers=self.student,json=self.payload).status_code,200)
        new_id=self.create_year()
        headers=self.switch(new_id)
        self.assertEqual(len(self.client.get('/api/sdgs/goals',headers=headers).json()),17)
        self.assertEqual(self.client.get('/api/worksheets',headers=headers).json(),[])
        self.assertEqual(self.client.get('/api/admin/students',headers=headers).json()['total'],0)
        self.assertEqual(len(self.client.get('/api/worksheets',headers=self.student).json()),1)
        rejected=self.client.get('/api/worksheets/1',headers=headers)
        self.assertEqual(rejected.status_code,404)
        self.assertEqual(self.client.get('/api/worksheets',headers={**self.student,'X-Academic-Year':str(new_id)}).status_code,403)
        with database.get_db(unscoped=True) as conn:
            self.assertEqual(conn.execute('SELECT id FROM worksheets').fetchone()[0],1)

    def test_shared_account_must_enroll_and_annual_removal_does_not_delete_account(self):
        self.client.get('/api/academic-years')
        new_id=self.create_year()
        login={'account':'test@example.invalid','password':'000','academic_year_id':new_id}
        self.assertEqual(self.client.post('/api/auth/login',json=login).status_code,403)
        admin=self.switch(new_id)
        response=self.client.post('/api/admin/students',headers=admin,json={'name':'Test','email':'test@example.invalid','phone':'000'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['id'],1)
        logged=self.client.post('/api/auth/login',json=login)
        self.assertEqual(logged.status_code,200,logged.text)
        self.assertEqual(logged.json()['user']['academic_year']['id'],new_id)
        changed=self.client.put('/api/admin/students/1',headers=admin,json={'name':'Test','email':'test@example.invalid','phone':'000','unit_name':'2027 專用分會'})
        self.assertEqual(changed.status_code,200,changed.text)
        self.assertEqual(self.client.get('/api/admin/students',headers=admin).json()['items'][0]['unit_name'],'2027 專用分會')
        self.assertEqual(self.client.get('/api/admin/students',headers=self.admin).json()['items'][0]['unit_name'],'佛光學員')
        self.assertEqual(self.client.delete('/api/admin/students/1',headers=admin).status_code,200)
        self.assertEqual(self.client.post('/api/auth/login',json=login).status_code,403)
        login['academic_year_id']=1
        self.assertEqual(self.client.post('/api/auth/login',json=login).status_code,200)

    def test_topic_rename_triggers_remain_isolated_in_new_year(self):
        new_id=self.create_year()
        with database.get_db(unscoped=True) as conn:
            conn.execute("INSERT INTO ay2_action_catalog (category,name) VALUES ('年度主題','年度活動')")
            self.assertIsNotNone(conn.execute("SELECT id FROM ay2_action_topics WHERE name='年度主題'").fetchone())
            conn.execute("UPDATE ay2_action_topics SET name='新年度主題' WHERE name='年度主題'")
            self.assertEqual(conn.execute("SELECT category FROM ay2_action_catalog WHERE name='年度活動'").fetchone()[0],'新年度主題')
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM action_topics WHERE name='新年度主題'").fetchone()[0],0)

    def test_sso_ticket_preserves_year_and_annual_student_profile(self):
        import base64
        import hashlib
        from app.academic_years import enroll
        new_id=self.create_year()
        enroll(new_id,1,{'name':'Test','phone':'000','unit_name':'次年度分會'})
        switched=self.client.post(f'/api/auth/academic-year/{new_id}',headers=self.student)
        self.assertEqual(switched.status_code,200,switched.text)
        verifier='a'*43
        client={'client_id':'attendance','redirect_uri':'https://sdgs-attendance-record.vercel.app/auth/sso/callback'}
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        issued=self.client.post('/api/auth/sso/ticket',headers={'Authorization':'Bearer '+switched.json()['token']},json={**client,'code_challenge':challenge})
        self.assertEqual(issued.status_code,200,issued.text)
        exchanged=self.client.post('/api/auth/sso/exchange',json={**client,'code_verifier':verifier,'code':issued.json()['code']})
        self.assertEqual(exchanged.status_code,200,exchanged.text)
        self.assertEqual(exchanged.json()['user']['academic_year']['id'],new_id)
        self.assertEqual(exchanged.json()['user']['unit_name'],'次年度分會')
        self.assertEqual(decode_access_token(exchanged.json()['access_token'])['academic_year_id'],new_id)

    def test_year_deletion_reports_related_records_and_fails_closed_on_module_error(self):
        self.client.get('/api/sdgs/goals')
        with patch('app.academic_years.module_call',return_value={'[課程登錄]課程資料':18}):
            response=self.client.delete('/api/admin/academic-years/1',headers=self.admin)
        self.assertEqual(response.status_code,409,response.text)
        self.assertIn('18筆',response.json()['detail'])
        self.assertIn('目標資料',response.json()['detail'])

    def test_sql_mapping_never_changes_literals_comments_or_identity_tables(self):
        sql="SELECT * FROM worksheets JOIN student ON student.id=worksheets.user_id WHERE chat_text='worksheets' -- worksheets"
        mapped=scoped_sql(sql,2,MODULE_TABLES)
        self.assertIn('FROM ay2_worksheets JOIN student',mapped)
        self.assertIn("chat_text='worksheets' -- worksheets",mapped)
        self.assertEqual(current_year_id.get(),1)

    def test_year_validation_duplicate_year_and_module_outage(self):
        from fastapi import HTTPException
        invalid={'year':2051,'start_month':'205109','end_month':'205206'}
        self.assertEqual(self.client.post('/api/admin/academic-years',headers=self.admin,json=invalid).status_code,422)
        invalid={'year':2027,'start_month':'202709','end_month':'202706'}
        self.assertEqual(self.client.post('/api/admin/academic-years',headers=self.admin,json=invalid).status_code,422)
        self.create_year()
        duplicate={'year':2027,'start_month':'202709','end_month':'202806'}
        self.assertEqual(self.client.post('/api/admin/academic-years',headers=self.admin,json=duplicate).status_code,409)
        with patch('app.academic_years.module_call',side_effect=HTTPException(503,'offline')):
            self.assertEqual(self.client.delete('/api/admin/academic-years/1',headers=self.admin).status_code,503)

    def test_partial_initialization_is_hidden_and_retry_reuses_its_id(self):
        from fastapi import HTTPException
        payload={'year':2027,'start_month':'202709','end_month':'202806'}
        with patch('app.academic_years.module_call',side_effect=HTTPException(503,'offline')):
            response=self.client.post('/api/admin/academic-years',headers=self.admin,json=payload)
        self.assertEqual(response.status_code,503)
        self.assertEqual([row['year'] for row in self.client.get('/api/academic-years').json()],[2026])
        with patch('app.academic_years.module_call',return_value={'success':True}):
            response=self.client.post('/api/admin/academic-years',headers=self.admin,json=payload)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['id'],2)
