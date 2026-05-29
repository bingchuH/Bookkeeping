#!/usr/bin/env python3
from bookkeeping import init_db, DB_PATH

if __name__ == "__main__":
    init_db()
    print(f"initialized {DB_PATH}")
