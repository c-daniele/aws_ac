# Feature Specification: Dynamic Tool Activation

**Feature Branch**: `001-dynamic-tool-activation`
**Created**: 2026-02-03
**Status**: Draft
**Input**: User description: "Dynamic tool activation - Add an active flag to tools-config.json to hide and exclude tools from AUTO mode when not active"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deactivate Tools Before Deployment (Priority: P1)

An administrator wants to deploy the chatbot application without certain tools being available to users. They set the `active` flag to `false` for specific tools in the configuration file before deployment. When the application starts, those deactivated tools are completely hidden from the user interface and excluded from AI tool selection in AUTO mode.

**Why this priority**: This is the core functionality that enables deployment-time tool control, which is the primary use case described.

**Independent Test**: Can be fully tested by modifying `tools-config.json`, restarting the application, and verifying the deactivated tool is invisible and unavailable in all modes.

**Acceptance Scenarios**:

1. **Given** a tool has `"active": false` in tools-config.json, **When** a user opens the tools dropdown, **Then** the deactivated tool is not visible in the tool list.
2. **Given** a tool has `"active": false` in tools-config.json, **When** AUTO mode is enabled, **Then** the AI cannot select or use the deactivated tool.
3. **Given** a tool has `"active": true` (or the flag is omitted, defaulting to active), **When** a user opens the tools dropdown, **Then** the tool is visible and can be enabled.

---

### User Story 2 - Reactivate Tools Without Code Changes (Priority: P2)

An administrator wants to enable a previously deactivated tool. They change the `active` flag from `false` to `true` (or remove the flag to use the default) in the configuration file. After restarting the application, the tool becomes available to users.

**Why this priority**: Supports the bidirectional nature of tool activation, ensuring administrators can easily restore tool availability.

**Independent Test**: Can be tested by toggling the `active` flag, restarting the application, and verifying the tool appears/disappears accordingly.

**Acceptance Scenarios**:

1. **Given** a tool had `"active": false` and is changed to `"active": true`, **When** the application restarts, **Then** the tool appears in the tools dropdown and can be enabled by users.
2. **Given** a tool has the `active` field removed (previously `false`), **When** the application restarts, **Then** the tool defaults to active and appears in the tools dropdown.

---

### User Story 3 - Dynamic Tool Groups with Nested Tools (Priority: P2)

An administrator wants to deactivate an entire tool group (e.g., "Word Documents" which contains multiple nested tools). They set `"active": false` on the parent tool group. All nested tools within that group become unavailable to users.

**Why this priority**: Many tools in the system are grouped (isDynamic: true), and administrators need consistent behavior across tool types.

**Independent Test**: Can be tested by deactivating a dynamic tool group and verifying none of its nested tools are visible or usable.

**Acceptance Scenarios**:

1. **Given** a dynamic tool group has `"active": false`, **When** a user opens the tools dropdown, **Then** the entire tool group and all its nested tools are hidden.
2. **Given** a dynamic tool group has `"active": true` but a specific nested tool has `"active": false`, **When** a user opens the tools dropdown, **Then** the tool group is visible but the specific nested tool is hidden.

---

### Edge Cases

- What happens when all tools in a category are deactivated? The category section should be hidden or show an empty state.
- How does the system handle a tool with `"enabled": true` but `"active": false`? The `active` flag takes precedence - the tool is not available regardless of `enabled` state.
- What happens if the `active` flag is missing from an existing tool definition? The tool defaults to active (`active: true`) for backward compatibility.
- How does deactivation affect existing user sessions with the tool selected? The tool is removed from enabled tools for new requests; existing session state is unaffected until refresh.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support an `active` boolean flag on each tool configuration entry in `tools-config.json`.
- **FR-002**: System MUST treat tools without an explicit `active` flag as active (`active: true`) by default for backward compatibility.
- **FR-003**: System MUST filter out tools with `active: false` from the available tools list before rendering the UI.
- **FR-004**: System MUST exclude tools with `active: false` from the tool selection pool in AUTO mode.
- **FR-005**: System MUST exclude tools with `active: false` from the backend tool filter registry.
- **FR-006**: System MUST support the `active` flag on both top-level tools and nested tools within dynamic tool groups.
- **FR-007**: System MUST remove deactivated tools from any user's enabled tools list when processing requests.
- **FR-008**: System MUST apply the `active` flag filter before any other tool filtering logic (enabled state, search queries, etc.).

### Key Entities

- **Tool Configuration**: A tool definition that includes `id`, `name`, `description`, `enabled`, and the new `active` flag. The `active` flag determines deployment-time availability.
- **Tool Filter Chain**: The sequence of filters applied to determine final tool availability: `active` → `enabled` → user selection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a tool has `"active": false`, it is not visible in the tools dropdown under any circumstances.
- **SC-002**: When a tool has `"active": false`, AUTO mode never selects or attempts to use that tool.
- **SC-003**: Administrators can deactivate/reactivate any tool by modifying only the configuration file (no code changes required).
- **SC-004**: 100% of existing tools continue to function normally when the `active` flag is not specified (backward compatibility).
- **SC-005**: Tool activation changes take effect after application restart without requiring database migrations or additional sync operations.

## Assumptions

- The `active` flag is evaluated at application startup or configuration reload time, not dynamically during runtime.
- Backward compatibility is essential - existing deployments without `active` flags should continue working unchanged.
- The `enabled` flag remains for user session-level tool selection; `active` is for deployment-time availability control.
- Tool sync to DynamoDB (mentioned in tools-config.json comment) respects the `active` flag by excluding inactive tools.
