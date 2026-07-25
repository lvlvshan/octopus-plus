---
name: model-testing-improvement
description: Refactor the Model Picker UI for auto‑expansion on batch test and per‑channel test, and add latency‑based sorting.
category: front-end
---

## 目标
1. 在 `Editor.tsx` 的 **ModelPickerSection** 里：
   - 移除冗余 `openChannelIds`，只保留 `expandedChannels`，确保 UI **React‑state** 清晰。
   - 在 `handleBatchTest` 里自动将正在测试的每个 `channel_id` 加入 `expandedChannels`，让对应面板立即展开放置测试结果。
   - 对 `LLMChannel.latency_ms` 进行 **类型安全** 处理：使用 `(c as any).latency_ms` 并在 **TypeScript** 配置中开启 `strictNullChecks`。

2. 增加**单元测试**（`src/components/modules/group/Editor.test.tsx`）：
   - 测试 `handleBatchTest` 通过把 **channelId** 自动拉伸到 `expandedChannels`。
   - 验证 `sortMembersByLatency` 在接口缺失 `latency_ms` 时返回原顺序。

3. 将这些改动纳入 **Skill**，并在 `Skill` 描述里提供 **调用示例** 与 **依赖说明**。

## 关键文件
| 文件路径 | 关键改动 |
|---|---|
| `web/src/components/modules/group/Editor.tsx` | ① 替换 `openChannelIds` 为 `expandedChannels` ② `handleBatchTest` 自动展开面板 ③ `latency_ms` 类型强转 |
| `web/src/components/modules/group/Editor.test.tsx` | 新增对展开和排序的单元测试 |
| `.claude/skills/model-testing-improvement.md` | 本文件 |

## 使用方法
```bash
// 1. 先确认前端依赖已装好
pnpm install

// 2. 运行单元测试验证
pnpm test

// 3. 进行构建
pnpm run build
```

## 态度(Feedback)
- 当你提交时请确保 `head` 分支已与 `dev` 同步，否则 CI 可能报 “The remote branch dev has changed”。
- 如果你在 PR 里遇到 **类型错误**，请尝试在 `tsconfig.json` 开启 `strictNullChecks` 并重载项目。
