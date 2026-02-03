# Implementation Plan: Dynamic Tool Activation

**Branch**: `001-dynamic-tool-activation` | **Date**: 2026-02-03 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-dynamic-tool-activation/spec.md`

## Summary

Add an `active` boolean flag to tool configurations in `tools-config.json` that controls deployment-time tool availability. When `active: false`, the tool is completely hidden from the UI and excluded from AUTO mode tool selection. This differs from the existing `enabled` flag which controls user session-level selection. The implementation filters inactive tools at the API layer, ensuring they never reach the UI or backend.

## Technical Context

**Language/Version**: TypeScript (Next.js 16) for frontend, Python 3.13 for backend
**Primary Dependencies**: React 18, Next.js, FastAPI, Strands Agents SDK
**Storage**: DynamoDB for tool registry sync, local JSON for development
**Testing**: Manual validation (automated testing not yet established per constitution)
**Target Platform**: AWS (ECS, DynamoDB, Bedrock AgentCore)
**Project Type**: Web application (frontend + backend)
**Performance Goals**: No degradation from current tool loading performance
**Constraints**: Must maintain backward compatibility with existing tool configurations
**Scale/Scope**: Affects all tool categories: local, builtin, browser_automation, gateway, a2a

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Serverless-First Design | ✅ PASS | No new infrastructure required; uses existing DynamoDB sync |
| II. Multi-Agent Architecture | ✅ PASS | Filtering happens at config layer, agents receive pre-filtered tools |
| III. Infrastructure as Code | ✅ PASS | No CDK changes required; config-only change |
| IV. Full-Stack Consistency | ✅ PASS | Both frontend and backend will respect `active` flag consistently |
| V. Simplicity & Maintainability | ✅ PASS | Single flag, single filter point, minimal code changes |

**Gate Result**: ✅ PASSED - All principles satisfied

## Project Structure

### Documentation (this feature)

```text
specs/001-dynamic-tool-activation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (N/A - no API changes)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
chatbot-app/
├── frontend/
│   └── src/
│       ├── config/
│       │   └── tools-config.json     # Add active flag to tool definitions
│       ├── app/api/
│       │   └── tools/route.ts        # Filter inactive tools before returning
│       └── types/
│           └── chat.ts               # Update Tool interface (if needed)
│
└── agentcore/
    └── src/
        └── agent/
            └── tool_filter.py        # Optional: validate active tools only
```

**Structure Decision**: Web application structure - changes span frontend config, API route, and optional backend validation.

## Complexity Tracking

> No violations identified - no entries needed

## Implementation Approach

### Filter Location Strategy

The `active` flag filtering will be implemented at the **frontend API layer** (`/api/tools/route.ts`):

1. **Why at API layer**:
   - Single point of filtering for both manual selection and AUTO mode
   - UI never sees inactive tools, so users can't accidentally enable them
   - Backend receives only active tool IDs from the UI
   - Simplest implementation with minimal touch points

2. **Filter order**:
   ```
   tools-config.json → filter(active !== false) → apply user enabled state → return to UI
   ```

3. **Backward compatibility**:
   - Tools without `active` field default to `active: true`
   - No database migration needed
   - Existing deployments continue working unchanged

### Component Changes

| Component | Change | Impact |
|-----------|--------|--------|
| `tools-config.json` | Add `active` field schema | Configuration only |
| `/api/tools/route.ts` | Filter tools where `active !== false` | Core filtering logic |
| Tool types (optional) | Add `active?: boolean` to interfaces | Type safety |
| Backend `tool_filter.py` | No changes required | Tools pre-filtered by frontend |

### Testing Strategy

Since automated testing is not yet established (per constitution), validation will use:

1. **Manual testing**: Set `active: false` on various tool types, verify invisibility
2. **Console logging**: Add debug logs for filtered tool counts
3. **Verification matrix**:
   - Local tools with `active: false` → not visible
   - Dynamic tool groups with `active: false` → not visible
   - Nested tools with `active: false` → parent visible, nested hidden
   - AUTO mode with inactive tools → AI cannot select them
