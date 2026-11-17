"""Bounded retries for read-only Turso queries; never replay a write."""
import contextvars
import random
import threading
import time
import requests

deadline = contextvars.ContextVar('database_deadline', default=None)
_local = threading.local()


class DatabaseUnavailable(RuntimeError):
    def __init__(self, reason, dependency):
        self.reason, self.dependency = reason, dependency
        super().__init__('Database temporarily unavailable')


def session():
    # A Session belongs to one worker thread, not concurrent requests.
    if not hasattr(_local, 'session'):
        _local.session = requests.Session()
    return _local.session


def post_pipeline(base_url, token, payload, timeout=15, read_only=False):
    dependency = 'identity' if 'sdgs-role-permission' in base_url else 'activity'
    for attempt in range(2 if read_only else 1):
        remaining = deadline.get()
        remaining = remaining - time.monotonic() if remaining is not None else None
        if remaining is not None and remaining <= 0.1:
            raise DatabaseUnavailable('deadline', dependency)
        limit = min(timeout, 4) if read_only else timeout
        if remaining is not None:
            limit = min(limit, remaining / 2)
        reason = None
        try:
            response = session().post(base_url + '/v2/pipeline',
                headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                json=payload, timeout=(min(2, limit), limit))
            if response.status_code in (429, 500, 502, 503, 504):
                reason = 'http_' + str(response.status_code)
            elif not response.ok:
                raise RuntimeError('Turso HTTP error ' + str(response.status_code))
            else:
                for result in response.json().get('results', []):
                    error = result.get('error', {}) if result.get('type') == 'error' else {}
                    message = error.get('message', '')
                    if 'capacity temporarily exceeded' in message.lower():
                        reason = 'capacity'
                    elif error:
                        raise RuntimeError('SQL error: ' + message)
                if reason is None:
                    return response
        except (requests.Timeout, requests.ConnectionError):
            reason = 'timeout_or_connection'
        if not read_only or attempt == 1:
            raise DatabaseUnavailable(reason, dependency)
        time.sleep(random.uniform(0.1, 0.3))
