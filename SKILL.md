---
name: bookkeeping
description: "本 skill 管理一个本地 SQLite 个人记账数据库。用户需要记录、导入、查询、修改、删除、修正或可视化个人账目时，使用本 skill。"
---

# Bookkeeping

## 使用目标

Agent 的职责不是把账单原样交给脚本，而是把人工判断融入导入流程：

1. 把原始账单整理成标准 CSV。
2. 主动分析未分类账目，提炼稳定、可复用的关键词规则。
3. 将可靠的关键词规则写入数据库，再用于本次账单和以后的账单。
4. 判断账户别名和跨来源重复候选。
5. 导入账目，把无法可靠判断的部分留给人工确认。

## 分工边界

AI 负责判断和协作：

- 从自然语言中提取金额、账户、时间、对象、类型、分类意图。
- 对未知来源原始账单做只读检查，并临场编写一次性清洗脚本，把原始账单转换为标准 CSV。
- 主动梳理未分类账目的高频线索，判断哪些关键词规则可以长期复用。
- 把高置信、可复用的关键词规则写入数据库；不能只写入临时 JSON。
- 判断低置信账户别名、分类规则和待确认事项是否需要用户参与。

代码负责确定性工作：

- 数据库初始化、写入、余额计算、导入、去重、待确认统计、导出和 Dashboard。
- 标准 CSV 检查、读取已有关键词规则、生成关键词候选、导入前重复候选分析、正式导入后的去重与待确认生成。

不要在对话中临时复刻代码已有的去重、余额、导入或待确认统计逻辑；清洗出标准 CSV 后，直接调用 CLI。

## 初始化 SOP

首次使用本 skill 时，不要直接初始化数据库。先运行：

```bash
python3 scripts/bookkeeping.py db-path
```

告知用户当前数据库路径，并询问是否接受该路径或希望指定自定义路径。默认数据库不在 skill 目录内；未配置环境变量时通常位于：

```text
~/.local/share/bookkeeping/bookkeeping.db
```

用户确认使用当前路径后，再运行：

```bash
python3 scripts/bookkeeping.py init-db
```

如果用户希望使用自定义路径，指引用户设置数据库路径环境变量 `BOOKKEEPING_DB_PATH`，并初始化数据库：

```bash
BOOKKEEPING_DB_PATH=/path/to/bookkeeping.db python3 scripts/bookkeeping.py init-db
```

## config.yaml

项目配置文件位于：

```text
scripts/config.yaml
```

它用于维护用户的长期记账口径，不用于保存账目数据。Agent 首次使用本 skill、清洗新来源账单或判断账户关系前，应先读取该文件。

`categories` 定义可用分类树。例如：

```yaml
categories:
  支出:
    餐饮:
      - 早午晚餐
      - 饮料
```

对应合法分类为 `餐饮/早午晚餐` 和 `餐饮/饮料`。Agent 只能将账目和关键词规则映射到当前已有的合法分类；不要临场编造分类。

`accounts` 维护用户明确配置的长期自有账户清单。例如：

```yaml
accounts:
  - 招行储蓄卡
  - 支付宝
```

Agent 用它理解用户已经维护的账户，并辅助判断两个账户是否属于用户本人。只有确认转出和转入账户都是用户自有账户时，才能归类为内部转账。账户的新增、重命名和删除优先由用户通过 Dashboard 管理。

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

账户映射遵循以下规则：

- 能高置信确认是同一账户时，AI 直接映射，不需要询问用户。例如：账单中的 `招商银行储蓄卡(4985)` 可以直接映射为本地已有账户 `招行储蓄卡4985`。
- 存在歧义时，必须询问用户确认。例如：账单中的 `中国银行` 是否应映射为本地已有账户 `中行工资卡`，不能自行判断。
- 无法确认且不影响导入时，保留账单中的支付方式名称，不要为了减少账户数量强行合并。

支付宝/微信适配脚本不负责正式导入，只输出标准 CSV。输出后和未知账单一样进入“标准 CSV 流程”。

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

## 标准 CSV 导入 SOP

支付宝、微信和未知来源账单完成清洗后，都必须走同一套流程。Agent 应主动完成能可靠完成的判断，仅在语义或账户关系存在歧义时询问用户。

1. 检查标准 CSV：

