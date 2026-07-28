"""Dangerous legacy helper for resetting a disposable PostgreSQL database."""

import os
import sys

from dotenv import load_dotenv

load_dotenv()

if "--confirm-drop-public-schema" not in sys.argv:
    raise SystemExit(
        "REFUSED: this utility destroys the PostgreSQL public schema. Pass "
        "--confirm-drop-public-schema only for a verified disposable database."
    )
if os.getenv("ALLOW_DESTRUCTIVE_DATABASE_RESET", "").lower() != "true":
    raise SystemExit(
        "REFUSED: set ALLOW_DESTRUCTIVE_DATABASE_RESET=true as a second "
        "explicit acknowledgement."
    )

import psycopg2

try:
    connection = psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        sslmode="require",
    )
    connection.autocommit = True
    cursor = connection.cursor()
    cursor.execute("DROP SCHEMA public CASCADE;")
    cursor.execute("CREATE SCHEMA public;")
    cursor.close()
    connection.close()
    print("Disposable PostgreSQL public schema reset completed.")
except Exception:
    print("Database reset failed. Connection details were intentionally omitted.")
    raise
