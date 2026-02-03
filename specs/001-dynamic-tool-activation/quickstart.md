# Quickstart: Dynamic Tool Activation

**Feature**: 001-dynamic-tool-activation
**Date**: 2026-02-03

## Overview

This guide explains how to use the `active` flag to control tool availability at deployment time.

---

## Quick Reference

| Action | How |
| ------ | --- |
| Hide a tool | Set `"active": false` in tools-config.json |
| Show a tool | Set `"active": true` or remove the `active` field |
| Hide nested tool only | Set `"active": false` on the nested tool |
| Hide entire tool group | Set `"active": false` on the parent tool |

---

## Usage Examples

### 1. Deactivate a Local Tool

To hide the Calculator from users:

**File**: `chatbot-app/frontend/src/config/tools-config.json`

```json
{
  "local_tools": [
    {
      "id": "calculator",
      "name": "Calculator",
      "description": "Perform mathematical calculations",
      "active": false,    // ← Add this line
      "enabled": true,
      ...
    }
  ]
}
```

### 2. Deactivate a Gateway Tool

To hide Google Maps integration:

```json
{
  "gateway_targets": [
    {
      "id": "gateway_google-maps",
      "name": "Google Maps",
      "active": false,    // ← Add this line
      ...
    }
  ]
}
```

### 3. Deactivate Specific Nested Tool

To hide only "Modify Document" but keep "Create Document" visible:

```json
{
  "id": "word_document_tools",
  "name": "Word Documents",
  "active": true,         // Parent remains active
  "isDynamic": true,
  "tools": [
    {
      "id": "create_word_document",
      "name": "Create Document",
      "active": true      // Visible
    },
    {
      "id": "modify_word_document",
      "name": "Modify Document",
      "active": false     // ← Hidden
    }
  ]
}
```

### 4. Deactivate Entire Tool Group

To hide all PowerPoint tools:

```json
{
  "id": "powerpoint_presentation_tools",
  "name": "PPT Presentations",
  "active": false,        // ← Entire group hidden
  "isDynamic": true,
  "tools": [...]          // All nested tools hidden
}
```

---

## Applying Changes

After modifying `tools-config.json`:

### Local Development

```bash
# Restart the application
cd chatbot-app
./start.sh

# Or restart just the frontend if already running
cd chatbot-app/frontend
npm run dev
```

### Cloud Deployment

```bash
# Rebuild and deploy
cd agent-blueprint
./deploy.sh --frontend
```

For DynamoDB-synced environments, the sync happens automatically on first API request after configuration change.

---

## Verification

1. Open the application in browser
2. Click the Tools dropdown (sparkle icon)
3. Verify deactivated tools do not appear in the list
4. Enable AUTO mode and confirm AI cannot use deactivated tools

---

## Key Differences: `active` vs `enabled`

| Flag | Purpose | Controlled By | When Evaluated |
| ---- | ------- | ------------- | -------------- |
| `active` | Deployment availability | Administrator | Configuration load |
| `enabled` | Session selection | User | Per-request |

**Think of it as**:
- `active` = "Does this tool exist in this deployment?"
- `enabled` = "Has the user turned this tool on?"

---

## Troubleshooting

### Tool still appears after setting `active: false`

1. Ensure JSON syntax is valid (no trailing commas)
2. Restart the application
3. Clear browser cache / hard refresh (Ctrl+Shift+R)

### Nested tool still visible

Verify the `active: false` is on the correct nested tool object:

```json
{
  "tools": [
    {
      "id": "specific_tool",
      "active": false     // Must be inside the nested tool object
    }
  ]
}
```

### All tools disappeared

Check for JSON syntax errors. A malformed config may cause all tools to fail to load.

```bash
# Validate JSON syntax
cd chatbot-app/frontend/src/config
python -m json.tool tools-config.json > /dev/null && echo "Valid JSON"
```
