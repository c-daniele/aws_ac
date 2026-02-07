"""
Knowledge Base Tools - Tools for managing and querying document catalogs with RAG.

Tools:
1. create_catalog - Create a new document catalog
2. list_catalogs - List all user catalogs
3. upload_to_catalog - Upload document to catalog
4. list_catalog_documents - List documents in a catalog
5. select_catalog - Set active catalog for queries
6. query_catalog - RAG query against catalog
7. get_indexing_status - Check indexing progress
8. delete_catalog_document - Delete a document
9. delete_catalog - Delete entire catalog
10. download_from_catalog - Get download link for document

These tools use the shared Bedrock Knowledge Base with per-catalog data sources.
Metadata filtering (user_id, catalog_id) provides multi-tenant isolation.
"""

import os
import base64
import logging
from decimal import Decimal
from typing import Dict, Any, Optional
from strands import tool, ToolContext
from workspace.kb_catalog_manager import KBCatalogManager

logger = logging.getLogger(__name__)


def _convert_decimals(obj: Any) -> Any:
    """Recursively convert Decimal values to int or float.

    DynamoDB returns numbers as Decimal, which are not JSON serializable.
    This converts them to native Python types.
    """
    if isinstance(obj, Decimal):
        # Convert to int if it's a whole number, otherwise float
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    elif isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_decimals(item) for item in obj]
    return obj


def _get_manager(tool_context: ToolContext) -> KBCatalogManager:
    """Get KBCatalogManager instance from tool context."""
    user_id, session_id = KBCatalogManager.get_user_session_ids(tool_context)
    return KBCatalogManager(user_id, session_id)


