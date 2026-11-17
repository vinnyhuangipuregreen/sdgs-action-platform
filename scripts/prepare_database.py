"""Run schema preparation explicitly before deploying a new cloud schema.

Use the target environment's existing TURSO_* and ROLE_* settings. Never run
with credentials from a different environment. Normal Vercel requests do not
perform schema preparation or seed writes.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['SDGS_RUN_MIGRATIONS'] = '1'
from app.database import init_db
from app.academic_years import ensure_registry
from app.accounts import accounts_separated, get_accounts_db
from app.nsp import initialize
from app.sso import ensure_ticket_table, session_revoked

if __name__ == '__main__':
    if not accounts_separated():
        raise RuntimeError('Configure the separate identity database first')
    init_db()
    ensure_registry()
    initialize()
    with get_accounts_db() as connection:
        ensure_ticket_table(connection.cursor())
    session_revoked("schema-preparation")
    print('Database schema preparation complete')
