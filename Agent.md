# Personal OS — AI 可执行开发规范

## 0. 项目定位

开发一个面向个人用户的本地优先（Local-First）Personal OS。

核心目标：

> 用一个简单的应用记录、管理和沉淀个人生活，并最终通过 AI 对个人数据进行搜索、总结和问答。

第一阶段不追求功能完整，不追求漂亮，不追求复杂架构。

核心原则：

```text
先能用
  ↓
真实使用
  ↓
发现问题
  ↓
再优化
  ↓
再增加 AI
```

禁止第一阶段做成：

- 飞书替代品
- Notion 替代品
- 完整项目管理工具
- 社交软件
- 多用户 SaaS
- 复杂权限系统
- 复杂插件系统
- 复杂微服务
- 过早引入 Kubernetes / Redis / Kafka 等基础设施

---

# 1. 第一阶段 MVP

第一阶段只实现以下 6 个核心能力：

```text
1. 快速记录
2. Todo / 任务
3. Habit / 习惯
4. Finance / 记账
5. Knowledge / Markdown 知识库
6. Search / 搜索
```

AI 问答作为 MVP+，在上述功能稳定后加入。

第一阶段完成标准：

> 用户可以每天使用这个软件记录生活、记账、管理任务、记录知识，并且能够快速找到过去的数据。

---

# 2. 产品形态

第一阶段：

```text
Desktop Application
```

优先支持：

```text
Windows
Linux
macOS
```

移动端暂不开发。

后续增加：

```text
微信小程序
Web
Mobile
```

第一阶段必须保证核心数据格式与 UI 解耦。

---

# 3. 技术路线

推荐：

```text
Frontend:
React + TypeScript

Desktop:
Tauri

Database:
SQLite

Knowledge:
Markdown

Keyword Search:
SQLite FTS5

Vector Search:
第一阶段可以暂缓
第二阶段加入本地 Embedding

Embedding:
BGE-M3 / Qwen Embedding / 可替换模型

LLM:
OpenAI-compatible API

后端:
第一阶段不需要独立 Server

配置:
本地配置文件

日志:
结构化日志
```

不要第一阶段引入：

```text
PostgreSQL
Redis
Qdrant
Kafka
Docker
Kubernetes
微服务
```

除非实际需求证明需要。

---

# 4. Local-First 原则

所有个人数据默认保存在本地。

数据分成两类：

## 4.1 结构化数据

使用 SQLite：

```text
tasks
habits
habit_records
transactions
events
tags
settings
```

## 4.2 知识数据

使用 Markdown：

```text
knowledge/
├── cpp/
├── graphics/
├── android/
├── linux/
├── ai/
├── work/
├── life/
└── reading/
```

Markdown 是知识的原始数据。

SQLite 是结构化数据的原始数据。

Embedding 和 Vector Index 都属于派生数据。

---

# 5. 数据所有权

必须遵守：

```text
Raw Data
   ↓
Derived Data
```

关系：

```text
SQLite / Markdown
       ↓
Embedding
       ↓
Vector Index
```

禁止：

```text
Vector DB
   ↓
唯一数据源
```

未来更换 Embedding 模型时：

```text
删除旧 Vector Index
        ↓
重新 Embedding
        ↓
重新建立 Index
```

原始数据不能受到影响。

---

# 6. 首页 Dashboard

启动应用后直接进入 Dashboard。

第一版只需要：

```text
┌──────────────────────────────────────┐
│ Personal OS                          │
├──────────────────────────────────────┤
│ 今天                                 │
│                                      │
│ 任务             3 / 5               │
│ 习惯             5 / 6               │
│ 今日消费         ¥128                 │
│                                      │
│ ─────────────────────────────────── │
│                                      │
│ 快速记录                             │
│ [ 输入今天发生了什么……            ] │
│                                      │
│ ─────────────────────────────────── │
│                                      │
│ 今日任务                             │
│ □ 完成 XX                            │
│ □ 阅读 30 分钟                       │
│ □ 整理知识                           │
│                                      │
│ 今日习惯                             │
│ ✓ 早起                               │
│ ✓ 阅读                               │
│ □ 运动                               │
│                                      │
└──────────────────────────────────────┘
```

