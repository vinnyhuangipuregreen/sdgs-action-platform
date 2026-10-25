import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from app import database
from app.nsp import initialize
from tests import test_academic_years as fixtures


class NspTests(unittest.TestCase):
    def setUp(self):
        fixtures.AcademicYearTests.setUp(self)
        response = SimpleNamespace(raise_for_status=lambda:None, json=lambda:[])
        counts_patch = patch('app.nsp.requests.get', return_value=response)
        counts_patch.start()
        self.addCleanup(counts_patch.stop)
        sync_patch = patch('app.nsp.requests.post', return_value=response)
        self.sync_mock = sync_patch.start()
        self.addCleanup(sync_patch.stop)
    tearDown = fixtures.AcademicYearTests.tearDown
    headers = fixtures.AcademicYearTests.headers
    create_year = fixtures.AcademicYearTests.create_year
    switch = fixtures.AcademicYearTests.switch

    def request(self, method, path, body=None, headers=None, status=200):
        response = self.client.request(method, '/api/nsp'+path, headers=headers or self.admin, **({'json':body} if body is not None else {}))
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def prepare(self):
        self.request('POST','/admin/terms/course',{'name':'NSP自然永續培訓'})
        self.request('POST','/admin/terms/material',{'name':'講義'})
        self.request('POST','/admin/instructors',{'name':'講師','email':'teacher@example.invalid','bio':'簡介','expertise':'永續'})
        options = self.request('GET','/admin/options')
        return {'title':'NSP測試課程','category_id':options['terms'][0]['id'], 'cover_url':'https://example.invalid/cover.png','info_html':'<h3>課程資訊</h3><p>內容<script>alert(1)</script><a href="javascript:alert(1)">連結</a></p>', 'instructor_ids':[options['instructors'][0]['id']], 'sections':[{'title':'章節一','lessons':[{'id':'lesson_1','title':'影片一','url':'https://example.invalid/video.mp4','duration':100}]}], 'materials':[{'title':'教材','category_id':options['terms'][1]['id'],'url':'https://example.invalid/file.pdf','note':'課後複習'}], 'status':'published'}

    def test_authoring_publish_progress_and_account_boundaries(self):
        req=self.prepare()
        course_id=self.request('POST','/admin/courses',req)['id']
        public=self.request('GET','/courses',headers=self.student)[0]
        self.assertEqual(public['id'],course_id)
        self.assertEqual(public['category'],'NSP自然永續培訓')
        self.assertEqual(public['instructors'],['講師'])
        self.assertNotIn('<script',public['info_html'])
        self.assertNotIn('javascript:',public['info_html'])
        self.assertEqual(public['percent'],0)
        for _ in range(3):
            result=self.request('PUT',f'/courses/{course_id}/progress/lesson_1',{'position':95,'watched_delta':30},headers=self.student)
        self.assertEqual(result['completed'],0)
        result=self.request('PUT',f'/courses/{course_id}/progress/lesson_1',{'position':99,'watched_delta':9},headers=self.student)
        self.assertEqual(result['completed'],0)
        result=self.request('PUT',f'/courses/{course_id}/progress/lesson_1',{'position':100,'watched_delta':1},headers=self.student)
        self.assertEqual(result['completed'],1)
        public=self.request('GET','/courses',headers=self.student)[0]
        self.assertEqual(public['percent'],100)
        self.assertEqual(public['progress'][0]['position'],100)
        self.assertEqual(public['learners'],1)
        self.assertEqual(self.request('GET','/admin/courses')[0]['learners'],1)
        self.assertEqual(self.request('GET','/courses')[0]['percent'],0) # staff id=student id
        self.assertTrue(self.request('PUT',f'/courses/{course_id}/bookmark',headers=self.student)['bookmarked'])
        self.assertTrue(self.request('GET','/courses',headers=self.student)[0]['bookmarked'])
        self.assertFalse(self.request('GET','/courses')[0]['bookmarked'])
        self.request('PUT',f'/courses/{course_id}/progress/unknown',{'position':1},headers=self.student,status=404)
        self.request('PUT',f'/courses/{course_id}/progress/lesson_1',{'position':95,'watched_delta':31},headers=self.student,status=422)
        self.request('DELETE',f"/admin/terms/{req['category_id']}",status=409)
        self.request('DELETE',f"/admin/instructors/{req['instructor_ids'][0]}",status=409)
        self.request('DELETE',f'/admin/courses/{course_id}')
        self.assertEqual(self.request('GET','/courses',headers=self.student),[])
        with database.get_db(unscoped=True) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM nsp_progress').fetchone()[0],0)

    def test_drafts_validation_audit_and_stale_edits(self):
        req=self.prepare()
        draft={'title':'草稿課程','category_id':req['category_id']}
        course_id=self.request('POST','/admin/courses',draft)['id']
        self.assertEqual(self.request('GET','/courses',headers=self.student),[])
        row=self.request('GET','/admin/courses')[0]
        self.assertEqual(row['created_by'],'test@example.invalid')
        self.assertEqual(row['learners'],0)
        self.assertTrue(row['created_at'].endswith('+08:00'))
        self.request('PUT',f'/admin/courses/{course_id}',{**draft,'version':row['version'],'status':'published'},status=422)
        self.request('PUT',f'/admin/courses/{course_id}',{**req,'version':row['version']})
        self.request('PUT',f'/admin/courses/{course_id}',{**req,'version':row['version']},status=409)
        self.request('POST','/admin/courses',{**req,'cover_url':'javascript:alert(1)'},status=422)
        malformed=copy.deepcopy(req);malformed['sections'][0]['lessons'].append(malformed['sections'][0]['lessons'][0])
        self.request('POST','/admin/courses',malformed,status=422)
        self.request('POST','/admin/terms/course',{'name':'  '},status=400)
        self.request('POST','/admin/terms/course',{'name':'NSP自然永續培訓'},status=409)
        self.request('POST','/admin/instructors',{'name':'無效','email':'invalid','bio':'簡介','expertise':'永續'},status=422)

    def test_instructor_email_is_independent_and_bio_is_required(self):
        req = self.prepare()
        cid = self.request('POST', '/admin/courses', req)['id']
        iid = req['instructor_ids'][0]
        body = {'name':'外聘講師','email':'external@example.invalid','bio':'外聘講師簡介','expertise':'永續教育'}
        with patch('app.nsp.get_accounts_db', side_effect=AssertionError('Instructor editing must not query administrators')):
            self.request('PUT', f'/admin/instructors/{iid}', body)
            self.request('POST', '/admin/instructors', {**body,'email':'another@example.invalid'})
        rows = self.request('GET', '/admin/options')['instructors']
        self.assertEqual(rows[0]['email'], body['email'])
        self.assertEqual(rows[0]['bio'], body['bio'])
        self.assertEqual(self.request('GET', '/admin/courses')[0]['instructor_ids'], [iid])
        self.assertEqual(self.request('GET', '/courses', headers=self.student)[0]['instructors'], ['外聘講師'])
        for invalid in ({'bio':''},{'bio':'  '},{'email':''},{'email':'not-an-email'}):
            self.request('POST', '/admin/instructors', {**body,**invalid}, status=422)
            self.request('PUT', f'/admin/instructors/{iid}', {**body,**invalid}, status=422)
        self.request('POST', '/admin/instructors', {k:v for k,v in body.items() if k!='bio'}, status=422)

    def test_legacy_instructor_email_migrates_without_changing_course_links(self):
        from app.nsp import _ready
        req = self.prepare()
        self.request('POST', '/admin/courses', req)
        with database.get_db(unscoped=True) as conn:
            conn.execute('UPDATE nsp_instructors SET staff_id=1')
            conn.execute('ALTER TABLE nsp_instructors DROP COLUMN email')
            courses = [dict(r) for r in conn.execute('SELECT * FROM nsp_courses')]
        _ready.clear()
        initialize()
        rows = self.request('GET', '/admin/options')['instructors']
        self.assertEqual(rows[0]['email'], 'test@example.invalid')
        self.assertEqual(rows[0]['id'], req['instructor_ids'][0])
        with database.get_db(unscoped=True) as conn:
            self.assertEqual(courses, [dict(r) for r in conn.execute('SELECT * FROM nsp_courses')])
        _ready.clear()
        with patch('app.nsp.get_accounts_db', side_effect=AssertionError('Stored email must remain independent')):
            initialize()
        self.assertEqual(self.request('GET', '/admin/options')['instructors'][0]['email'], 'test@example.invalid')

    def test_instructor_number_migration_preserves_course_links_and_never_reuses_numbers(self):
        from app.nsp import _ready
        initialize()
        with database.get_db(unscoped=True) as conn:
            conn.execute("INSERT INTO nsp_instructors (year_id,name,staff_id,bio,expertise,created_by,created_at,updated_by,updated_at,email) VALUES (1,'temporary',0,'','','','','','','temporary@example.invalid')")
            conn.execute('DELETE FROM nsp_instructors')
        req = self.prepare()
        iid = req['instructor_ids'][0]
        self.assertEqual(iid, 2)
        self.request('POST', '/admin/courses', req)
        with database.get_db(unscoped=True) as conn:
            before = [dict(r) for r in conn.execute('SELECT * FROM nsp_courses')]
            conn.execute('DROP TRIGGER nsp_instructor_number_on_insert')
            conn.execute('DROP TABLE nsp_instructor_numbers')
        _ready.clear()
        initialize()
        rows = self.request('GET', '/admin/options')['instructors']
        self.assertEqual((rows[0]['id'], rows[0]['number']), (iid,1))
        with database.get_db(unscoped=True) as conn:
            self.assertEqual(before, [dict(r) for r in conn.execute('SELECT * FROM nsp_courses')])
        body = {'name':'第二位講師','email':'second@example.invalid','bio':'簡介','expertise':'永續'}
        self.request('POST', '/admin/instructors', body)
        row = self.request('GET', '/admin/options')['instructors'][-1]
        self.assertEqual(row['number'], 2)
        self.request('DELETE', f"/admin/instructors/{row['id']}")
        self.request('POST', '/admin/instructors', {**body,'name':'第三位講師'})
        self.assertEqual(self.request('GET', '/admin/options')['instructors'][-1]['number'], 3)

    def test_all_admin_audits_resolve_names_without_rewriting_history(self):
        req = self.prepare()
        self.request('POST', '/admin/courses', req)
        with database.get_db(unscoped=True) as conn:
            conn.execute("UPDATE admin SET name='管理員甲' WHERE id=1")
        data = self.request('GET', '/admin/options')
        rows = data['terms'] + data['instructors'] + self.request('GET', '/admin/courses')
        for row in rows:
            self.assertEqual(row['created_by_name'], '管理員甲')
            self.assertEqual(row['updated_by_name'], '管理員甲')
            self.assertEqual(row['created_by'], 'test@example.invalid')
            self.assertTrue(row['created_at'].endswith('+08:00'))

    def test_year_isolation_permission_checks_and_changed_video_resets_completion(self):
        req=self.prepare();cid=self.request('POST','/admin/courses',req)['id']
        self.request('PUT',f'/courses/{cid}/progress/lesson_1',{'position':20,'watched_delta':20},headers=self.student)
        admin=self.request('GET','/admin/courses')[0]
        req['sections'][0]['lessons'][0]['url']='https://example.invalid/replaced.mp4'
        self.request('PUT',f'/admin/courses/{cid}',{**req,'version':admin['version']})
        self.assertEqual(self.request('GET','/courses',headers=self.student)[0]['progress'],[])
        for path in ['/admin/options','/admin/courses','/admin/catalog']:
            self.request('GET',path,headers=self.student,status=403)
        self.assertEqual(self.client.get('/api/nsp/courses').status_code,401)
        year_id=self.create_year();other=self.switch(year_id)
        self.assertEqual(self.request('GET','/courses',headers=other),[])
        self.request('PUT',f'/admin/courses/{cid}',req,headers=other,status=400)
        self.request('POST','/admin/courses',req,headers=other,status=400)
        self.assertEqual(self.request('GET','/admin/options',headers=other)['terms'],[])
        self.request('DELETE',f'/admin/courses/{cid}',headers=other,status=404)

    def test_catalog_uses_existing_staff_token_without_exposing_it(self):
        response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:[{'id':1,'title':'原課程'}])
        with patch('app.nsp.requests.get',return_value=response) as upstream:
            result=self.request('GET','/admin/catalog')
        self.assertEqual(result,[{'id':1,'title':'原課程'}])
        self.assertEqual(upstream.call_args.kwargs['headers']['Authorization'],self.admin['Authorization'])

    def test_course_number_migration_preserves_content_progress_and_relations(self):
        from app.nsp import _ready
        req = self.prepare()
        temporary = self.request('POST', '/admin/courses', req)['id']
        self.request('DELETE', f'/admin/courses/{temporary}')
        cid = self.request('POST', '/admin/courses', req)['id']
        self.assertEqual(cid, 2)
        self.request('PUT', f'/courses/{cid}/progress/lesson_1', {'position':20,'watched_delta':20}, headers=self.student)
        self.request('PUT', f'/courses/{cid}/bookmark', headers=self.student)
        tables = ('nsp_courses','nsp_progress','nsp_bookmarks')
        with database.get_db(unscoped=True) as conn:
            before = {t:[dict(r) for r in conn.execute('SELECT * FROM '+t)] for t in tables}
            conn.execute('DROP TRIGGER nsp_course_number_on_insert')
            conn.execute('DROP TABLE nsp_course_numbers')
        _ready.clear()
        initialize()
        course = self.request('GET', '/admin/courses')[0]
        self.assertEqual((course['id'],course['number']), (cid,1))
        with database.get_db(unscoped=True) as conn:
            self.assertEqual(before, {t:[dict(r) for r in conn.execute('SELECT * FROM '+t)] for t in tables})
        _ready.clear()
        initialize()
        self.assertEqual(self.request('GET', '/admin/courses')[0]['number'], 1)
        self.request('POST', '/admin/courses', {**req,'title':'第二門'})
        second = self.request('GET', '/admin/courses')[0]
        self.assertEqual(second['number'], 2)
        self.request('DELETE', f"/admin/courses/{second['id']}")
        self.request('POST', '/admin/courses', {**req,'title':'第三門'})
        self.assertEqual(self.request('GET', '/admin/courses')[0]['number'], 3)

    def test_legacy_category_numbering_preserves_all_existing_course_links(self):
        from app.nsp import _ready
        initialize()
        with database.get_db(unscoped=True) as conn:
            for kind in ('course', 'material'):
                conn.execute("INSERT INTO nsp_terms (year_id,kind,name,created_by,created_at,updated_by,updated_at) VALUES (1,?,'temporary','','','','')", (kind,))
            conn.execute('DELETE FROM nsp_terms')
        req = self.prepare()
        self.assertEqual(req['category_id'], 3)
        cid = self.request('POST', '/admin/courses', req)['id']
        self.request('PUT', f'/courses/{cid}/progress/lesson_1', {'position':20,'watched_delta':20}, headers=self.student)
        self.request('PUT', f'/courses/{cid}/bookmark', headers=self.student)
        tables = ('nsp_terms', 'nsp_courses', 'nsp_instructors', 'nsp_progress', 'nsp_bookmarks')
        with database.get_db(unscoped=True) as conn:
            before = {t:[dict(r) for r in conn.execute('SELECT * FROM '+t)] for t in tables}
            conn.execute('DROP TRIGGER nsp_term_number_on_insert')
            conn.execute('DROP TABLE nsp_term_numbers')
        _ready.clear()
        initialize()
        terms = self.request('GET', '/admin/options')['terms']
        self.assertEqual([(t['id'],t['kind'],t['number']) for t in terms], [(3,'course',1),(4,'material',1)])
        with database.get_db(unscoped=True) as conn:
            self.assertEqual(before, {t:[dict(r) for r in conn.execute('SELECT * FROM '+t)] for t in tables})
        _ready.clear()
        initialize()
        self.assertEqual(terms, self.request('GET', '/admin/options')['terms'])
        public = self.request('GET', '/courses', headers=self.student)[0]
        self.assertEqual(public['category'], 'NSP自然永續培訓')
        self.assertEqual(public['materials'][0]['category_id'], 4)
        self.assertEqual(public['progress'][0]['position'], 20)

    def test_category_numbers_are_independent_stable_and_not_reused(self):
        self.prepare()
        self.request('POST', '/admin/terms/course', {'name':'分類二'})
        terms = self.request('GET', '/admin/options')['terms']
        removed = next(t for t in terms if t['name']=='分類二')
        self.assertEqual(removed['number'], 2)
        self.request('DELETE', f"/admin/terms/{removed['id']}")
        self.request('POST', '/admin/terms/course', {'name':'分類三'})
        self.request('POST', '/admin/terms/material', {'name':'教材二'})
        self.request('PUT', '/admin/terms/course/1', {'name':'分類一改名'})
        terms = self.request('GET', '/admin/options')['terms']
        self.assertEqual([(t['name'],t['number']) for t in terms], [('分類一改名',1),('講義',1),('分類三',3),('教材二',2)])
        year = self.create_year()
        other = self.switch(year)
        for kind in ('course', 'material'):
            self.request('POST', '/admin/terms/'+kind, {'name':'新年度分類'}, headers=other)
        self.assertEqual([t['number'] for t in self.request('GET', '/admin/options', headers=other)['terms']], [1,1])


    def test_makeup_counts_share_attendance_source_without_changing_learning_progress(self):
        req = self.prepare()
        self.request('POST','/admin/courses',req)
        response = SimpleNamespace(raise_for_status=lambda:None, json=lambda:[{'title':req['title'],'makeup_count':33}])
        with patch('app.nsp.requests.get', return_value=response):
            self.assertEqual(self.request('GET','/admin/courses')[0]['makeup_count'],33)
            public = self.request('GET','/courses',headers=self.student)[0]
            self.assertEqual(public['makeup_count'],33)
            self.assertEqual(public['percent'],0)
        import requests
        with patch('app.nsp.requests.get', side_effect=requests.RequestException):
            self.assertIsNone(self.request('GET','/courses',headers=self.student)[0]['makeup_count'])

    def test_makeup_records_complete_display_only_and_courses_sort_by_date(self):
        req=self.prepare()
        first=self.request('POST','/admin/courses',req)['id']
        second=self.request('POST','/admin/courses',{**req,'title':'較早課程'})['id']
        response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:[
            {'title':req['title'],'course_date':'2026/10/20','makeup_count':2,'makeup_completed':True,'makeup_completed_at':'2026-10-25 19:12:59'},
            {'title':'較早課程','course_date':'2026/9/15','makeup_count':5,'makeup_completed':False}])
        with patch('app.nsp.requests.get',return_value=response):
            rows=self.request('GET','/courses',headers=self.student)
        self.assertEqual([r['id'] for r in rows],[first,second])
        self.assertEqual(rows[0]['course_date'],'2026/10/20')
        self.assertEqual(rows[0]['makeup_completed_at'],'2026-10-25 19:12:59')
        self.assertEqual((rows[0]['percent'],rows[0]['completed']),(100,1))
        self.assertTrue(all(p['completed'] for p in rows[0]['progress']))
        self.assertEqual(rows[1]['percent'],0)
        self.sync_mock.assert_not_called()
        with database.get_db(unscoped=True) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM nsp_progress').fetchone()[0],0)
        self.assertFalse(self.request('GET',f'/courses/{first}/completion',headers=self.student)['completed'])

    def test_makeup_sync_requires_all_current_lessons_and_student_identity(self):
        req = self.prepare()
        req['sections'].append({'title':'第二章','lessons':[{'id':'lesson_2','title':'第二支','url':'https://example.invalid/two.mp4','duration':10}]})
        cid = self.request('POST','/admin/courses',req)['id']
        path = f'/courses/{cid}/completion'
        self.assertFalse(self.request('GET',path,headers=self.student)['completed'])
        self.request('GET',path,status=403)
        self.request('PUT',f'/courses/{cid}/progress/lesson_2',{'position':10,'watched_delta':10},headers=self.student)
        self.sync_mock.assert_not_called()
        for _ in range(3):
            result = self.request('PUT',f'/courses/{cid}/progress/lesson_1',{'position':100,'watched_delta':30},headers=self.student)
        self.assertNotIn('makeup_synced',result)
        result=self.request('PUT',f'/courses/{cid}/progress/lesson_1',{'position':100,'watched_delta':10},headers=self.student)
        self.assertTrue(result['makeup_synced'])
        verified = self.request('GET',path,headers=self.student)
        self.assertTrue(verified['completed'])
        self.assertEqual(verified['title'],req['title'])
        self.assertTrue(verified['completed_at'].endswith('+08:00'))
        self.assertEqual(self.sync_mock.call_args.kwargs['headers']['Authorization'],self.student['Authorization'])
        self.assertEqual(self.sync_mock.call_args.kwargs['headers']['X-Academic-Year'],'1')
        self.assertEqual(self.sync_mock.call_args.kwargs['json'],{'course_id':cid})
        self.sync_mock.reset_mock()
        for _ in range(3):
            self.request('PUT',f'/courses/{cid}/progress/lesson_1',{'position':100,'watched_delta':30})
        self.sync_mock.assert_not_called()
        import requests
        self.sync_mock.side_effect = requests.RequestException('offline')
        saved = self.request('PUT',f'/courses/{cid}/progress/lesson_2',{'position':10},headers=self.student)
        self.assertEqual(saved['completed'],1)
        self.assertFalse(saved['makeup_synced'])
        self.sync_mock.side_effect = None
        self.assertTrue(self.request('GET','/courses',headers=self.student)[0]['makeup_synced'])
