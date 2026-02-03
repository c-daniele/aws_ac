# Tasks: Dynamic Tool Activation

**Input**: Design documents from `/specs/001-dynamic-tool-activation/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, quickstart.md ✓

**Tests**: Manual validation only (per constitution - automated tests not yet established)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Frontend**: `chatbot-app/frontend/src/`
- **Backend**: `chatbot-app/agentcore/src/`

---

## Phase 1: Setup

**Purpose**: Understand current implementation and prepare for changes

- [x] T001 Read current tool loading in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [x] T002 Read current Tool type definition in `chatbot-app/frontend/src/types/chat.ts`
- [x] T003 [P] Read current tools-config.json structure in `chatbot-app/frontend/src/config/tools-config.json`

---

## Phase 2: Foundational (Type Definitions)

**Purpose**: Add TypeScript type support for the `active` field

**⚠️ CRITICAL**: Type changes must be complete before filtering implementation

- [x] T004 Add `active?: boolean` field to Tool interface in `chatbot-app/frontend/src/types/chat.ts`
- [x] T005 Add `active?: boolean` field to NestedTool interface (if separate) in `chatbot-app/frontend/src/types/chat.ts`

**Checkpoint**: TypeScript types now support the `active` field

---

## Phase 3: User Story 1 - Deactivate Tools Before Deployment (Priority: P1) 🎯 MVP

**Goal**: Admin can set `active: false` on tools in config to hide them from UI and AUTO mode

**Independent Test**: Set `active: false` on Calculator tool, restart app, verify tool not visible in dropdown

### Implementation for User Story 1

- [x] T006 [US1] Create `filterActiveTools` helper function in `chatbot-app/frontend/src/app/api/tools/route.ts` that filters tools where `active !== false`
- [x] T007 [US1] Apply `filterActiveTools` to `local_tools` array before mapping to response in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [x] T008 [US1] Apply `filterActiveTools` to `builtin_tools` array before mapping to response in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [x] T009 [US1] Apply `filterActiveTools` to `browser_automation` array before mapping to response in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [x] T010 [US1] Apply `filterActiveTools` to `gateway_targets` array before mapping to response in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [x] T011 [US1] Apply `filterActiveTools` to `agentcore_runtime_a2a` array before mapping to response in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [x] T012 [US1] Add debug logging for filtered tool counts (before/after) in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [x] T013 [US1] Set `active: false` on Calculator tool in `chatbot-app/frontend/src/config/tools-config.json` to test filtering
- [ ] T014 [US1] Manual validation: Start app, verify Calculator not visible in tools dropdown
- [ ] T015 [US1] Manual validation: Enable AUTO mode, verify AI cannot select Calculator tool
- [ ] T016 [US1] Revert Calculator to `active: true` after validation in `chatbot-app/frontend/src/config/tools-config.json`

**Checkpoint**: Basic tool deactivation works - tools with `active: false` are hidden from UI and AUTO mode

---

## Phase 4: User Story 2 - Reactivate Tools Without Code Changes (Priority: P2)

**Goal**: Admin can toggle `active` flag or remove it to reactivate tools

**Independent Test**: Set `active: false` on a tool, restart, verify hidden. Then change to `active: true` or remove field, restart, verify visible.

### Implementation for User Story 2

- [ ] T017 [US2] Verify `filterActiveTools` function treats missing `active` field as `true` (backward compatible) in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [ ] T018 [US2] Manual validation: Remove `active` field from a tool that had `active: true`, verify tool still visible
- [ ] T019 [US2] Manual validation: Change tool from `active: false` to `active: true`, restart, verify tool appears

**Checkpoint**: Bidirectional activation works - tools can be deactivated and reactivated via config

---

## Phase 5: User Story 3 - Dynamic Tool Groups with Nested Tools (Priority: P2)

**Goal**: Admin can deactivate tool groups or individual nested tools

**Independent Test**: Set `active: false` on Word Documents group, verify entire group hidden. Then set only one nested tool to `active: false`, verify parent visible but nested tool hidden.

### Implementation for User Story 3

- [ ] T020 [US3] Create `filterNestedTools` helper function that filters nested tools with `active !== false` in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [ ] T021 [US3] Modify `filterActiveTools` to also call `filterNestedTools` for dynamic tools (isDynamic: true) in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [ ] T022 [US3] Add logic to hide parent tool group if all nested tools are filtered out in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [ ] T023 [US3] Set `active: false` on entire `word_document_tools` group in `chatbot-app/frontend/src/config/tools-config.json` to test group deactivation
- [ ] T024 [US3] Manual validation: Verify Word Documents group not visible in tools dropdown
- [ ] T025 [US3] Revert `word_document_tools` to active, then set `active: false` on only `modify_word_document` nested tool in `chatbot-app/frontend/src/config/tools-config.json`
- [ ] T026 [US3] Manual validation: Verify Word Documents group is visible but Modify Document is hidden
- [ ] T027 [US3] Revert all test changes in `chatbot-app/frontend/src/config/tools-config.json`

**Checkpoint**: Nested tool filtering works at both group and individual level

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, edge cases, and documentation

- [ ] T028 [P] Remove any inactive tool IDs from user's enabled tools list when loading in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [ ] T029 [P] Add JSDoc comments to `filterActiveTools` and `filterNestedTools` functions in `chatbot-app/frontend/src/app/api/tools/route.ts`
- [ ] T030 Verify existing tools without `active` field still work (backward compatibility smoke test)
- [ ] T031 Run quickstart.md validation scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories (type definitions needed)
- **User Story 1 (Phase 3)**: Depends on Phase 2 - Core filtering implementation
- **User Story 2 (Phase 4)**: Depends on Phase 3 - Verifies backward compatibility
- **User Story 3 (Phase 5)**: Depends on Phase 3 - Extends filtering to nested tools
- **Polish (Phase 6)**: Depends on all user stories complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - Core MVP
- **User Story 2 (P2)**: Can start after User Story 1 - Validation of default behavior
- **User Story 3 (P2)**: Can start after User Story 1 - Extends to nested tools

### Within Each User Story

- Implementation tasks in order (function definition → application → validation)
- Validation tasks after implementation
- Revert test changes after validation

### Parallel Opportunities

- Setup tasks T001, T002, T003 can run in parallel (reading different files)
- Polish tasks T028, T029 can run in parallel (different concerns)
- User Stories 2 and 3 could run in parallel after US1 is complete

---

## Parallel Example: Setup Phase

```bash
# Launch all setup reads together:
Task: "Read current tool loading in chatbot-app/frontend/src/app/api/tools/route.ts"
Task: "Read current Tool type definition in chatbot-app/frontend/src/types/chat.ts"
Task: "Read current tools-config.json structure in chatbot-app/frontend/src/config/tools-config.json"
```

## Parallel Example: User Story 1 (Apply filters)

```bash
# After T006 creates filterActiveTools, apply to all tool arrays in parallel:
Task: "Apply filterActiveTools to local_tools array"
Task: "Apply filterActiveTools to builtin_tools array"
Task: "Apply filterActiveTools to browser_automation array"
Task: "Apply filterActiveTools to gateway_targets array"
Task: "Apply filterActiveTools to agentcore_runtime_a2a array"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (understand current code)
2. Complete Phase 2: Foundational (add type definition)
3. Complete Phase 3: User Story 1 (core filtering)
4. **STOP and VALIDATE**: Test tool deactivation works
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Types ready
2. Add User Story 1 → Test filtering → Deploy (MVP!)
3. Add User Story 2 → Verify backward compatibility
4. Add User Story 3 → Test nested tools → Deploy full feature
5. Each story adds value without breaking previous functionality

---

## Notes

- [P] tasks = different files, no dependencies between them
- [Story] label maps task to specific user story for traceability
- Manual validation is per constitution (automated tests not yet established)
- Commit after each phase or logical group of tasks
- All config changes for testing should be reverted after validation
- The `active` field defaults to `true` when missing for backward compatibility
