# Tasks: Knowledge Base Agent

**Input**: Design documents from `/specs/001-knowledge-base-agent/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/tools-api.md ✓

**Tests**: Per constitution, automated tests to be added later. Manual validation per quickstart.md.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `chatbot-app/agentcore/src/`
- **Frontend**: `chatbot-app/frontend/src/`
- **Infrastructure**: `agent-blueprint/agentcore-runtime-stack/lib/`

---

## Phase 1: Setup (Infrastructure)

**Purpose**: CDK infrastructure for S3, Bedrock KB, IAM permissions

- [ ] T001 Add S3 bucket for KB documents in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [ ] T002 Add S3 Vector Bucket resource (AWS::S3Vectors::VectorBucket) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [ ] T003 Add S3 Vector Index resource (float32, 1024 dims, cosine) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [ ] T004 Add Bedrock Knowledge Base resource (single shared KB, no default data source) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [ ] T005 Add IAM role for Bedrock KB service with S3/S3Vectors/Bedrock model access in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [ ] T006 Add IAM permissions for application execution role (Retrieve, RetrieveAndGenerate, StartIngestionJob, GetIngestionJob, CreateDataSource, DeleteDataSource) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [ ] T007 Add environment variables (KB_ID, KB_DOCS_BUCKET) to ECS task definition in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [ ] T008 Verify CDK synth completes without errors

**Checkpoint**: Infrastructure ready - deploy with `./deploy.sh --runtime`

---

## Phase 2: Foundational (Backend Core)

**Purpose**: Shared manager class and base tool structure that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T009 Create kb_catalog_manager.py with KBCatalogManager class skeleton in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T010 Implement DynamoDB client initialization and table reference in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T011 Implement Bedrock Agent client initialization in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T012 Implement S3 client initialization and bucket reference in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T013 Implement helper method _get_user_session_ids() for extracting context in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T014 Create knowledge_base_tools.py with imports and logger setup in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T015 Export KB tools in chatbot-app/agentcore/src/builtin_tools/__init__.py

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Create and Populate a Knowledge Base Catalog (Priority: P1) 🎯 MVP

**Goal**: Users can create a catalog, upload documents, and see indexing status

**Independent Test**: Create a catalog named "Test Research", upload a PDF, verify it shows "indexed" status

### Implementation for User Story 1

- [ ] T016 [US1] Implement _create_data_source() helper for Bedrock data source creation in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T017 [US1] Implement create_catalog_record() to store catalog in DynamoDB with data_source_id and s3_prefix in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T018 [US1] Implement catalog name validation (1-100 chars, alphanumeric + spaces/hyphens, unique per user) in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T019 [US1] Implement create_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T020 [US1] Implement upload_document() to upload file to S3 with proper path structure ({user_id}/{catalog_id}/) in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T021 [US1] Implement create_metadata_json() for companion metadata file with user_id, catalog_id, filename in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T022 [US1] Implement create_document_record() to store document metadata in DynamoDB in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T023 [US1] Implement start_ingestion() to trigger Bedrock ingestion job for catalog's data source in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T024 [US1] Implement upload_to_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T025 [US1] Implement get_ingestion_job_status() to check Bedrock ingestion job state in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T026 [US1] Implement update_document_status() to update DynamoDB document indexing_status in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T027 [US1] Implement update_catalog_status() to update overall catalog indexing_status in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T028 [US1] Implement get_indexing_status tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T029 [US1] Add error handling for file type validation (pdf, docx, txt, md, csv only) in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T030 [US1] Add error handling for file size validation (50MB max) in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T030a [US1] Add duplicate filename detection in upload_to_catalog with replace/rename prompt per edge case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 1 complete - users can create catalogs, upload documents, and see indexing progress

---

## Phase 4: User Story 2 - Query Documents Using RAG (Priority: P2)

**Goal**: Users can select a catalog and ask questions with source citations

**Independent Test**: Select a catalog with indexed documents, query "What are the main topics?", verify response includes citations

### Implementation for User Story 2

- [ ] T031 [US2] Implement set_selected_catalog() to store catalog selection in session state in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T032 [US2] Implement get_selected_catalog() to retrieve current catalog selection in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T033 [US2] Implement select_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T034 [US2] Implement query_knowledge_base() using bedrock-agent-runtime retrieve with metadata filters (user_id, catalog_id) in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T035 [US2] Implement format_citations() to extract and format source references from retrieval results in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T036 [US2] Implement query_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T037 [US2] Add error handling for no catalog selected case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T038 [US2] Add error handling for empty catalog (no indexed documents) case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 2 complete - users can query their documents with RAG and receive cited responses

---

## Phase 5: User Story 3 - Manage Catalog Contents (Priority: P3)

**Goal**: Users can view and manage documents within their catalogs

**Independent Test**: List documents in a catalog, delete one document, verify list updates and vectors are removed

### Implementation for User Story 3

- [ ] T039 [US3] Implement list_documents_in_catalog() to query DynamoDB for documents with DOCUMENT#{catalog_id}# prefix in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T040 [US3] Implement list_catalog_documents tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T041 [US3] Implement delete_s3_document() to remove document and metadata.json from S3 in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T042 [US3] Implement delete_document_record() to remove document from DynamoDB in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T043 [US3] Implement trigger_vector_cleanup() to start re-sync ingestion job to remove orphaned vectors in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T044 [US3] Implement update_catalog_document_count() to decrement document count after deletion in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T045 [US3] Implement delete_catalog_document tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T045a [US3] Implement generate_download_url() to create presigned S3 URL for document download in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T045b [US3] Implement download_from_catalog tool following contracts/tools-api.md pattern in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 3 complete - users can view document lists and delete individual documents

---

## Phase 6: User Story 4 - Browse and Select Catalogs (Priority: P4)

**Goal**: Users can view all their catalogs and delete entire catalogs

**Independent Test**: List all catalogs, delete one catalog, verify it and all its documents are removed

### Implementation for User Story 4

- [ ] T046 [US4] Implement list_user_catalogs() to query DynamoDB for catalogs with CATALOG# prefix in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T047 [US4] Implement list_catalogs tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T048 [US4] Implement delete_data_source() to remove Bedrock data source for catalog in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T049 [US4] Implement delete_all_catalog_documents() to batch delete all documents for catalog from S3 and DynamoDB in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T050 [US4] Implement delete_catalog_record() to remove catalog from DynamoDB in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [ ] T051 [US4] Implement delete_catalog tool with confirm parameter following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [ ] T052 [US4] Add error handling for catalog not found case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 4 complete - users can browse catalogs and delete entire catalogs

---

## Phase 7: Frontend Configuration

**Purpose**: Enable KB tools in the frontend UI

- [ ] T053 Add knowledge_base_tools group with all 9 tools to chatbot-app/frontend/src/config/tools-config.json
- [ ] T054 Add systemPromptGuidance for KB best practices in chatbot-app/frontend/src/config/tools-config.json
- [ ] T055 Configure displayName states (running/complete) for each tool in chatbot-app/frontend/src/config/tools-config.json

**Checkpoint**: Frontend configured - tools visible in UI dropdown

---

## Phase 8: Polish & Verification

**Purpose**: Validation and documentation

- [ ] T056 Run quickstart.md Step 4 local testing sequence (list, create, upload)
- [ ] T057 Verify create_catalog creates Bedrock data source with correct S3 inclusion prefix
- [ ] T058 Verify upload_to_catalog creates metadata.json with user_id, catalog_id fields
- [ ] T059 Verify query_catalog returns results with proper source citations
- [ ] T060 Verify delete_catalog removes data source, S3 objects, and DynamoDB records
- [ ] T061 Verify multi-tenant isolation (user A cannot see user B's catalogs)
- [ ] T062 Update __all__ exports in chatbot-app/agentcore/src/builtin_tools/__init__.py if any tools missing

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in priority order (P1 → P2 → P3 → P4)
  - Or in parallel if staffed (all can start after Foundational)
- **Frontend (Phase 7)**: Can start after Foundational, parallel to user stories
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Requires catalogs to exist (can use test data)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Requires documents to exist (can use test data)
- **User Story 4 (P4)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Manager methods before tool implementations
- Validation before happy path
- Error handling after core implementation

### Parallel Opportunities

- T001-T007 can run in parallel (different CDK constructs)
- T009-T013 can run in parallel (different manager methods)
- T016-T018 can run in parallel (create_catalog prerequisites)
- T031-T032 can run in parallel (select_catalog prerequisites)
- T039, T041-T044 can run in parallel (document management methods)
- T046, T048-T050 can run in parallel (catalog management methods)
- T053-T055 can run in parallel (different parts of tools-config.json)
- T056-T061 can run in parallel (independent verification tests)

---

## Parallel Example: User Story 1

```bash
# Launch manager methods in parallel:
Task: "Implement _create_data_source() helper" (T016)
Task: "Implement create_catalog_record()" (T017)
Task: "Implement catalog name validation" (T018)

# Then implement the tool:
Task: "Implement create_catalog tool" (T019)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (CDK infrastructure)
2. Complete Phase 2: Foundational (manager class)
3. Complete Phase 3: User Story 1 (create catalog, upload, indexing status)
4. **STOP and VALIDATE**: Test via quickstart.md Step 4
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test RAG queries → Deploy/Demo
4. Add User Story 3 → Test document management → Deploy/Demo
5. Add User Story 4 → Test catalog management → Deploy/Demo
6. Add Frontend Config → Enable UI → Final validation

### Recommended Order

For a single developer working sequentially:
1. Phase 1 (T001-T008): Infrastructure
2. Phase 2 (T009-T015): Foundational
3. Phase 3 (T016-T030): US1 - Create and Populate
4. Phase 4 (T031-T038): US2 - Query with RAG
5. Phase 5 (T039-T045): US3 - Manage Documents
6. Phase 6 (T046-T052): US4 - Browse Catalogs
7. Phase 7 (T053-T055): Frontend Config
8. Phase 8 (T056-T062): Polish & Verification

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
