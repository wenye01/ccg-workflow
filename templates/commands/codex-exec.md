---
description: '{{BACKEND_PRIMARY}} 全权执行计划 - 读取 /ccg:plan 产出的计划文件，{{BACKEND_PRIMARY}} 承担 MCP 搜索 + 代码实现 + 测试并返回 batch 结果'
---

# Codex-Exec - Codex 全权执行计划

$ARGUMENTS

---

## 核心理念

**与 `/ccg:plan` 配对使用**：

```
/ccg:plan → 多模型协同规划（Codex ∥ Gemini 分析 → Claude 综合）
                ↓ 计划文件 (.claude/plan/xxx.md)
/ccg:codex-exec → Codex 全权执行（MCP 搜索 + 代码实现 + 测试）
                ↓ batch 执行结果
```

**与 `/ccg:execute` 的区别**：

| 维度 | `/ccg:execute` | `/ccg:codex-exec` |
|------|---------------|-------------------|
| 代码实现 | {{BACKEND_PRIMARY}}/{{FRONTEND_PRIMARY}} 直接实现 | **{{BACKEND_PRIMARY}} 直接实现** |
| MCP 搜索 | Claude 调用 MCP | **{{BACKEND_PRIMARY}} 调用 MCP** |
| Claude 上下文 | 低（只收集 batch 结果） | **极低（只看 batch 摘要）** |
| Claude token | 大量消耗 | **极少消耗** |
| 二次处理 | 无 | **无** |

---

## 语言协议

- 与工具/模型交互用 **英语**
- 与用户交互用 **中文**

---

## 多模型调用规范

**工作目录**：
- `{{WORKDIR}}`：**必须通过 Bash 执行 `pwd`（Unix）或 `cd`（Windows CMD）获取当前工作目录的绝对路径**，禁止从 `$HOME` 或环境变量推断
- 如果用户通过 `/add-dir` 添加了多个工作区，先用 Glob/Grep 确定任务相关的工作区
- 如果无法确定，用 `AskUserQuestion` 询问用户选择目标工作区

**{{BACKEND_PRIMARY}} 执行调用语法**：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EXEC_EOF'
<TASK>
<指令内容>
</TASK>
EXEC_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})
```

**{{BACKEND_PRIMARY}} 复用会话调用**：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"{{WORKDIR}}\" <<'EXEC_EOF'
<TASK>
<指令内容>
</TASK>
EXEC_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})
```

**等待后台任务**（最大超时 600000ms = 10 分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：
- 必须指定 `timeout: 600000`，否则默认只有 30 秒会导致提前超时
- 若 10 分钟后仍未完成，继续用 `TaskOutput` 轮询，**绝对不要 Kill 进程**
- 若因等待时间过长跳过了等待，**必须调用 `AskUserQuestion` 询问用户选择继续等待还是 Kill Task**
- ⛔ **前端模型失败必须重试**：若前端模型调用失败（非零退出码或输出包含错误信息），最多重试 2 次（间隔 5 秒）。仅当 3 次全部失败时才跳过前端模型结果并使用单模型结果继续。
- ⛔ **后端模型结果必须等待**：后端模型执行时间较长（5-15 分钟）属于正常。TaskOutput 超时后必须继续用 TaskOutput 轮询，**绝对禁止在后端模型未返回结果时直接跳过或继续下一阶段**。已启动的后端任务若被跳过 = 浪费 token + 丢失结果。

---

## 执行工作流

**执行任务**：$ARGUMENTS

### 📖 Phase 0：读取计划

`[模式：准备]`

1. **识别输入类型**：
   - 计划文件路径（如 `.claude/plan/xxx.md`）→ 读取并解析
   - 直接的任务描述 → 提示用户先执行 `/ccg:plan`

2. **解析计划内容**，提取：
   - 任务类型（前端/后端/全栈）
   - 技术方案
   - 实施步骤
   - 关键文件列表
   - SESSION_ID（`CODEX_SESSION` / `GEMINI_SESSION`）

3. **执行前确认**：
   向用户展示计划摘要，确认后执行：

   ```markdown
   ## 即将执行

   **任务**：<计划标题>
   **模式**：Codex 全权执行
   **步骤**：<N 步>
   **关键文件**：<N 个>

   Codex 将自主完成：MCP 搜索 + 代码实现 + 测试验证，并返回 batch 执行结果

   确认执行？(Y/N)
   ```

---

### ⚡ Phase 1：Codex 全权执行

`[模式：执行]`

**将计划转化为 Codex 结构化指令，一次性下发**：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}resume <CODEX_SESSION> - \"{{WORKDIR}}\" <<'EXEC_EOF'
<TASK>
You are a full-stack execution agent. Implement the following plan end-to-end.

