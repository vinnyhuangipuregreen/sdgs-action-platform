"""Keep each year's existing relational model in an isolated table namespace.

Year 1 retains its original tables and IDs. Account and authorization tables are
never scoped. Only identifiers in the explicit module allowlist are translated.
"""
import re
from contextvars import ContextVar

current_year_id = ContextVar("academic_year_id", default=1)
MODULE_TABLES = ("sdgs_goals", "sdgs_targets", "action_topics", "action_catalog",
                 "worksheets", "game_scores", "system_settings", "system_email_logs")
COPY_TABLES = ("sdgs_goals", "sdgs_targets", "action_topics", "action_catalog", "system_settings")
TOKENS = re.compile(r"'(?:''|[^'])*'|--[^\n]*|/\*[\s\S]*?\*/|[A-Za-z_][A-Za-z_0-9]*")


def table_name(name, year_id):
    year_id = int(year_id)
    if year_id < 1:
        raise ValueError("Invalid academic year ID")
    return name if year_id == 1 else f"ay{year_id}_{name}"


def scoped_sql(sql, year_id, tables):
    mapping = {name.lower(): table_name(name, year_id) for name in tables}
    return TOKENS.sub(lambda match: mapping.get(match[0].lower(), match[0]), sql)


class YearCursor:
    def __init__(self, cursor, year_id, tables):
        self.raw, self.year_id, self.tables = cursor, year_id, tables

    def execute(self, sql, params=()):
        self.raw.execute(scoped_sql(sql, self.year_id, self.tables), params)
        return self

    def executemany(self, sql, params):
        self.raw.executemany(scoped_sql(sql, self.year_id, self.tables), params)
        return self

    def __getattr__(self, name):
        return getattr(self.raw, name)

    def __iter__(self):
        return iter(self.raw)


class YearConnection:
    def __init__(self, connection, year_id, tables=MODULE_TABLES):
        self.raw, self.year_id, self.tables = connection, year_id, tables

    def cursor(self):
        return YearCursor(self.raw.cursor(), self.year_id, self.tables)

    def execute(self, sql, params=()):
        return self.cursor().execute(sql, params)

    def execute_batch(self, statements):
        return self.raw.execute_batch([(scoped_sql(sql,self.year_id,self.tables),params) for sql,params in statements])

    def __getattr__(self, name):
        return getattr(self.raw, name)


def initialize_scope(connection, year_id, source_id=1, tables=MODULE_TABLES, copy_tables=COPY_TABLES):
    if year_id == 1:
        return
    cursor = connection.cursor()
    cursor.execute("CREATE TABLE IF NOT EXISTS academic_scopes (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL)")
    cursor.execute("SELECT id FROM academic_scopes WHERE id=?", (year_id,))
    if cursor.fetchone():
        return
    placeholders=','.join('?' for _ in tables)
    cursor.execute(f"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN ({placeholders}) AND sql IS NOT NULL", tables)
    schema=cursor.fetchall()
    table_schema={row[1]:row[3] for row in schema if row[0]=='table'}
    statements=[]
    for name in tables:
        if name not in table_schema:
            raise RuntimeError(f"Missing module table: {name}")
        ddl = scoped_sql(table_schema[name], year_id, tables)
        ddl = re.sub(r"^CREATE TABLE(?: IF NOT EXISTS)?", "CREATE TABLE IF NOT EXISTS", ddl, flags=re.I)
        statements.append((ddl,()))
        if name in copy_tables:
            target, source = table_name(name, year_id), table_name(name, source_id)
            statements.append((f"INSERT OR IGNORE INTO {target} SELECT * FROM {source}",()))
        for index in [row for row in schema if row[0]=='index' and row[2]==name]:
            index_sql = scoped_sql(index[3], year_id, tables)
            index_sql = index_sql.replace(index[1], table_name(index[1], year_id), 1)
            index_sql = re.sub(r"^(CREATE(?: UNIQUE)? INDEX)(?: IF NOT EXISTS)?", r"\1 IF NOT EXISTS", index_sql, flags=re.I)
            statements.append((index_sql,()))
    for trigger in [row for row in schema if row[0]=='trigger']:
        trigger_sql = scoped_sql(trigger[3], year_id, tables)
        trigger_sql = trigger_sql.replace(trigger[1], table_name(trigger[1], year_id), 1)
        trigger_sql = re.sub(r"^CREATE TRIGGER(?: IF NOT EXISTS)?", "CREATE TRIGGER IF NOT EXISTS", trigger_sql, flags=re.I)
        statements.append((trigger_sql,()))
    statements.append(("INSERT OR IGNORE INTO academic_scopes (id,source_id) VALUES (?,?)", (year_id, source_id)))
    if hasattr(cursor,'execute_transaction'):
        cursor.execute_transaction(statements)
    elif hasattr(cursor,'execute_batch'):
        cursor.execute_batch(statements)
    elif hasattr(connection,'execute_batch'):
        connection.execute_batch(statements)
    else:
        for sql,params in statements:
            cursor.execute(sql,params)
