#!/usr/bin/env python3
import argparse
import collections
import csv
import json
from pathlib import Path

from bookkeeping import valid_categories

STANDARD_FIELDS = [
    "transaction_time",
    "type",
    "category_level1",
    "category_level2",
    "category",
    "amount",
    "currency",
    "transaction_object",
    "account",
    "target_account",
    "participant",
    "note",
]

ALIPAY_FIELD_MAP = {
    "交易时间": "transaction_time",
    "交易对方": "transaction_object",
    "收/付款方式": "account",
    "商品说明": "note",
    "备注": "note",
}


def decode_alipay_csv(path):
    data = Path(path).read_bytes()
    for encoding in ["gb18030", "utf-8-sig", "utf-8"]:
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode("gb18030", errors="replace")
    lines = text.splitlines()
    header_index = next((i for i, line in enumerate(lines) if line.startswith("交易时间,")), None)
    if header_index is None:
        raise SystemExit("未找到支付宝明细表头：交易时间")
    rows = list(csv.DictReader(lines[header_index:]))
    return header_index + 1, rows


def payment_method_key(value):
    text = str(value or "").strip()
    return text.split("&", 1)[0].strip()


def account_name(value, account_map):
    key = payment_method_key(value)
    return account_map.get(key, key)


def transaction_object(row):
    return row["交易对方"].strip()


def note_text(row):
    return "；".join(
        part
        for part in [row.get("商品说明", "").strip(), row.get("备注", "").strip()]
        if part
    )


def split_category(category):
    if not category:
        return "", ""
    parts = category.split("/", 1)
    return parts[0], parts[1] if len(parts) > 1 else ""


def contains_any(text, keywords):
    return any(keyword in text for keyword in keywords)


def classify(row, account_map):
    status = row["交易状态"].strip()
    direction = row["收/支"].strip()
    source = row["交易分类"].strip()
    object_name = transaction_object(row)
    description = row["商品说明"].strip()
    if status == "交易关闭":
        return None, "交易关闭"
    if source == "投资理财" and object_name == "余额宝" and contains_any(description, ["自动转入", "转账收款到余额宝"]):
        return None, "余额宝内部转入"

    if status == "退款成功" or source == "退款":
        tx_type = "收入"
        category = "退款"
    elif direction == "支出":
        tx_type = "支出"
        category = ""
    elif direction == "收入":
        tx_type = "收入"
        category = ""
    else:
        return None, f"未映射的不计收支：{source}"

    if category and category not in valid_categories():
        category = ""
    level1, level2 = split_category(category)
    return {
        "transaction_time": row["交易时间"].strip(),
        "type": tx_type,
        "category_level1": level1,
        "category_level2": level2,
        "category": category,
        "amount": row["金额"].strip(),
        "currency": "CNY",
        "transaction_object": object_name,
        "account": account_name(row["收/付款方式"], account_map),
        "target_account": "",
        "participant": "自己",
        "note": note_text(row),
    }, None


def classify_rows(rows, account_map):
    results = []
    skipped = collections.Counter()
    for row in rows:
        record, reason = classify(row, account_map)
        if record:
            results.append((row, record))
        else:
            skipped[reason] += 1
    return results, skipped


def analyze(rows):
    print(f"原始记录: {len(rows)}")
    for field in ["交易分类", "收/支", "收/付款方式", "交易状态", "交易对方"]:
        counter = collections.Counter((row.get(field) or "").strip() for row in rows)
        print(f"\n{field} 分布:")
        for name, count in counter.most_common(20):
            print(f"  {count:>3} {name or '(空)'}")
    payment_methods = collections.Counter(payment_method_key(row.get("收/付款方式")) for row in rows)
    print("\n账户映射模板:")
    print(json.dumps({name: "" for name in payment_methods}, ensure_ascii=False, indent=2))
    print("\n内置字段映射:")
    print(json.dumps(ALIPAY_FIELD_MAP, ensure_ascii=False, indent=2))


def clean_rows(rows, account_map):
    results, skipped = classify_rows(rows, account_map)
    return [record for _, record in results], skipped


def write_standard_csv(rows, output):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=STANDARD_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return output


def read_json_mapping(value):
    if not value:
        return {}
    path = Path(value)
    text = path.read_text(encoding="utf-8") if path.exists() else value
    data = json.loads(text)
    if not isinstance(data, dict):
        raise SystemExit("mapping must be a JSON object")
    return {str(key): str(item) for key, item in data.items()}


def main():
    parser = argparse.ArgumentParser(description="Analyze and clean Alipay CSV bills to standard CSV")
    parser.add_argument("path")
    parser.add_argument("--output", default="/tmp/alipay_standard.csv")
    parser.add_argument("--account-map", help="JSON object or JSON file mapping Alipay payment methods to local account names")
    parser.add_argument("--analyze-only", action="store_true")
    args = parser.parse_args()

    account_map = read_json_mapping(args.account_map)
    header_line, rows = decode_alipay_csv(args.path)
    print(f"表头行: {header_line}")
    print("表头:", ", ".join(rows[0].keys()) if rows else "(空)")
    analyze(rows)
    if args.analyze_only:
        return

    classified, skipped = classify_rows(rows, account_map)
    cleaned = [record for _, record in classified]
    output = write_standard_csv(cleaned, args.output)
    print(f"\n标准 CSV: {output}")
    print(f"清洗后记录: {len(cleaned)}")
    print("跳过记录:")
    for reason, count in skipped.most_common():
        print(f"  {count:>3} {reason}")
    print("清洗后类型分布:", dict(collections.Counter(row["type"] for row in cleaned)))
    print("清洗后账户分布:", dict(collections.Counter(row["account"] for row in cleaned)))
    print("空分类:", sum(1 for row in cleaned if not row["category"]))


if __name__ == "__main__":
    main()