## Implementation Plan
<将 Phase 0 解析出的完整计划内容粘贴于此>

## Your Instructions

### Step 1: Context Verification
Before coding, verify you have sufficient context:
- Use ace-tool MCP (search_context) to search for relevant existing code patterns
- Read the key files listed in the plan to understand current implementation
- If the plan references external libraries/APIs, use context7 MCP to query their latest documentation
- If latest information is needed, use grok-search MCP for web search

### Step 2: Implementation
Implement each step from the plan in order:
<将计划的实施步骤逐条列出>

Constraints:
- Follow existing code conventions in this project
- Handle edge cases and errors properly
- Keep changes minimal and focused on the plan
- Do NOT modify files outside the plan's scope

### Step 3: Self-Verification
After implementation:
- Run lint/typecheck if available
- Run existing tests: <从计划中提取测试命令，如无则 "run project's test suite">
- Verify no regressions in touched modules

## Output Format
Respond with a structured report:

### CONTEXT_GATHERED
<What information was searched/found, key findings from MCP tools>

### CHANGES_MADE
For each file changed:
- File path
- What was changed and why
- Lines added/removed

### VERIFICATION_RESULTS
- Lint/typecheck: pass/fail
- Tests: pass/fail (details if fail)
- Manual checks performed

### REMAINING_ISSUES
<Any unresolved issues, edge cases, or suggestions>
</TASK>
EXEC_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Codex 全权执行：<计划标题>"
})
```

**📌 记录 SESSION_ID**（`CODEX_EXEC_SESSION`）

如果计划中无 `CODEX_SESSION`（用户跳过了 `/ccg:plan` 的多模型分析），则使用新会话。

用 `TaskOutput` 等待完成。

---

### 🔍 Phase 2：结果收集

`[模式：收集]`

**Claude 只等待并记录 Codex 返回的 batch 执行结果**：

1. 读取 Codex 报告：CONTEXT_GATHERED / CHANGES_MADE / VERIFICATION_RESULTS / REMAINING_ISSUES
2. 保存 `CODEX_EXEC_SESSION` / batch 标识，供后续任务复用
3. 若 Codex 执行失败，向用户报告失败原因和已完成部分

---

### 📦 Phase 3：交付

`[模式：交付]`

向用户报告：

```markdown
## ✅ 执行完成

### 执行摘要
| 项目 | 详情 |
|------|------|
| 计划 | <计划文件路径> |
| 模式 | Codex 全权执行 |
| 搜索 | <Codex 使用了哪些 MCP 工具，关键发现> |
| 变更 | <N 个文件，+X/-Y 行> |
| 测试 | <通过/失败> |
| Batch | <SESSION_ID / batch 标识> |

### 变更清单
| 文件 | 操作 | 说明 |
|------|------|------|
| path/to/file.ts | 修改/新增 | 描述 |

### 后续建议
1. [ ] <建议的测试步骤>
2. [ ] <建议的验证步骤>
```

---

## 关键规则

1. **Claude 极简原则** — Claude 不调用 MCP、不做代码检索、不做二次处理，只读取计划并收集 batch 结果。
2. **{{BACKEND_PRIMARY}} 全权执行** — MCP 搜索、文档查询、代码检索、实现、测试全由 {{BACKEND_PRIMARY}} 完成。
3. **结果返回** — 外部模型只需返回 batch 执行结果与变更摘要。
4. **信任规则** — 后端以 {{BACKEND_PRIMARY}} 为准，前端以 {{FRONTEND_PRIMARY}} 为准。
5. **一次性下发** — 尽量一次给 Codex 完整指令 + 完整计划，减少来回通信。
6. **计划对齐** — Codex 实现必须在计划范围内，超出范围的变更视为违规。

---

## 使用方法

```bash
# 标准流程：先规划，再执行
/ccg:plan 实现用户认证功能
# 审查计划后...
/ccg:codex-exec .claude/plan/user-auth.md

# 直接执行（会提示先 /ccg:plan）
/ccg:codex-exec 实现用户认证功能
```

---

## 与 /ccg:plan 的关系

```
/ccg:plan ──→ .claude/plan/xxx.md
                    │
          ┌─────────┴─────────┐
          ↓                   ↓
   /ccg:execute        /ccg:codex-exec
   (多模型直接实施)     (Codex 全权)
   Claude 低消耗       Claude 极低消耗
   按任务路由           高效执行
```

用户可根据任务特点选择：
- **需要按任务路由** → `/ccg:execute`（前端/后端模型直接实施）
- **需要高效执行** → `/ccg:codex-exec`（Codex 一把梭）
