# Spec Debug Lessons

调试与纠偏记录（按时间追加，勿删历史）。

### 2026-08-30 · Skill 初始化
- 现象：计划要求调试过程强制沉淀
- 根因：无项目级可复用笔记时重复踩坑
- 防再发：凡养成/发薪相关 bugfix 必须追加本文件

### 2026-08-30 · 发薪结余与筛选解耦
- 现象：若结余误绑日/周/月 `flow()`，切换筛选会改结余
- 根因：UI 用同一 `current` 算 net
- 防再发：结余只读 `summary.payPeriod`；收支/图仍用 range；对照 Spec §1

### 2026-08-30 · 打卡必填实测值
- 现象：旧打卡把 progress% 当录入，易与起止值公式冲突
- 根因：模型曾用 progress 兼做完成度与录入
- 防再发：checkin 存 `value`；progress 由 `(current-start)/(target-start)` 派生；创建强制 start/target

### 2026-08-30 · 习惯培养 vs 目标打卡
- 现象：统一成单一 `checkin` 后，66 天出勤与起止实测混在一起
- 根因：产品需要两种打卡语义
- 防再发：`habit`=出勤/66 天；`checkin`=起止值折线；迁移与 `start=0,target=66` 重分类为 habit