不要第一阶段制作复杂 Dashboard。

---

# 7. Quick Capture

这是整个产品最重要的入口之一。

用户应该可以快速输入：

```text
买咖啡 28
```

或者：

```text
今天研究了 RingBuffer
```

或者：

```text
明天 9 点开会
```

第一阶段不强制使用 AI。

先提供简单的：

```text
文字
时间
类型
标签
```

后续再加入 AI 自动解析。

目标：

> 用户记录一条信息最好不超过 5 秒。

---

# 8. Task

Task 最小字段：

```text
id
title
description
status
priority
due_at
created_at
completed_at
tags
```

状态：

```text
todo
doing
done
cancelled
```

支持：

```text
创建
编辑
完成
删除
延期
设置截止时间
设置优先级
设置标签
```

第一阶段不做复杂依赖关系。

不做：

```text
Gantt
复杂 Project
复杂 Workflow
多人协作
```

---

# 9. Habit

Habit 与 Task 必须区分。

Task：

> 一次性要完成的事情。

Habit：

> 周期性重复行为。

例如：

```text
Task:
完成 RingBuffer 测试

Habit:
每天阅读 30 分钟
每周运动 3 次
23:00 前睡觉
```

Habit 字段：

```text
id
name
frequency
target
created_at
enabled
```

支持：

```text
daily
weekly
custom
```

Habit Record：

```text
habit_id
date
completed
value
note
```

第一阶段只需要：

```text
打卡
连续次数
完成率
```

不要开发复杂习惯算法。

---

# 10. Finance / 记账

记账必须做到非常简单。

核心字段：

```text
id
amount
type
category
account
merchant
note
occurred_at
created_at
tags
```

type：

```text
expense
income
transfer
```

默认分类：

```text
餐饮
交通
购物
娱乐
住房
医疗
学习
旅行
其他
```

用户可以自定义分类。

---

# 11. 快速记账

支持：

```text
午饭 35
```

快速创建：

```text
amount = 35
type = expense
category = 餐饮
```

支持：

```text
咖啡 28
地铁 4
买书 89
```

第一阶段允许用户手动修正分类。

后续 AI 自动解析自然语言。

---

# 12. Finance Dashboard

第一阶段只提供：

```text
今日消费
本周消费
本月消费
```

分类统计：

```text
餐饮     ¥1200
交通      ¥300
购物      ¥800
其他      ¥500
```

提供简单折线图/柱状图即可。

不要第一阶段开发：

```text
股票
基金
资产负债表
信用卡自动同步
银行 API
发票识别
```

---

# 13. Knowledge Base

知识库使用 Markdown。

目录：

```text
knowledge/
├── cpp/
├── graphics/
├── android/
├── linux/
├── ai/
├── work/
├── life/
└── reading/
```

Markdown 文件示例：

```markdown
---
title: RingBuffer
tags:
  - cpp
  - concurrency
created: 2026-08-29
updated: 2026-08-29
---

# RingBuffer

固定大小的 Camera Frame RingBuffer。

## 场景

Producer:
Camera

Consumer:
Image Processing

允许丢帧。

## 方案

SPSC RingBuffer。

...
```

---

# 14. Knowledge UI

第一阶段提供：

```text
左侧：
目录树

中间：
Markdown 编辑器

右侧：
预览
```

支持：

```text
创建
编辑
删除
重命名
搜索
标签
Markdown Preview
```

第一阶段不需要：

```text
复杂双向链接图
Graph View
Block Editor
插件系统
在线协作
```

---

# 15. Search

第一阶段搜索必须优先做好。

使用：

```text
SQLite FTS5
```

搜索范围：

```text
Tasks
Transactions
Knowledge
Quick Notes
```

例如搜索：

```text
RingBuffer
```

可以找到：

```text
知识库/RingBuffer.md
Task: 完成 RingBuffer 测试
Quick Note: 今天研究 RingBuffer
```

---

# 16. 数据模型

