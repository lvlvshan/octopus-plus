# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Octopus 是一个开源的 LLM API 聚合与负载均衡服务，用于个人或团队聚合多个 LLM 提供商的 API 通道（OpenAI、Anthropic、Gemini、Doubao 等），暴露统一的 OpenAI SDK / Anthropic SDK 兼容接口，支持：多渠道聚合、负载均衡（轮询/随机/故障转移/加权）、协议转换（OpenAI Chat / Responses / Anthropic）、模型与定价自动同步、Token 消耗与费用追踪、Next.js 管理后台、多数据库支持（SQLite / MySQL / PostgreSQL）。

## 构建与运行

### 环境要求
- Go 1.26.0（go.mod 声明），README 推荐 1.24.4
- Node.js 18+ 和 pnpm（前端构建）
- Python 3（仅用于 `scripts/updatePrice.py` 重新生成 `presets.go`）

### 完整发布构建（包含前端）
```bash
cd octopus
./scripts/build.sh release          # 构建全平台（linux/darwin/windows 各架构）
./scripts/build.sh build linux x86_64  # 单平台构建
```
构建流程：前端 `pnpm build` → `python3 scripts/updatePrice.py` 生成 `presets.go` → Go 交叉编译 → 输出到 `build/bin/`。

### 开发模式（后端）
```bash
go run main.go start               # 监听 0.0.0.0:8080，嵌入 static/out
# 首次运行自动创建 data/config.json（SQLite: data/data.db）
# 默认管理员账号: admin / admin
```
**注意**：后端依赖 `static/out/` 已存在，否则启动失败。

### 开发模式（前端）
```bash
cd web
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8080" pnpm run dev
# 前端 http://localhost:3000，后端 http://127.0.0.1:8080
```

### Docker
```bash
docker run -d --name octopus -v /path/to/data:/app/data -p 8080:8080 bestrui/octopus
# 或
docker compose up -d
```

### 测试
项目无测试文件（无 `*_test.go`）。

### 重要：优雅退出
`Ctrl+C` (SIGINT) 或 SIGTERM 触发优雅关闭：刷新内存中的 stats、relay logs 和 key 消耗数据到数据库。**不要使用 `kill -9`**，否则 stats 数据会丢失。

---

## 架构概览

### 分层结构
```
server/        HTTP 层（Gin）：admin REST API + LLM 转发代理
relay/         核心转发引擎：请求解析 → 负载均衡 → 上游请求 → 响应流回
op/            操作层：所有热点数据的内存缓存 + DB 读写（启动时全部加载）
model/         GORM 数据模型
db/            数据库初始化与迁移
task/          后台定时任务（延迟测量、模型同步、定价同步、stats 保存）
helper/        工具函数（HTTP client、延迟测量、模型列表获取）
price/         LLM 定价（presets.go 为 build 时 python 脚本生成）
update/        自我更新（从 GitHub releases 下载）
utils/         基础设施（logger、cache、shutdown、snowflake 等）
```

### 核心转发流程（`relay/relay.go`）
1. 解析入站请求为内部 `llm.Request`（按协议 OpenAI/Anthropic/Gemini）
2. 根据模型名查找对应 Group
3. 创建 `balancer.Iterator`，按负载均衡策略遍历 channel
4. 对每个候选 channel：选 key、构建出站 transformer、发送上游 HTTP 请求（通过 axonhub）
5. 流式/非流式响应写回客户端；失败则 iterator 前进到下一个 channel
6. `RelayMetrics` 异步记录 usage/cost 并保存 `RelayLog`

### 缓存策略（`op/`）
- **启动时**通过 `op.InitCache()` 加载全部热点数据到内存
- **ChannelKey 更新**（状态码、最后使用时间、累计费用）只写内存缓存，`SaveCache()` 定时刷 DB
- **Stats** 内存聚合后定时批量写入 DB
- **Relay logs** 内存环形缓冲区（上限 20 条，DB 关闭时 100 条），每 10 分钟刷 DB
- 所有缓存在 SIGTERM/SIGINT 时通过 `shutdown.Listen()` 持久化

### 后台定时任务（`task/`）
- **Base URL 延迟测量**（每小时）：HEAD 请求测延迟，更新缓存，relay 优先选最低延迟端点
- **模型同步**（可配置间隔）：从 `auto_sync=true` 的 channel 拉取模型列表，diff 后更新 channel 和 GroupItem，并自动分组新模型
- **LLM 定价同步**（可配置间隔）：从 models.dev 拉取价格数据更新内存缓存
- **Stats 保存**（可配置间隔）：调用 `StatsSaveDB()`
- **Relay log 刷新**（每 10 分钟）：环形缓冲区 flush 到 DB 并清理 TTL

### API 认证（`server/middleware/auth.go`）
- **Admin API**（`/api/...`）：JWT Bearer token 认证
- **LLM 转发路由**（`/v1/chat/completions` 等）：`sk-octopus-` 前缀 API Key 认证，支持过期时间和最大费用限制

### 数据库（`db/`）
- GORM v1，支持 SQLite（默认）、MySQL（utf8mb4）、PostgreSQL
- `AutoMigrate` 创建所有表：`User`, `Channel`, `ChannelKey`, `Group`, `GroupItem`, `LLMInfo`, `APIKey`, `Setting`, `Stats*`, `RelayLog`
- PostgreSQL 特有：`DEALLOCATE ALL` / `DISCARD ALL` 避免缓存计划问题
- `RelayLog.ID` 使用 Snowflake 分布式 ID 避免自增主键写入热点

### 关键设计模式
| 模式 | 位置 | 说明 |
|------|------|------|
| 单例管理员用户 | `op/user.go` | 包级 `userCache` 变量，首次启动自动创建 admin/admin |
| 内存缓存 + 延迟写 DB | `op/*.go` | 热点数据存 Go map/切片，带 mutex 保护，批量刷 DB |
| 分片缓存 | `utils/cache/` | 减少高并发下的锁竞争 |
| 熔断器 | `relay/balancer/` | 按 ChannelKey 记录失败次数，指数退避冷却 |
| 粘性会话 | `relay/balancer/` | 按 (APIKey, model) → (channelID, keyID) 绑定，重试保持在同一 channel |
| 首 Token 超时故障转移 | `relay/relay.go` | 流式响应首 Token 可配置超时，超时则切换下一 channel |
| 嵌入式前端 | `static/static.go` | `go:embed all:out`，Next.js 构建产物直接打包进二进制 |
| 部分更新请求 | `model/channel.go` | `*string`、`*bool` 指针字段，仅更新非 nil 字段 |
| Cobra CLI | `cmd/` | 两个命令：`start`（打印 banner、加载配置、设置日志级别）和 `version` |
| Viper 配置 | `conf/` | `data/config.json`，支持 `OCTOPUS_*` 环境变量覆盖 |

### 前端（`web/`）
- Next.js 16 (App Router) + React 19 + TypeScript
- 状态管理：Zustand；数据获取：TanStack Query
- UI：Radix UI + Tailwind CSS v4 + LobeHub Icons
- 路由：`/login`、`/`（仪表盘）、`/channel`、`/group`、`/price`、`/log`、`/setting`（多标签页）
- 开发时 `NEXT_PUBLIC_API_BASE_URL` 指向后端，生产环境后端直接服务嵌入的静态文件
