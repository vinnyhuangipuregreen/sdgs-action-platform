"""Explicit, backed-up migration of only admin/student to the identity database."""
import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.database import TursoConnection

TABLES = ("admin", "student")


def snapshot(connection):
    cursor = connection.cursor()
    data = {}
    for table in TABLES:
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,))
        schema = cursor.fetchone()
        if not schema:
            raise RuntimeError("找不到來源帳號表：" + table)
        cursor.execute(f"SELECT * FROM {table} ORDER BY id")
        rows = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", (table,))
        indexes = [row[0] for row in cursor.fetchall()]
        cursor.execute("SELECT seq FROM sqlite_sequence WHERE name=?", (table,))
        sequence = cursor.fetchone()
        data[table] = {"schema": schema[0], "rows": rows, "indexes": indexes, "sequence": sequence[0] if sequence else 0}
    return data


def digest(rows):
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def save_backup(path, data):
    if path.exists():
        raise RuntimeError("備份路徑已存在，請使用新檔名")
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as backup:
        backup.execute("CREATE TABLE migration_manifest (name TEXT PRIMARY KEY, fingerprint TEXT, sequence INTEGER)")
        for table, item in data.items():
            backup.execute(item["schema"])
            columns = list(item["rows"][0]) if item["rows"] else []
            for row in item["rows"]:
                backup.execute(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", tuple(row.values()))
            for sql in item["indexes"]:
                backup.execute(sql)
            backup.execute("INSERT INTO migration_manifest VALUES (?,?,?)", (table, digest(item["rows"]), item["sequence"]))
            backup.execute("DELETE FROM sqlite_sequence WHERE name=?", (table,))
            backup.execute("INSERT INTO sqlite_sequence VALUES (?,?)", (table, item["sequence"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("snapshot", "copy", "verify", "finalize", "unfreeze"))
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--backup", type=Path, required=True)
    args = parser.parse_args()
    secrets = json.loads(args.credentials.read_text(encoding="utf-8-sig"))
    expected = {"source": "libsql://sdgs-action-platform-vinnyhuangipuregreen.aws-ap-northeast-1.turso.io",
                "target": "libsql://sdgs-role-permission-vinnyhuangipuregreen.aws-ap-northeast-1.turso.io"}
    for key in expected:
        if secrets[key + "_url"] != expected[key]:
            raise RuntimeError("拒絕對非指定的資料庫進行搬移")
    source = TursoConnection(secrets["source_url"], secrets["source_token"])
    target = TursoConnection(secrets["target_url"], secrets["target_token"])
    trigger_names = [f"role_migration_{table}_{operation.lower()}" for table in TABLES for operation in ("INSERT", "UPDATE", "DELETE")]
    if args.phase == "unfreeze":
        source.cursor().execute_transaction([f"DROP TRIGGER IF EXISTS {name}" for name in trigger_names])
        print("Source account writes restored")
        return
    if args.phase == "copy":
        cursor = target.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('admin','student')")
        if cursor.fetchall():
            raise RuntimeError("目標已有帳號表，停止以避免覆蓋")
        source.cursor().execute_transaction([
            f"CREATE TRIGGER IF NOT EXISTS {name} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, '帳號遷移中，請稍後再試'); END"
            for table in TABLES for operation in ("INSERT", "UPDATE", "DELETE")
            for name in [f"role_migration_{table}_{operation.lower()}"]])
    data = snapshot(source)
    if args.phase in ("snapshot", "copy"):
        save_backup(args.backup, data)
        print("Backup saved:", args.backup)
    if args.phase == "snapshot":
        print("Counts:", {table: len(item["rows"]) for table, item in data.items()})
        return
    if args.phase == "copy":
        statements = []
        for table, item in data.items():
            statements.append(item["schema"])
            for row in item["rows"]:
                statements.append((f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", tuple(row.values())))
            statements.extend(item["indexes"])
            statements.extend([("DELETE FROM sqlite_sequence WHERE name=?", (table,)),
                               ("INSERT INTO sqlite_sequence VALUES (?,?)", (table, item["sequence"]))])
        target.cursor().execute_transaction(statements)
    target_data = snapshot(target)
    for table in TABLES:
        if data[table] != target_data[table]:
            raise RuntimeError("帳號表、索引、序號或資料不一致，保留來源：" + table)
    print("Verified:", {table: len(item["rows"]) for table, item in data.items()})
    if args.phase == "finalize":
        with sqlite3.connect(args.backup) as backup:
            saved = dict(backup.execute("SELECT name,fingerprint FROM migration_manifest"))
        if any(saved.get(table) != digest(data[table]["rows"]) for table in TABLES):
            raise RuntimeError("備份與來源不一致，禁止移除原表")
        source.cursor().execute_transaction(["DROP VIEW IF EXISTS account_profiles", *[f"DROP TABLE {table}" for table in TABLES]])
        print("Source admin/student tables removed; all other module tables retained")


if __name__ == "__main__":
    main()
