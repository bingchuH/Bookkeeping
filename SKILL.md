---
name: bookkeeping
description: "本 skill 管理一个本地 SQLite 个人记账数据库。用户需要记录、导入、查询、修改、删除、修正或可视化个人账目时，使用本 skill。"
---

# Bookkeeping

## 边界

AI 负责判断和协作：

- 从自然语言中提取金额、账户、时间、对象、类型、分类意图。
- 对未知来源原始账单做只读检查，并临场编写一次性清洗脚本，把原始账单转换为标准 CSV。
- 判断低置信账户别名、分类规则和待确认事项是否需要用户参与。

代码负责确定性工作：

- 数据库初始化、写入、余额计算、导入、去重、待确认统计、导出和 Dashboard。
- 标准 CSV 的检查、导入前重复候选分析、正式导入后的去重与待确认生成。

不要在对话中临时复刻代码已有的去重、余额、导入或待确认统计逻辑；清洗出标准 CSV 后，直接调用 CLI。

## 数据位置

默认数据库不在 skill 目录内，而在：

```bash
python3 scripts/bookkeeping.py db-path
```

可用环境变量或参数指定数据库：

```bash
BOOKKEEPING_DB_PATH=/path/to/bookkeeping.db python3 scripts/bookkeeping.py init-db
python3 scripts/bookkeeping.py --db /path/to/bookkeeping.db init-db
python3 scripts/bookkeeping.py init-db --db-path /path/to/bookkeeping.db
```

首次使用或切换数据库后先运行：

```bash
python3 scripts/bookkeeping.py init-db
```

## 常用命令

```bash
python3 scripts/bookkeeping.py add --type 支出 --amount 45 --account 支付宝 --transaction-object 肯德基 --category "餐饮/早午晚餐" --note "午餐"
python3 scripts/bookkeeping.py transfer --from-account 支付宝 --to-account 微信 --amount 200 --note "账户间转账"
python3 scripts/bookkeeping.py correct-balance "招行储蓄卡" --actual 18500 --note "手动余额修正"
python3 scripts/bookkeeping.py list --limit 20
python3 scripts/bookkeeping.py accounts
python3 scripts/bookkeeping.py summary --month 2026-05
python3 scripts/bookkeeping.py unconfirmed-summary
python3 scripts/bookkeeping.py unconfirmed
```

## 单笔记账 SOP

普通新增必须确认：`amount`、`type`、`account`、`category`。不能编造金额、账户或分类。

内部转账只在确认两个账户都是用户自有账户时使用 `transfer` 或 `type=转账`。给他人转账、收到他人转账、银行汇款、平台退款等外部资金流不要当作内部转账。

账实不符时使用：

```bash
python3 scripts/bookkeeping.py correct-balance "账户名" --actual 1200 --note "原因"
```

不要用普通新增模拟余额修正。

## 原始账单导入 SOP

支付宝和微信是已知来源，只使用已有适配脚本清洗成标准 CSV：

```bash
python3 scripts/import_alipay_bill.py "/path/to/alipay.csv" --analyze-only
python3 scripts/import_wechat_bill.py "/path/to/wechat.xlsx" --analyze-only

python3 scripts/import_alipay_bill.py "/path/to/alipay.csv" \
  --account-map /tmp/alipay_account_map.json \
  --output /tmp/alipay_standard.csv

python3 scripts/import_wechat_bill.py "/path/to/wechat.xlsx" \
  --account-map /tmp/wechat_account_map.json \
  --output /tmp/wechat_standard.csv
```

支付宝/微信适配脚本不负责正式导入、跨来源去重或通用关键词闭环；它们只输出标准 CSV。输出后和未知账单一样进入“标准 CSV 流程”。

未知来源账单必须先只读检查文件结构、sheet、表头、样本行、类型/账户/分类/金额方向分布。然后允许在 `/tmp` 临场编写一次性清洗脚本，输出标准 CSV。不要把未知来源的一次性清洗逻辑写入主 CLI 或 Dashboard。

标准 CSV 字段固定为：

```text
transaction_time,type,category_level1,category_level2,category,amount,currency,transaction_object,account,target_account,participant,note
```

清洗要求：