def _error_response(message: str, error_code: str = "ERROR", metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Create standardized error response."""
    # Convert any Decimal values in metadata to native Python types
    converted_metadata = _convert_decimals(metadata) if metadata else {}
    return {
        "content": [{"text": f"Error: {message}"}],
        "status": "error",
        "metadata": {"error_code": error_code, "tool_type": "knowledge_base", **converted_metadata},
    }


def _success_response(
    message: str, metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Create standardized success response."""
    # Convert any Decimal values in metadata to native Python types
    converted_metadata = _convert_decimals(metadata) if metadata else {}
    return {
        "content": [{"text": message}],
        "status": "success",
        "metadata": {**converted_metadata, "tool_type": "knowledge_base"},
    }


# ============================================================
# T019: create_catalog tool
# ============================================================


@tool(context=True)
def create_catalog(
    catalog_name: str, description: str = "", tool_context: ToolContext = None
) -> Dict[str, Any]:
    """Create a new knowledge base catalog for organizing documents.

    Catalogs are containers for related documents that can be queried using RAG.
    Each catalog gets its own Bedrock data source for independent indexing.

    Args:
        catalog_name: Name for the catalog (1-100 chars, alphanumeric + spaces/hyphens)
        description: Optional description of the catalog's contents

    Returns:
        Dict with catalog metadata including catalog_id
    """
    try:
        manager = _get_manager(tool_context)

        # Validate catalog name
        is_valid, error_msg = manager.validate_catalog_name(catalog_name)
        if not is_valid:
            return _error_response(error_msg, "INVALID_NAME")

        # Check catalog limit
        existing = manager.list_user_catalogs()
        if len(existing) >= manager.MAX_CATALOGS_PER_USER:
            return _error_response(
                f"Maximum catalog limit ({manager.MAX_CATALOGS_PER_USER}) reached",
                "LIMIT_EXCEEDED",
            )

        # Create data source first
        catalog_id = manager._generate_catalog_id()
        data_source_id = ""

        try:
            # Create Bedrock data source for this catalog
            data_source_id = manager.create_data_source(catalog_id, catalog_name)
        except Exception as e:
            logger.warning(f"Could not create data source (may be local dev): {e}")

        # Create catalog record in DynamoDB
        # Pass the same catalog_id used for the data source to ensure S3 paths match
        catalog = manager.create_catalog_record(
            catalog_name=catalog_name,
            description=description,
            data_source_id=data_source_id,
            catalog_id=catalog_id,
        )

        return _success_response(
            f"Created catalog '{catalog_name}' (ID: {catalog['catalog_id']}). Ready for document uploads.",
            {
                "catalog_id": catalog["catalog_id"],
                "catalog_name": catalog_name,
                "data_source_id": data_source_id,
                "s3_prefix": catalog["s3_prefix"],
            },
        )

    except Exception as e:
        logger.error(f"create_catalog error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T047: list_catalogs tool
# ============================================================


@tool(context=True)
def list_catalogs(tool_context: ToolContext = None) -> Dict[str, Any]:
    """List all knowledge base catalogs owned by the current user.

    Shows catalog names, document counts, indexing status, and last update time.

    Returns:
        Dict with list of catalogs and their metadata
    """
    try:
        manager = _get_manager(tool_context)
        catalogs = manager.list_user_catalogs()

        if not catalogs:
            return _success_response(
                "No catalogs found. Create one with create_catalog.",
                {"catalog_count": 0, "catalogs": []},
            )

        # Format output
        lines = [f"Found {len(catalogs)} catalog(s):\n"]
        catalog_list = []

        for cat in catalogs:
            status = cat.get("indexing_status", "unknown")
            doc_count = cat.get("document_count", 0)
            size_mb = cat.get("total_size_bytes", 0) / (1024 * 1024)

            lines.append(f"**{cat['catalog_name']}** ({cat['catalog_id']})")
            lines.append(f"  - {doc_count} documents, {size_mb:.1f} MB")
            lines.append(f"  - Status: {status}")

            catalog_list.append(
                {
                    "catalog_id": cat["catalog_id"],
                    "catalog_name": cat["catalog_name"],
                    "document_count": doc_count,
                    "total_size_mb": round(size_mb, 2),
                    "indexing_status": status,
                    "description": cat.get("description", ""),
                }
            )

        return _success_response(
            "\n".join(lines), {"catalog_count": len(catalogs), "catalogs": catalog_list}
        )

    except Exception as e:
        logger.error(f"list_catalogs error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T024: upload_to_catalog tool
# ============================================================


@tool(context=True)
def upload_to_catalog(
    catalog_id: str,
    filename: str,
    replace: bool = False,
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Upload a document to a knowledge base catalog for RAG indexing.

    IMPORTANT: This tool retrieves file content from the uploaded files in the current
    conversation. The user must have attached/uploaded the file in their message.
    DO NOT pass file content as a parameter - only specify the filename.

    Supported formats: PDF, DOCX, TXT, MD, CSV (max 50MB)

    Args:
        catalog_id: Target catalog ID
        filename: Filename of the uploaded file (must match an attached file)
        replace: If True, replace existing file with same name

    Returns:
        Dict with document metadata and indexing status
    """
    try:
        manager = _get_manager(tool_context)

        # Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        # T029: Validate file type
        is_valid, error_msg = manager.validate_file_type(filename)
        if not is_valid:
            return _error_response(error_msg, "INVALID_FILE_TYPE")

        # Retrieve file content from invocation_state (uploaded files)
        # This prevents the LLM from needing to pass large file content as a parameter
        file_bytes = None
        uploaded_files = tool_context.invocation_state.get("uploaded_files", [])

        # Try exact match first, then case-insensitive match
        for uploaded_file in uploaded_files:
            if uploaded_file.get("filename") == filename:
                file_bytes = uploaded_file.get("bytes")
                break

        # Try case-insensitive match if exact match failed
        if file_bytes is None:
            filename_lower = filename.lower()
            for uploaded_file in uploaded_files:
                if uploaded_file.get("filename", "").lower() == filename_lower:
                    file_bytes = uploaded_file.get("bytes")
                    filename = uploaded_file.get("filename")  # Use actual filename
                    break

        if file_bytes is None:
            available_files = [f.get("filename") for f in uploaded_files]
            if available_files:
                return _error_response(
                    f"File '{filename}' not found in uploaded files. "
                    f"Available files: {', '.join(available_files)}. "
                    "Please ensure the file is attached to your message.",
                    "FILE_NOT_FOUND",
                )
            else:
                return _error_response(
                    f"No files were uploaded in this message. "
                    "Please attach the file you want to upload to the catalog.",
                    "NO_FILES_UPLOADED",
                )

        # T030: Validate file size
        is_valid, error_msg = manager.validate_file_size(len(file_bytes))
        if not is_valid:
            return _error_response(error_msg, "FILE_TOO_LARGE")

        # T030a: Check for duplicate filename
        existing_doc = manager.check_duplicate_filename(catalog_id, filename)
        if existing_doc and not replace:
            return _error_response(
                f"File '{filename}' already exists. Use replace=true to overwrite or rename the file.",
                "DUPLICATE_FILE",
            )

        # If replacing, delete the old document first
        if existing_doc and replace:
            manager.delete_s3_document(existing_doc.get("s3_key", ""))
            manager.delete_document_record(
                catalog_id, existing_doc.get("document_id", "")
            )

        # Extract file type
        file_type = (
            filename.lower().rsplit(".", 1)[-1] if "." in filename else "unknown"
        )

        # Generate document ID
        document_id = manager._generate_document_id()

        # Upload to S3
        s3_key = manager.upload_document(catalog_id, document_id, filename, file_bytes)

        # Create metadata.json for Bedrock KB
        manager.create_metadata_json(catalog_id, document_id, filename, s3_key)

        # Create document record
        doc_record = manager.create_document_record(
            catalog_id=catalog_id,
            filename=filename,
            file_type=file_type,
            file_size_bytes=len(file_bytes),
            s3_key=s3_key,
        )

        # Update document status to pending
        manager.update_document_status(catalog_id, document_id, "pending")

        # Update catalog document count and total size
        manager.update_catalog_document_count(catalog_id, 1)
        manager.update_catalog_total_size(catalog_id, len(file_bytes))

        # Start ingestion job if data source exists
        data_source_id = catalog.get("data_source_id")
        if data_source_id:
            try:
                job_id = manager.start_ingestion(data_source_id)
                manager.update_document_status(catalog_id, document_id, "indexing")
                manager.update_catalog_status(catalog_id, "indexing")
            except Exception as e:
                logger.warning(f"Could not start ingestion (may be local dev): {e}")

        size_kb = len(file_bytes) / 1024

        return _success_response(
            f"Uploaded '{filename}' to catalog '{catalog['catalog_name']}'. Indexing started.",
            {
                "document_id": document_id,
                "catalog_id": catalog_id,
                "filename": filename,
                "file_size_kb": round(size_kb, 1),
                "indexing_status": "pending",
                "s3_key": s3_key,
            },
        )

    except Exception as e:
        logger.error(f"upload_to_catalog error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T040: list_catalog_documents tool
# ============================================================


@tool(context=True)
def list_catalog_documents(
    catalog_id: str, tool_context: ToolContext = None
) -> Dict[str, Any]:
    """List all documents in a specific catalog.

    Shows document names, sizes, indexing status, and upload dates.

    Args:
        catalog_id: Catalog to list documents from

    Returns:
        Dict with list of documents and their metadata
    """
    try:
        manager = _get_manager(tool_context)

        # Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        documents = manager.list_documents_in_catalog(catalog_id)

        if not documents:
            return _success_response(
                f"Catalog '{catalog['catalog_name']}' is empty. Upload documents with upload_to_catalog.",
                {"catalog_id": catalog_id, "document_count": 0, "documents": []},
            )

        # Format as table
        lines = [
            f"Catalog '{catalog['catalog_name']}' contains {len(documents)} document(s):\n"
        ]
        lines.append("| Filename | Size | Status | Uploaded |")
        lines.append("|----------|------|--------|----------|")

        doc_list = []
        for doc in documents:
            size_kb = doc.get("file_size_bytes", 0) / 1024
            status = doc.get("indexing_status", "unknown")
            uploaded = doc.get("uploaded_at", "")
            if uploaded:
                # Convert epoch ms to date (DynamoDB returns Decimal, convert to int)
                from datetime import datetime

                uploaded = datetime.fromtimestamp(int(uploaded) / 1000).strftime(
                    "%Y-%m-%d"
                )

            doc_name = doc.get("filename", doc.get("document_id", "unknown"))
            lines.append(f"| {doc_name} | {size_kb:.1f} KB | {status} | {uploaded} |")

            doc_list.append(
                {
                    "document_id": doc.get("document_id", "unknown"),
                    "filename": doc_name,
                    "file_size_kb": round(size_kb, 1),
                    "indexing_status": status,
                    "uploaded_at": uploaded,
                }
            )

        return _success_response(
            "\n".join(lines),
            {
                "catalog_id": catalog_id,
                "document_count": len(documents),
                "documents": doc_list,
            },
        )

    except Exception as e:
        logger.error(f"list_catalog_documents error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T033: select_catalog tool
# ============================================================


@tool(context=True)
def select_catalog(catalog_id: str, tool_context: ToolContext = None) -> Dict[str, Any]:
    """Set the active catalog for RAG queries in this session.

    Once selected, query_catalog can be called without specifying catalog_id.
    Use catalog_id="none" to deselect.

    Args:
        catalog_id: Catalog to select (or "none" to deselect)

    Returns:
        Dict confirming selection with catalog details
    """
    try:
        manager = _get_manager(tool_context)

        if catalog_id.lower() == "none":
            manager.set_selected_catalog(None)
            return _success_response(
                "Catalog deselected. Specify catalog_id when querying.",
                {"catalog_id": None, "active": False},
            )

        # Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        # Check if catalog has documents
        doc_count = catalog.get("document_count", 0)
        if doc_count == 0:
            return _error_response(
                f"Catalog '{catalog['catalog_name']}' has no documents. Upload some first.",
                "CATALOG_EMPTY",
            )

        manager.set_selected_catalog(catalog_id)

        return _success_response(
            f"Selected catalog '{catalog['catalog_name']}' for queries. "
            f"Ask me anything about your {doc_count} document(s)!",
            {
                "catalog_id": catalog_id,
                "catalog_name": catalog["catalog_name"],
                "document_count": doc_count,
                "active": True,
            },
        )

    except Exception as e:
        logger.error(f"select_catalog error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T036: query_catalog tool
# ============================================================


@tool(context=True)
def query_catalog(
    query: str,
    catalog_id: str = None,
    num_results: int = 5,
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Query the knowledge base using RAG with source citations.

    Retrieves relevant document chunks and provides cited responses.

    Args:
        query: Natural language question about your documents
        catalog_id: Catalog to query (uses selected catalog if not provided)
        num_results: Maximum sources to retrieve (default: 5, max: 20)

    Returns:
        Dict with answer and source citations
    """
    try:
        manager = _get_manager(tool_context)

        # T037: Determine catalog to query
        if not catalog_id:
            catalog_id = manager.get_selected_catalog()
            if not catalog_id:
                return _error_response(
                    "No catalog selected. Use select_catalog first or specify catalog_id.",
                    "NO_CATALOG_SELECTED",
                )

        # Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        # T038: Check if catalog has indexed documents
        documents = manager.list_documents_in_catalog(catalog_id)
        indexed_docs = [d for d in documents if d.get("indexing_status") == "indexed"]

        if not indexed_docs and len(documents) > 0:
            indexing_count = len(
                [d for d in documents if d.get("indexing_status") == "indexing"]
            )
            if indexing_count > 0:
                return _error_response(
                    f"Documents are still being indexed ({indexing_count} in progress). "
                    "Please wait a few minutes and try again.",
                    "INDEXING_IN_PROGRESS",
                )

        if not documents:
            return _error_response(
                f"Catalog '{catalog['catalog_name']}' has no indexed documents.",
                "CATALOG_EMPTY",
            )

        # Query the knowledge base
        result = manager.query_knowledge_base(query, catalog_id, num_results)
        results = result.get("results", [])

        if not results:
            return _success_response(
                "No relevant information found for your query. Try rephrasing or checking "
                "that your documents contain related content.",
                {"query": query, "catalog_id": catalog_id, "sources": []},
            )

        # Format citations
        citations = manager.format_citations(results)

        # Build response with citations
        lines = ["Based on your documents:\n"]

        for citation in citations:
            lines.append(f"**Source {citation['index']}: {citation['filename']}**")
            lines.append(f"> {citation['text']}")
            lines.append("")

        lines.append("\n**Sources:**")
        for citation in citations:
            lines.append(
                f"{citation['index']}. {citation['filename']} (relevance: {citation['score']:.2f})"
            )

        return _success_response(
            "\n".join(lines),
            {"query": query, "catalog_id": catalog_id, "sources": citations},
        )

    except Exception as e:
        logger.error(f"query_catalog error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T028: get_indexing_status tool
# ============================================================


@tool(context=True)
def get_indexing_status(
    catalog_id: str, tool_context: ToolContext = None
) -> Dict[str, Any]:
    """Check the indexing status of documents in a catalog.

    This tool polls Bedrock for the actual ingestion job status and
    updates the DynamoDB records with the latest state.

    Shows overall catalog status and per-document indexing progress.

    Args:
        catalog_id: Catalog to check status for

    Returns:
        Dict with indexing status for catalog and documents
    """
    try:
        manager = _get_manager(tool_context)

        # Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        # Sync status from Bedrock (polls latest ingestion job)
        sync_result = manager.sync_catalog_status_from_bedrock(catalog_id)

        # Re-fetch catalog and documents after sync
        catalog = manager.get_catalog(catalog_id)
        documents = manager.list_documents_in_catalog(catalog_id)

        # Count by status
        status_counts = {
            "indexed": 0,
            "indexing": 0,
            "pending": 0,
            "failed": 0,
            "uploading": 0,
        }

        for doc in documents:
            status = doc.get("indexing_status", "unknown")
            if status in status_counts:
                status_counts[status] += 1

        total = len(documents)
        overall_status = catalog.get("indexing_status", "unknown")

        # Build status message
        lines = [f"Catalog '{catalog['catalog_name']}' indexing status:\n"]

        # Show sync info if available
        if sync_result.get("bedrock_status"):
            lines.append(
                f"- **Bedrock Job Status**: {sync_result.get('bedrock_status')}"
            )
            stats = sync_result.get("statistics", {})
            if stats:
                lines.append(
                    f"- **Stats**: {stats.get('numberOfDocumentsScanned', 0)} scanned, "
                    f"{stats.get('numberOfNewDocumentsIndexed', 0)} new, "
                    f"{stats.get('numberOfModifiedDocumentsIndexed', 0)} modified, "
                    f"{stats.get('numberOfDocumentsFailed', 0)} failed"
                )

        lines.append(
            f"- **Overall**: {overall_status} ({status_counts['indexed']} of {total} documents ready)"
        )

        if documents:
            lines.append("\n**Documents:**")
            for doc in documents:
                status = doc.get("indexing_status", "unknown")
                icon = (
                    "✓"
                    if status == "indexed"
                    else (
                        "⏳"
                        if status == "indexing"
                        else "✗"
                        if status == "failed"
                        else "○"
                    )
                )
                doc_name = doc.get("filename", doc.get("document_id", "unknown"))
                error_msg = doc.get("error_message", "")
                status_text = f"{icon} {status}"
                if error_msg:
                    status_text += f" - {error_msg}"
                lines.append(f"- {doc_name}: {status_text}")

        return _success_response(
            "\n".join(lines),
            {
                "catalog_id": catalog_id,
                "overall_status": overall_status,
                "bedrock_status": sync_result.get("bedrock_status"),
                "job_id": sync_result.get("job_id"),
                "statistics": sync_result.get("statistics", {}),
                "documents": {
                    "indexed": status_counts["indexed"],
                    "indexing": status_counts["indexing"],
                    "pending": status_counts["pending"],
                    "failed": status_counts["failed"],
                },
            },
        )

    except Exception as e:
        logger.error(f"get_indexing_status error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T045: delete_catalog_document tool
# ============================================================


@tool(context=True)
def delete_catalog_document(
    catalog_id: str, document_id: str, tool_context: ToolContext = None
) -> Dict[str, Any]:
    """Delete a document from a catalog and remove its vectors.

    Deletes the S3 object, metadata file, and DynamoDB record.
    Triggers a re-sync to remove orphaned vectors.

    Args:
        catalog_id: Catalog containing the document
        document_id: Document to delete

    Returns:
        Dict confirming deletion
    """
    try:
        manager = _get_manager(tool_context)

        # Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        # Verify document exists
        document = manager.get_document(catalog_id, document_id)
        if not document:
            return _error_response(
                f"Document '{document_id}' not found", "DOCUMENT_NOT_FOUND"
            )

        filename = document.get("filename", "Unknown")
        file_size = document.get("file_size_bytes", 0)

        # Delete from S3
        if document.get("s3_key"):
            manager.delete_s3_document(document["s3_key"])

        # Delete DynamoDB record
        manager.delete_document_record(catalog_id, document_id)

        # Update catalog document count and total size
        manager.update_catalog_document_count(catalog_id, -1)
        if file_size > 0:
            manager.update_catalog_total_size(catalog_id, -file_size)

        # Trigger vector cleanup if data source exists
        data_source_id = catalog.get("data_source_id")
        if data_source_id:
            try:
                manager.trigger_vector_cleanup(data_source_id)
            except Exception as e:
                logger.warning(f"Could not trigger vector cleanup: {e}")

        return _success_response(
            f"Deleted '{filename}' from catalog. Vector cleanup initiated.",
            {"document_id": document_id, "filename": filename, "vectors_removed": True},
        )

    except Exception as e:
        logger.error(f"delete_catalog_document error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T045b: download_from_catalog tool
# ============================================================


@tool(context=True)
def download_from_catalog(
    catalog_id: str, document_id: str, tool_context: ToolContext = None
) -> Dict[str, Any]:
    """Get a presigned download URL for a document.

    The URL expires in 15 minutes.

    Args:
        catalog_id: Catalog containing the document
        document_id: Document to download

    Returns:
        Dict with download URL and expiration time
    """
    try:
        manager = _get_manager(tool_context)

        # Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        # Verify document exists
        document = manager.get_document(catalog_id, document_id)
        if not document:
            return _error_response(
                f"Document '{document_id}' not found", "DOCUMENT_NOT_FOUND"
            )

        filename = document.get("filename", "Unknown")
        s3_key = document.get("s3_key")

        if not s3_key:
            return _error_response("Document has no S3 location", "NO_S3_KEY")

        # Generate presigned URL
        download_url = manager.generate_download_url(s3_key, expiration=900)

        return _success_response(
            f"Download link for '{filename}' (expires in 15 minutes):\n{download_url}",
            {
                "document_id": document_id,
                "filename": filename,
                "download_url": download_url,
                "expires_in_seconds": 900,
            },
        )

    except Exception as e:
        logger.error(f"download_from_catalog error: {e}", exc_info=True)
        return _error_response(str(e))


# ============================================================
# T051: delete_catalog tool
# ============================================================


@tool(context=True)
def delete_catalog(
    catalog_id: str, confirm: bool = False, tool_context: ToolContext = None
) -> Dict[str, Any]:
    """Delete an entire catalog, its documents, and data source.

    This is a destructive operation. Set confirm=True to proceed.

    Args:
        catalog_id: Catalog to delete
        confirm: Must be True to proceed with deletion

    Returns:
        Dict confirming deletion with cleanup details
    """
    try:
        manager = _get_manager(tool_context)

        # T052: Verify catalog exists
        catalog = manager.get_catalog(catalog_id)
        if not catalog:
            return _error_response(
                f"Catalog '{catalog_id}' not found", "CATALOG_NOT_FOUND"
            )

        catalog_name = catalog["catalog_name"]
        doc_count = catalog.get("document_count", 0)

        if not confirm:
            return _error_response(
                f"Deleting catalog '{catalog_name}' will remove {doc_count} document(s) permanently. "
                "Set confirm=True to proceed.",
                "CONFIRMATION_REQUIRED",
            )

        # Delete all documents
        deleted_count = manager.delete_all_catalog_documents(catalog_id)

        # Delete data source
        data_source_id = catalog.get("data_source_id")
        data_source_deleted = False
        if data_source_id:
            try:
                manager.delete_data_source(data_source_id)
                data_source_deleted = True
            except Exception as e:
                logger.warning(f"Could not delete data source: {e}")

        # Delete catalog record
        manager.delete_catalog_record(catalog_id)

        return _success_response(
            f"Deleted catalog '{catalog_name}' and all {deleted_count} document(s). "
            f"Data source and vectors removed.",
            {
                "catalog_id": catalog_id,
                "documents_deleted": deleted_count,
                "data_source_deleted": data_source_deleted,
                "vectors_cleanup_initiated": True,
            },
        )

    except Exception as e:
        logger.error(f"delete_catalog error: {e}", exc_info=True)
        return _error_response(str(e))


# Export all tools
__all__ = [
    "create_catalog",
    "list_catalogs",
    "upload_to_catalog",
    "list_catalog_documents",
    "select_catalog",
    "query_catalog",
    "get_indexing_status",
    "delete_catalog_document",
    "download_from_catalog",
    "delete_catalog",
]