建议数据库：

```sql
tasks
habits
habit_records
transactions
quick_notes
tags
```

知识库不需要复制全文到 SQLite。

SQLite 只保存：

```text
file_path
title
metadata
tags
created_at
updated_at
```

全文搜索可以建立索引。

---

# 17. AI 第一阶段

AI 不应该参与核心数据存储。

AI 是：

```text
Assistant Layer
```

不是：

```text
Database Layer
```

第一阶段 AI 只实现三个能力：

### 17.1 自然语言记账

输入：

```text
今天中午吃饭花了 42
```

AI 输出结构化数据：

```json
{
  "type": "expense",
  "amount": 42,
  "category": "餐饮",
  "note": "午饭"
}
```

必须让用户确认后写入数据库。

---

### 17.2 自然语言创建 Task

输入：

```text
明天上午 10 点提醒我测试 RingBuffer
```

AI 转换：

```json
{
  "type": "task",
  "title": "测试 RingBuffer",
  "due_at": "..."
}
```

用户确认后写入。

---

### 17.3 知识库问答

第一阶段可以使用：

```text
FTS5
+
LLM
```

不要求一开始就使用 Vector DB。

流程：

```text
用户问题
   ↓
Keyword Search
   ↓
Top-K 文档
   ↓
LLM
   ↓
答案
```

---

# 18. 第二阶段：Local Embedding

第一阶段稳定以后再加入：

```text
Local Embedding Model
```

推荐：

```text
BGE-M3
```

或：

```text
Qwen Embedding
```

Embedding 服务必须抽象成接口：

```cpp
class EmbeddingProvider {
public:
    virtual std::vector<float> embed(
        std::string_view text) = 0;

    virtual std::vector<std::vector<float>> embedBatch(
        const std::vector<std::string>& texts) = 0;

    virtual ~EmbeddingProvider() = default;
};
```

应用层不能直接依赖具体模型。

---

# 19. Vector Search

第一阶段优先：

```text
SQLite + FTS5
```

第二阶段增加：

```text
SQLite + Vector Index
```

如果数据量很小，可以直接使用 SQLite 生态中的向量扩展。

不要因为“AI 项目”就默认部署 Qdrant。

当出现以下需求时再考虑 Qdrant：

```text
大量数据
多个客户端
远程 Server
多人
百万级以上 Chunk
复杂 ANN
```

---

# 20. Hybrid Search

最终搜索架构：

```text
                   Query
                     │
                     ▼
               Query Analyzer
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        SQL        FTS5       Vector
          │          │          │
          └──────────┼──────────┘
                     ▼
                  Rerank
                     │
                     ▼
                   Top-K
                     │
                     ▼
                    LLM
```

不同问题使用不同搜索方式。

例如：

```text
“我这个月花了多少钱？”
```

使用：

```text
SQL
```

而：

```text
“我以前记录过哪些 RingBuffer 经验？”
```

使用：

```text
FTS5 + Vector
```

而：

```text
“总结我最近三个月学习 C++ 的进展。”
```

使用：

```text
SQL 时间过滤
+
Vector Search
+
LLM
```

---

# 21. AI Query Planner

后期 AI 应能够判断：

```text
问题类型
```

例如：

```text
Finance Query
Task Query
Habit Query
Knowledge Query
Mixed Query
```

不要所有问题都走 RAG。

例如：

```text
“本月消费多少？”
```

应该生成 SQL。

而：

```text
“我为什么最近总在研究性能优化？”
```

应该走：

```text
Knowledge Retrieval
+
Life Records
+
LLM
```

---

# 22. 隐私原则

默认：

```text
数据本地保存
```

如果调用云端 LLM：

```text
只发送必要上下文
```

不要发送：

```text
整个数据库
整个知识库
全部历史记录
```

应该：

```text
User Query
   ↓
Local Retrieval
   ↓
Relevant Context
   ↓
Cloud LLM
```

未来可以支持：

```text
Local LLM
```

实现完全离线 AI。

---

# 23. 配置

配置文件示例：