- `transaction_time` 使用 `YYYY-MM-DD HH:MM:SS`。
- `amount` 使用正数，单位元。
- `transaction_object` 统一放外部交易对象，订单号/流水号/支付方式优先放备注。
- 普通收支能高置信映射到当前合法分类才填 `category`；不确定留空。
- 只有确认两个账户都是自有账户时，才写 `type=转账` 和 `target_account`。

清洗完成后必须进入标准 CSV 流程，不要继续手写导入、去重或统计逻辑。

## 标准 CSV 流程

1. 检查标准 CSV：

```bash
python3 scripts/bookkeeping.py import-check /tmp/cleaned_bill.csv --output /tmp/bookkeeping_import_check.json
```

2. 做通用关键词候选分析。这个命令会先应用数据库已有关键词规则，再输出仍未分类的高频候选：

```bash
python3 scripts/bookkeeping.py keyword-candidates /tmp/cleaned_bill.csv \
  --output /tmp/bookkeeping_keyword_candidates.json
```

AI 读取输出后，只判断：

- 高频值是否语义稳定、以后也可复用。
- 是否能映射到当前合法分类。
- 是否能确认交易类型。

AI 写入本次规则文件。没有高置信规则就写空数组：

```json
[]
```

有高置信规则时使用这个格式：

```json
[
  {"keyword": "地铁", "category": "交通/公共交通", "type": "支出"}
]
```

不要把个人昵称、订单号、流水号、一次性商品标题、含义过宽的词写成规则。

3. 如果有本次规则，把它应用到标准 CSV，再重新执行 `import-check` 和 `keyword-candidates`；直到没有新的高置信规则：

```bash
python3 scripts/bookkeeping.py apply-keyword-rules /tmp/cleaned_bill.csv \
  --keyword-rules /tmp/bookkeeping_keyword_rules.json \
  --output /tmp/cleaned_bill_with_rules.csv

python3 scripts/bookkeeping.py import-check /tmp/cleaned_bill_with_rules.csv \
  --output /tmp/bookkeeping_import_check.json

python3 scripts/bookkeeping.py keyword-candidates /tmp/cleaned_bill_with_rules.csv \
  --output /tmp/bookkeeping_keyword_candidates.json
```

后续步骤使用最后一版标准 CSV。

4. 生成重复候选：

```bash
python3 scripts/bookkeeping.py import-duplicates /tmp/cleaned_bill_with_rules.csv --output /tmp/bookkeeping_duplicate_candidates.json
```

5. 由 AI 只判断高置信账户别名，写入映射文件。没有高置信映射也写空对象：

```json
{}
```

映射方向是“新导入账户名 -> 数据库已有账户名”。

6. 正式导入：

```bash
python3 scripts/bookkeeping.py import /tmp/cleaned_bill_with_rules.csv --duplicate-account-map /tmp/bookkeeping_duplicate_account_map.json
```

7. 导入后查看待确认摘要：

```bash
python3 scripts/bookkeeping.py unconfirmed-summary
```

## 待确认事项 SOP

先看摘要，再处理具体记录：

```bash
python3 scripts/bookkeeping.py unconfirmed-summary
python3 scripts/bookkeeping.py unconfirmed
```

常见处理：

```bash
python3 scripts/bookkeeping.py confirm 3 --category "餐饮/饮料"
python3 scripts/bookkeeping.py confirm 3 --category "餐饮/饮料" --learn
python3 scripts/bookkeeping.py rule-add 星巴克 --category "餐饮/饮料" --type 支出
```

只有规则稳定、可泛化时才 `--learn` 或 `rule-add`。不要把个人昵称、一次性商品标题、订单号、完整流水号作为长期规则。

如果用户明确需要新分类，先用 Dashboard 或分类管理命令新增分类，再确认记录。

## Dashboard

```bash
python3 scripts/bookkeeping.py dashboard --host 127.0.0.1 --port 8765
```

导入最后启动Dashboard，打开 `http://127.0.0.1:8765`。

## 安全

- 账单文件和数据库保持本地。
- 修改或删除账目前，先用 `list` 或只读查询定位目标记录。
- 撤销导入时，不要删除或重写已学习的关键词规则。
