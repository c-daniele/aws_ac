# Data Model: Dynamic Tool Activation

**Feature**: 001-dynamic-tool-activation
**Date**: 2026-02-03

## Overview

This feature adds a single optional field (`active`) to the existing tool configuration schema. No new entities or relationships are introduced.

---

## Entity: Tool Configuration

### Schema Changes

**New Field**: `active`

| Field | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `active` | boolean | No | `true` | Deployment-time availability. When `false`, tool is hidden from UI and excluded from AUTO mode |

### Updated Schema

```typescript
interface ToolConfig {
  // Existing fields
  id: string;                           // Unique tool identifier
  name: string;                         // Display name
  description: string;                  // Tool description
  category: string;                     // Category for grouping (utilities, search, etc.)
  icon: string;                         // Emoji or icon identifier
  enabled: boolean;                     // User session-level selection state
  isDynamic: boolean;                   // Whether tool contains nested tools
  displayName?: {
    running: string;                    // Status text while running
    complete: string;                   // Status text when complete
  };
  systemPromptGuidance?: string;        // Guidance added to system prompt
  usesCitation?: boolean;               // Whether tool requires citation handling
  tags?: string[];                      // Search/filter tags
  tools?: NestedToolConfig[];           // Nested tools (for isDynamic: true)

  // NEW FIELD
  active?: boolean;                     // Deployment-time availability (default: true)
}

interface NestedToolConfig {
  id: string;
  name: string;
  description: string;
  displayName?: {
    running: string;
    complete: string;
  };
  enabled?: boolean;

  // NEW FIELD
  active?: boolean;                     // Deployment-time availability (default: true)
}
```

---

## Field Interaction Matrix

| `active` | `enabled` | User Sees Tool | Tool Available in AUTO | Notes |
| -------- | --------- | -------------- | ---------------------- | ----- |
| `true` (or undefined) | `true` | ✅ Yes (selected) | ✅ Yes | Normal active & enabled state |
| `true` (or undefined) | `false` | ✅ Yes (unselected) | ❌ No | Tool visible but user hasn't enabled |
| `false` | `true` | ❌ No | ❌ No | `active` takes precedence |
| `false` | `false` | ❌ No | ❌ No | Tool completely hidden |

---

## Configuration Examples

### Example 1: Local Tool (Simple)

```json
{
  "id": "calculator",
  "name": "Calculator",
  "description": "Perform mathematical calculations",
  "category": "utilities",
  "icon": "🧮",
  "enabled": true,
  "active": false,          // ← Tool will not appear in UI
  "isDynamic": false
}
```

### Example 2: Dynamic Tool Group

```json
{
  "id": "word_document_tools",
  "name": "Word Documents",
  "description": "Create and modify Word documents",
  "category": "code_execution_tools",
  "icon": "📝",
  "enabled": true,
  "active": true,           // ← Group is active
  "isDynamic": true,
  "tools": [
    {
      "id": "create_word_document",
      "name": "Create Document",
      "active": true        // ← This nested tool is visible
    },
    {
      "id": "modify_word_document",
      "name": "Modify Document",
      "active": false       // ← This nested tool is hidden
    }
  ]
}
```

### Example 3: Backward Compatible (No active field)

```json
{
  "id": "ddg_web_search",
  "name": "Web Search (DuckDuckGo)",
  "description": "Search the web",
  "category": "search",
  "enabled": true,
  "isDynamic": false
  // No "active" field → defaults to true (visible)
}
```

---

## State Transitions

The `active` flag is **static configuration** set at deployment time. There are no runtime state transitions.

```
Configuration Load
       │
       ▼
┌──────────────────┐
│ active: true     │ ──────► Tool available for user selection
│ (or undefined)   │
└──────────────────┘
       │
       │ Administrator sets active: false
       ▼
┌──────────────────┐
│ active: false    │ ──────► Tool completely hidden
└──────────────────┘
       │
       │ Application restart required
       ▼
     (Effect takes place)
```

---

## Validation Rules

1. **Type**: `active` must be `boolean` or `undefined`
2. **Default**: If undefined, treat as `true`
3. **Precedence**: `active: false` overrides any `enabled` state
4. **Nesting**: Parent `active: false` implies all nested tools are hidden

---

## Storage Impact

| Storage | Change |
| ------- | ------ |
| `tools-config.json` | Add optional `active` field to tool definitions |
| DynamoDB (Tool Registry) | Stores complete config including `active` field |
| DynamoDB (User Enabled Tools) | No change - stores only tool IDs |
| Local file storage | No change - stores only tool IDs |

---

## Migration Notes

**No migration required**. The `active` field is optional with a default of `true`. Existing configurations continue to work without modification.