```yaml
database:
  path: ./data/personal.db

knowledge:
  path: ./knowledge

ai:
  provider: openai-compatible
  base_url: ""
  api_key: ""
  model: ""

embedding:
  provider: local
  model_path: ""
```

API Key 不进入数据库。

不要提交 Git。

---

# 24. 项目目录

建议：

```text
personal-os/
│
├── apps/
│   └── desktop/
│
├── frontend/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   └── services/
│
├── core/
│   ├── database/
│   ├── task/
│   ├── habit/
│   ├── finance/
│   ├── knowledge/
│   ├── search/
│   └── ai/
│
├── knowledge/
│
├── data/
│
├── tests/
│
├── docs/
│
└── scripts/
```

如果 Tauri 采用标准目录结构，可以根据 Tauri 约定调整，不要求机械遵守此目录。

---

# 25. API 设计原则

UI 不允许直接操作 SQLite。

统一经过 Service 层：

```text
UI
 ↓
Service
 ↓
Repository
 ↓
SQLite
```

例如：

```text
TaskService
HabitService
FinanceService
KnowledgeService
SearchService
AIService
```

Repository 负责数据访问。

Service 负责业务逻辑。

---

# 26. 第一阶段开发顺序

严格按照以下顺序：

## Phase 1

```text
项目初始化
↓
SQLite
↓
Task
↓
Habit
↓
Finance
↓
Quick Note
↓
Knowledge
↓
Search
↓
Dashboard
```

## Phase 2

```text
AI Natural Language Input
↓
AI Task Parser
↓
AI Finance Parser
↓
Knowledge Q&A
```

## Phase 3

```text
Local Embedding
↓
Vector Search
↓
Hybrid Search
↓
RAG
```

## Phase 4

```text
Daily Review
Weekly Review
Monthly Review
AI Summary
```

## Phase 5

```text
Sync Server
↓
微信小程序
↓
Mobile/Web
```

---

# 27. 第一阶段验收标准

必须全部满足：

### Task

- 可以创建 Task
- 可以完成 Task
- 可以删除 Task
- 可以设置时间
- 可以设置优先级
- 重启程序数据不丢失

### Habit

- 可以创建 Habit
- 可以打卡
- 可以取消打卡
- 可以显示连续次数
- 可以显示完成率

### Finance

- 5 秒内可以完成一笔记账
- 支持收入/支出
- 支持分类
- 支持日期
- 支持月度统计

### Knowledge

- 可以创建 Markdown
- 可以编辑 Markdown
- 可以搜索 Markdown
- 重启程序数据不丢失

### Search

搜索：

```text
RingBuffer
```

必须能够找到：

```text
Knowledge
Task
Quick Note
```

### Backup

必须可以：

```text
Export Data
```

最终得到：

```text
SQLite
+
Markdown
+
Attachments
```

---

# 28. 非功能要求

## 数据安全

任何情况下：

```text
删除 UI 数据
```

之前必须进行明确确认。

## 数据完整性

数据库操作必须使用：

```text
Transaction
```

避免部分写入。

## 可恢复

提供：

```text
Backup
Restore
Export
```

## 性能

普通操作：

```text
UI 响应 < 100ms
```

搜索：

```text
常规数据 < 200ms
```

Embedding 属于后台任务，不得阻塞 UI。

---

# 29. 后台任务

以下任务必须异步执行：

```text
Embedding
Indexing
全文索引更新
AI 请求
文件扫描
Backup
```

UI 不允许因为这些任务卡死。

使用：

```text
Job Queue
```

即可。

第一阶段不需要复杂线程池。

---

# 30. AI Agent 工作规范

AI Coding Agent 必须遵守：

### 原则 1：先运行再优化

每完成一个功能必须：

```text
编译
↓
测试
↓
运行
↓
验证
```

### 原则 2：禁止过度设计

如果简单方案可以解决：

```text
不要引入复杂框架
```

### 原则 3：小步提交

每次只完成一个功能。

例如：

```text
feat: add task model
feat: add task repository
feat: add task service
feat: add task UI
test: add task tests
```

不要一次修改几十个模块。

