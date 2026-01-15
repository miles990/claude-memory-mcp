# sqlite-memory-mcp

[![npm version](https://badge.fury.io/js/sqlite-memory-mcp.svg)](https://www.npmjs.com/package/sqlite-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 統一的 SQLite Memory MCP Server，為 Claude Code 生態系提供智能記憶管理

## 特色

- **跨專案記憶共享** — 學一次，處處可用
- **FTS5 全文搜尋** — 毫秒級搜尋，精確匹配
- **Skill 效果追蹤** — 知道什麼最有效
- **失敗經驗索引** — 不重複犯錯
- **Context 狀態共享** — 跨 Skill 無縫傳遞
- **零外部依賴** — 純 SQLite，無需 PyTorch/ONNX

## 效能

| 指標 | 傳統方案 | sqlite-memory-mcp |
|------|---------|------------------|
| Token/搜尋 | ~2300 | **~200 (-91%)** |
| 搜尋速度 | ~20ms | **~3.5ms (5.7x)** |
| 外部依賴 | PyTorch/ONNX | **無** |
| 並發支援 | JSONL 無 | **SQLite WAL** |

## 安裝

### 從 npm 安裝（推薦）

```bash
npm install -g sqlite-memory-mcp
```

### 從源碼安裝

```bash
git clone https://github.com/miles990/claude-memory-mcp.git
cd claude-memory-mcp
npm install
npm run build
```

## 配置 Claude Code

在 `~/.claude/.mcp.json` 加入：

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["sqlite-memory-mcp"]
    }
  }
}
```

或如果從源碼安裝：

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/claude-memory-mcp/dist/index.js"]
    }
  }
}
```

## 工具列表 (23 tools)

### Memory 工具 (6)

| 工具 | 說明 |
|------|------|
| `memory_write` | 寫入記憶到知識庫 |
| `memory_read` | 讀取特定記憶 |
| `memory_search` | FTS5 全文搜尋 |
| `memory_list` | 列出記憶（可過濾） |
| `memory_delete` | 刪除記憶 |
| `memory_stats` | 統計資訊 |

### Skill 工具 (7)

| 工具 | 說明 |
|------|------|
| `skill_register` | 註冊 skill 安裝 |
| `skill_get` | 取得 skill 資訊 |
| `skill_list` | 列出所有 skill |
| `skill_usage_start` | 開始使用追蹤 |
| `skill_usage_end` | 結束使用追蹤 |
| `skill_recommend` | 智能推薦（基於成功率） |
| `skill_stats` | 使用統計 |

### Context 工具 (5)

| 工具 | 說明 |
|------|------|
| `context_set` | 設定 context 值 |
| `context_get` | 取得 context 值 |
| `context_list` | 列出 session context |
| `context_clear` | 清除 context |
| `context_share` | 跨 session 共享 |

### Failure 工具 (5)

| 工具 | 說明 |
|------|------|
| `failure_record` | 記錄失敗經驗 |
| `failure_search` | FTS5 搜尋解法 |
| `failure_list` | 列出失敗記錄 |
| `failure_update` | 更新解法 |
| `failure_stats` | 失敗統計 |

## 資料庫

位置：`~/.claude/claude.db`

自動建立 schema，包含：
- `memory` 表 + `memory_fts` FTS5
- `skills` 表
- `skill_usage` 表
- `failures` 表 + `failures_fts` FTS5
- `context` 表

## 使用範例

### 記憶搜尋

```
memory_search query="TypeScript pattern"
memory_list scope="global"
```

### Skill 追蹤

```
skill_usage_start skill_name="evolve"
skill_usage_end usage_id=1 success=true outcome="completed"
skill_recommend project_type="typescript"
```

### 失敗經驗

```
failure_record error_pattern="TypeError: undefined" solution="Check null values"
failure_search query="TypeError undefined"
```

## 與競品比較

| 功能 | server-memory | doobidoo | **sqlite-memory-mcp** |
|------|--------------|----------|----------------------|
| 存儲 | JSONL | SQLite-vec | **SQLite WAL** |
| 搜尋 | 關鍵字 | 向量 | **FTS5 全文** |
| Skill 追蹤 | - | - | **有** |
| 失敗索引 | - | - | **有** |
| Context 共享 | - | - | **有** |
| 外部依賴 | 無 | PyTorch | **無** |

## 與 evolve skill 整合

此 MCP Server 設計為與 [self-evolving-agent](https://github.com/miles990/self-evolving-agent) 整合：

- **CP1**: 使用 `memory_search` + `failure_search` 搜尋經驗
- **CP3.5**: 使用 `memory_write` 記錄學習
- **CP5**: 使用 `failure_record` 記錄失敗
- **Skill 追蹤**: 自動追蹤使用成功率

## License

MIT
