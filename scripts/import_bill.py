#!/usr/bin/env python3
import argparse
import json

from bookkeeping import import_file

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import a CSV/XLSX bill into bookkeeping.db")
    parser.add_argument("path")
    parser.add_argument("--account")
    args = parser.parse_args()
    result = import_file(args.path, args.account)
    for notice in result.get("notices", []):
        print(notice)
    print(json.dumps(result, ensure_ascii=False))