### 原则 4：保持可运行

任何阶段：

```text
main branch
```

必须可以启动。

### 原则 5：先写测试再重构

核心业务逻辑必须有测试。

至少测试：

```text
Task
Habit
Finance
Search
```

---

# 31. Definition of Done

一个功能只有同时满足以下条件才算完成：

```text
代码完成
+
编译通过
+
单元测试通过
+
基本 UI 可用
+
数据重启后仍存在
+
错误情况处理
+
没有明显日志错误
```

不能只因为：

```text
“代码写好了”
```

就认为完成。

---

# 32. 第一版绝对不要做的事情

明确禁止：

```text
❌ 多用户
❌ 权限
❌ 团队协作
❌ 云端同步
❌ 微信小程序
❌ 手机 App
❌ Qdrant Server
❌ PostgreSQL
❌ Redis
❌ Kubernetes
❌ 插件系统
❌ 自定义脚本系统
❌ 复杂 Workflow
❌ 复杂 Calendar
❌ 自动银行同步
❌ 股票资产管理
```

这些全部进入 Future。

---

# 33. Future Roadmap

## V0.1

```text
Task
Habit
Finance
Quick Note
Knowledge
Search
```

目标：

> 每天真正使用。

## V0.2

```text
AI Quick Capture
AI Task Parser
AI Finance Parser
```

目标：

> 减少输入成本。

## V0.3

```text
Local Embedding
Vector Search
RAG
```

目标：

> 可以问自己的知识库。

## V0.4

```text
Daily Review
Weekly Review
Monthly Review
AI Summary
```

目标：

> AI 开始理解长期生活数据。

## V0.5

```text
Goal
Project
Relation
Knowledge Graph
```

目标：

> 把任务、生活、知识关联起来。

## V1.0

```text
Sync
微信小程序
Web
Mobile
```

目标：

> 真正成为跨设备 Personal OS。

---

# 34. 最终产品愿景

最终希望用户可以直接输入：

```text
今天：
早上跑步 30 分钟，
中午吃饭 42，
下午研究了 RingBuffer，
晚上看了一篇关于 Thor 的文章。
```

系统自动识别：

```text
Habit
├── 跑步 ✓

Finance
└── 餐饮 ¥42

Knowledge
├── RingBuffer
└── Thor

Daily Log
└── 今天的生活记录
```

然后用户可以问：

```text
“我最近一个月主要在研究什么？”
```

```text
“我这个月的钱主要花在哪里？”
```

```text
“我关于 RingBuffer 都有哪些笔记？”
```

```text
“总结我这周的生活。”
```

```text
“根据我过去三个月的记录，
下周最值得关注的事情是什么？”
```

最终形成：

```text
记录
 ↓
结构化
 ↓
搜索
 ↓
知识沉淀
 ↓
AI 理解
 ↓
总结
 ↓
辅助决策
 ↓
改善生活
```

这才是 Personal OS 的核心价值。

---

# 35. Agent 当前任务

Agent 不要直接实现全部 Roadmap。

当前只执行：

```text
Phase 1 / V0.1
```

执行顺序：

```text
1. 初始化项目
2. 建立 SQLite
3. 实现 Task
4. 实现 Habit
5. 实现 Finance
6. 实现 Quick Note
7. 实现 Markdown Knowledge
8. 实现 FTS5 Search
9. 实现 Dashboard
10. 实现 Backup / Export
11. 编写测试
12. 完整运行验证
```

完成 V0.1 后停止。

不要自动进入 V0.2。

必须先验证 V0.1 可以作为日常工具使用。

---

# 36. 核心判断标准

整个项目始终遵循一句话：

> **不要为了未来可能需要的功能，牺牲今天的可用性。**

第一版最重要的不是：

```text
架构多先进
AI 多强
UI 多漂亮
Vector DB 多高级
```

而是：

```text
打开应用
↓
记录一件事情
↓
管理今天的任务
↓
记一笔账
↓
写一条知识
↓
几天以后还能快速找到
```

如果用户连续使用 30 天，这个项目才算真正成功。