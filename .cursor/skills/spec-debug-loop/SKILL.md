---
name: spec-debug-loop
description: >-
  Personal OS 发薪结余、计划/习惯培养/目标打卡相关改动：对照产品 Spec 实现与验收，调试时强制写入
  lessons。Use when editing finance pay-period balance, payday settings, plan/habit/checkin
  goals, Habits page, CheckinChart, plan reminders, or when user mentions Spec / 偏差 / 打卡 / 习惯 / 发薪.
---

# Spec · Debug Loop（Personal OS）

## Spec 真源

- 打开并遵守：`docs/product/payday-plan-checkin-spec.md`
- 行为与 Spec 冲突 → **改代码**；改 Spec 须先问用户

## 强制流程

### 1. 开干前

1. 阅读 Spec 相关条款（结余 / 计划 / 打卡 / 提醒）。
2. 列出将改文件，并映射到 Spec 章节号（例：`Finance.tsx` ↔ §1）。

### 2. 实现中

- 每完成一块，对照 Spec 验收点勾选。
- **禁止**静默偏离（如结余仍跟日周月筛选、计划加折线图、打卡无起止值）。

### 3. 调试中（强制落盘）

凡出现下列情况，必须在同目录 [`lessons.md`](lessons.md) **追加一条**（禁止只口头总结）：

- Bug 修复
- 实现走偏后纠正
- 桌面 / 手机行为差异

条目格式：

```markdown
### YYYY-MM-DD · 简短标题
- 现象：
- 根因：
- 防再发：
```

### 4. 收尾

1. 跑 Spec §8 验收清单。
2. 有意改 Spec → 停手问用户。
3. 若有调试，确认 `lessons.md` 已更新。

## 关键约束速查

| 点 | 要求 |
|----|------|
| 结余 | 仅发薪周期，不跟筛选 |
| 发薪日 | 1–28，默认 1 |
| 计划 | 无图；里程碑**必填截止日**并勾选；截止 d-3/d-1/d0 提醒 |
| 打卡 | 必填 start/target；每日 value；折线+虚线目标+差距 |
| 习惯 | 无独立入口；迁移为打卡 |
