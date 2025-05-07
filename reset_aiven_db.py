import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()  # load your .env file

DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_HOST = os.getenv('DB_HOST')
DB_PORT = os.getenv('DB_PORT')

try:
    print("Connecting to Aiven PostgreSQL...")
    conn = psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        sslmode='require'
    )
    conn.autocommit = True
    cur = conn.cursor()

    print("Dropping and recreating public schema...")
    cur.execute("DROP SCHEMA public CASCADE;")
    cur.execute("CREATE SCHEMA public;")

    print("✅ Done. Your Aiven PostgreSQL database is now clean.")
    cur.close()
    conn.close()
except Exception as e:
    print("❌ Error resetting database:", e)
