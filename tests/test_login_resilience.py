import os
import unittest
from unittest.mock import Mock, patch
import requests
from fastapi.testclient import TestClient
from app import database, academic_years, nsp, sso
from app.database_http import DatabaseUnavailable, post_pipeline, deadline
from app.main import app


class LoginResilienceTests(unittest.TestCase):
    def response(self, payload=None, status=200):
        response = Mock(ok=status < 400, status_code=status)
        response.json.return_value = payload or {'results': [{'type': 'ok'}]}
        return response

    def test_read_timeout_retries_once_but_write_is_never_replayed(self):
        for read_only, calls in [(True, 2), (False, 1)]:
            session = Mock()
            session.post.side_effect = [requests.ReadTimeout(), self.response()]
            with patch('app.database_http.session', return_value=session), patch('app.database_http.time.sleep'):
                if read_only:
                    post_pipeline('https://example.invalid', 'secret', {}, read_only=True)
                else:
                    with self.assertRaises(DatabaseUnavailable):
                        post_pipeline('https://example.invalid', 'secret', {})
            self.assertEqual(session.post.call_count, calls)

    def test_capacity_and_http_503_are_bounded_but_bad_sql_is_not_retried(self):
        for response, exception, calls in [
            (self.response({'results': [{'type': 'error', 'error': {'message': 'Server database capacity temporarily exceeded'}}]}), DatabaseUnavailable, 2),
            (self.response(status=503), DatabaseUnavailable, 2),
            (self.response({'results': [{'type': 'error', 'error': {'message': 'no such table'}}]}), RuntimeError, 1),
        ]:
            session = Mock(); session.post.return_value = response
            with patch('app.database_http.session', return_value=session), patch('app.database_http.time.sleep'):
                with self.assertRaises(exception):
                    post_pipeline('https://example.invalid', 'secret', {}, read_only=True)
            self.assertEqual(session.post.call_count, calls)

    def test_expired_request_budget_makes_no_database_call(self):
        token = deadline.set(0)
        try:
            with patch('app.database_http.session') as session:
                with self.assertRaises(DatabaseUnavailable):
                    post_pipeline('https://example.invalid', 'secret', {}, read_only=True)
                session.assert_not_called()
        finally:
            deadline.reset(token)

    def test_login_dependency_failure_returns_safe_json_503_with_request_id(self):
        with patch('app.main.get_accounts_db', side_effect=DatabaseUnavailable('timeout', 'identity')):
            with TestClient(app) as client:
                response = client.post('/api/auth/login', json={'account': 'test@example.invalid', 'password': 'secret'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], 'DATABASE_UNAVAILABLE')
        self.assertEqual(response.json()['request_id'], response.headers['x-request-id'])
        self.assertEqual(response.headers['retry-after'], '2')
        self.assertNotIn('secret', response.text)

    def test_vercel_requests_do_not_initialize_or_mutate_schema(self):
        with patch.dict(os.environ, {'VERCEL': '1'}), patch.object(database, 'get_db') as db:
            database.init_db()
            academic_years.ensure_registry()
            nsp.initialize()
            cursor = Mock()
            sso.ensure_ticket_table(cursor)
            cursor.execute.assert_not_called()
            db.assert_not_called()

    def test_year_middleware_failure_uses_the_same_safe_503(self):
        with patch('app.academic_years.get_year', side_effect=DatabaseUnavailable('capacity', 'activity')):
            with TestClient(app) as client:
                response = client.post('/api/auth/login', headers={'X-Academic-Year': '2'},
                    json={'account': 'test@example.invalid', 'password': 'secret'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['request_id'], response.headers['x-request-id'])


if __name__ == '__main__':
    unittest.main()
