# Research: Dynamic Tool Activation

**Feature**: 001-dynamic-tool-activation
**Date**: 2026-02-03

## Research Summary

This feature requires minimal research as the implementation is straightforward configuration filtering. The main decisions involve filter placement and backward compatibility handling.

---

## Decision 1: Filter Placement

**Question**: Where should the `active` flag filtering occur?

**Decision**: Frontend API layer (`/api/tools/route.ts`)

**Rationale**:
- Single point of filtering serves both manual selection and AUTO mode
- UI components never see inactive tools, preventing accidental selection
- Backend receives only active tool IDs, no additional validation needed
- Minimal code changes (one location)
- Follows Constitution Principle V (Simplicity & Maintainability)

**Alternatives Considered**:

| Alternative | Pros | Cons | Rejected Because |
| ----------- | ---- | ---- | ---------------- |
| Filter in UI components | Closest to render | Multiple filter points, complex | Violates single responsibility |
| Filter in backend | Defense in depth | Redundant, tools already filtered | Over-engineering |
| Filter at config load time | Early filtering | Loses original config state | May need full config for admin views |

---

## Decision 2: Default Value Handling

**Question**: How should tools without an `active` field be treated?

**Decision**: Default to `active: true` (tool is active)

**Rationale**:
- Backward compatibility with existing configurations
- No changes required to existing tools-config.json entries
- Opt-out model (explicitly set `active: false` to deactivate)
- Follows principle of least surprise

**Alternatives Considered**:

| Alternative | Pros | Cons | Rejected Because |
| ----------- | ---- | ---- | ---------------- |
| Default to `false` | Explicit activation | Breaking change, all tools invisible | Backward incompatible |
| Require field on all tools | Explicit state | Large config changes needed | Unnecessary migration burden |

---

## Decision 3: Nested Tool Handling

**Question**: How should `active` flag work with dynamic tool groups?

**Decision**: Independent evaluation at each level

**Rationale**:
- Parent `active: false` → entire group hidden (including nested tools)
- Parent `active: true`, nested `active: false` → group visible, specific nested tool hidden
- Provides fine-grained control over tool availability
- Consistent with how `enabled` flag already works

**Implementation Detail**:
```
Tool Group (isDynamic: true, active: true)
├── Nested Tool A (active: true)  → Visible
├── Nested Tool B (active: false) → Hidden
└── Nested Tool C (active: true)  → Visible
```

---

## Decision 4: DynamoDB Sync Behavior

**Question**: Should inactive tools be synced to DynamoDB?

**Decision**: Sync all tools (including inactive) to DynamoDB

**Rationale**:
- DynamoDB stores the complete tool registry for reference
- Filtering happens at runtime, not storage
- Allows toggling tools active/inactive without re-sync
- Admin may need to see complete tool inventory

**Note**: User enabled tools in DynamoDB only contain tool IDs, not the `active` flag. The filtering happens when loading tools from the registry.

---

## Technical Findings

### Current Tool Structure

From `tools-config.json` analysis:

```json
{
  "id": "tool_id",
  "name": "Tool Name",
  "description": "...",
  "category": "utilities",
  "enabled": false,        // User session state (existing)
  "active": true,          // Deployment availability (NEW)
  "isDynamic": false,      // Whether tool has nested tools
  "tools": []              // Nested tools for dynamic groups
}
```

### Filter Logic Pattern

```typescript
// Filter tools where active !== false (undefined defaults to true)
const activeTools = tools.filter(tool => tool.active !== false);

// For dynamic tools, also filter nested tools
const processedTools = activeTools.map(tool => {
  if (tool.isDynamic && tool.tools) {
    return {
      ...tool,
      tools: tool.tools.filter(nested => nested.active !== false)
    };
  }
  return tool;
});
```

### Edge Cases Identified

1. **All nested tools inactive**: Parent group should be hidden (empty group)
2. **Tool in user's enabled list but now inactive**: Remove from effective enabled list
3. **Category with all tools inactive**: Category should not render
4. **Search results for inactive tool**: No results (tool not in searchable list)

---

## Conclusion

No further research required. The implementation approach is clear:

1. Add `active` field to tool schema
2. Filter in `/api/tools/route.ts` before returning tools
3. Handle nested tools recursively
4. Default missing `active` to `true` for backward compatibility