```bash
python3 scripts/bookkeeping.py import-check /tmp/cleaned_bill.csv --output /tmp/bookkeeping_import_check.json
```

重点查看：金额是否有效，时间、类型和账户是否完整，内部转账是否缺目标账户，以及仍有多少账目缺少分类。

2. 做一次关键词候选分析。命令会先读取数据库已有规则，再一次性输出仍未分类的高频线索：

```bash
python3 scripts/bookkeeping.py keyword-candidates /tmp/cleaned_bill.csv \
  --output /tmp/bookkeeping_keyword_candidates.json
```

Agent 读取输出后，主动梳理 `transaction_object`、`note` 和 `raw_category` 中的候选，只保留：

- 含义明确，能够映射到当前合法分类的关键词。
- 以后遇到同类账目仍然成立的关键词。
- 能可靠确认交易类型的关键词。

涉及到对个人的交易，不要提取关键词，但要在回复中提醒用户，与此人有多次交易，可移步Dashboard按照人名创建规则。不要把个人昵称、订单号、流水号、一次性商品标题、完整备注或含义过宽的词写成长期规则。不确定时留给人工确认，不要猜。

候选按完整字段值统计，不限制返回数量。高频门槛由脚本根据本次账单总行数自动计算：`max(3, 向上取整(总行数 * 2%))`。

3. 把本次分析得到的每条高置信、可复用规则写入数据库：

```bash
python3 scripts/bookkeeping.py rule-add 地铁 --category "交通/公共交通" --type 支出
```

这一步是 Agent 必须完成的长期知识沉淀。不能只在当前 CSV 中补分类，也不能只生成临时规则文件。数据库中的规则会用于后续导入，并会自动尝试处理历史待确认账目。

规则入库后用以下命令检查本轮规则是否已保存（可选）：

```bash
python3 scripts/bookkeeping.py rule-list
```

4. 同时把本轮规则整理到临时 JSON，用于补全当前标准 CSV。没有新规则时写空数组：

```json
[]
```

有高置信规则时使用这个格式：

```json
[
  {"keyword": "地铁", "category": "交通/公共交通", "type": "支出"}
]
```

应用本轮规则：

```bash
python3 scripts/bookkeeping.py apply-keyword-rules /tmp/cleaned_bill.csv \
  --keyword-rules /tmp/bookkeeping_keyword_rules.json \
  --output /tmp/cleaned_bill_with_rules.csv
```

5. 对补全后的 CSV 重新执行检查：

```bash
python3 scripts/bookkeeping.py import-check /tmp/cleaned_bill_with_rules.csv \
  --output /tmp/bookkeeping_import_check.json
```

关键词候选只分析一次。剩余空分类允许进入待确认，不要为了减少待确认数量而过度归类。

6. 生成重复候选：

```bash
python3 scripts/bookkeeping.py import-duplicates /tmp/cleaned_bill_with_rules.csv --output /tmp/bookkeeping_duplicate_candidates.json
```

7. Agent 只判断高置信账户别名，写入映射文件。没有高置信映射也写空对象：

```json
{}
```

映射方向是“新导入账户名 -> 数据库已有账户名”。

8. 正式导入：

```bash
python3 scripts/bookkeeping.py import /tmp/cleaned_bill_with_rules.csv --duplicate-account-map /tmp/bookkeeping_duplicate_account_map.json
```

9. 导入后查看待确认摘要：

```bash
python3 scripts/bookkeeping.py unconfirmed-summary
```

10. 导入完成后启动 Dashboard，把剩余事项交给人工确认。

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

只有规则稳定、可泛化时才 `--learn` 或 `rule-add`。Agent 在批量导入阶段发现可靠关键词时应主动使用 `rule-add`；人工处理单条待确认记录时，只有确认该交易对象可以代表同类账目，才使用 `--learn`。

如果用户明确需要新分类，先用 Dashboard 或分类管理命令新增分类，再确认记录。

## Dashboard

```bash
python3 scripts/bookkeeping.py dashboard --host 127.0.0.1 --port 8765
```

导入最后启动Dashboard，提醒用户打开 `http://127.0.0.1:8765`。

## 安全

- 账单文件和数据库保持本地。
- 修改或删除账目前，先用 `list` 或只读查询定位目标记录。
- 撤销导入时，不要删除或重写已学习的关键词规则。
