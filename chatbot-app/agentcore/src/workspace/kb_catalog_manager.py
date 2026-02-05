"""
Knowledge Base Catalog Manager - Manages KB catalogs and documents for RAG capabilities.

This manager handles:
- Catalog CRUD operations (DynamoDB storage)
- Document storage in S3 with metadata.json files
- Bedrock Knowledge Base data source management (one per catalog)
- Ingestion job triggering and status tracking

DynamoDB Schema (dedicated kb-catalog table):
- Table: {project}-kb-catalog
- PK: catalog_id
- SK: METADATA (for catalog records) or DOC#{document_id} (for document records)
- GSI: user_id-index (PK: user_id, projection: KEYS_ONLY) for listing user's catalogs

S3 Structure:
- s3://{bucket}/{user_id}/{catalog_id}/{document_id}-{filename}
- s3://{bucket}/{user_id}/{catalog_id}/{document_id}-{filename}.metadata.json
"""

import os
import re
import json
import uuid
import logging
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class KBCatalogManager:
    """
    Manager for Knowledge Base catalogs and documents.

    Uses a single shared Bedrock Knowledge Base with per-catalog data sources.
    Metadata filtering (user_id, catalog_id) provides multi-tenant isolation.
    """

    # Allowed file types for KB documents
    ALLOWED_FILE_TYPES = {"pdf", "docx", "txt", "md", "csv"}

    # Maximum file size (50MB)
    MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

    # Maximum catalogs per user
    MAX_CATALOGS_PER_USER = 100

    # Maximum documents per catalog
    MAX_DOCUMENTS_PER_CATALOG = 500

    def __init__(self, user_id: str, session_id: str):
        """
        Initialize KBCatalogManager.

        Args:
            user_id: Cognito user identifier (partition key)
            session_id: Current session identifier
        """
        # T013: Validate identifiers for security
        if not re.match(r"^[a-zA-Z0-9_-]+$", user_id):
            raise ValueError(f"Invalid user_id format: {user_id}")
        if not re.match(r"^[a-zA-Z0-9_-]+$", session_id):
            raise ValueError(f"Invalid session_id format: {session_id}")

        self.user_id = user_id
        self.session_id = session_id

        # T010: DynamoDB client initialization
        self.region = os.getenv("AWS_REGION", "us-west-2")
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.project_name = os.getenv("PROJECT_NAME", "strands-agent-chatbot")
        # T014/T015: Use dedicated kb-catalog table with env var fallback
        self.table_name = os.getenv(
            "KB_CATALOG_TABLE", f"{self.project_name}-kb-catalog"
        )
        self.table = self.dynamodb.Table(self.table_name)

        # T011: Bedrock Agent client initialization
        self.bedrock_agent = boto3.client("bedrock-agent", region_name=self.region)
        self.bedrock_runtime = boto3.client(
            "bedrock-agent-runtime", region_name=self.region
        )

        # T012: S3 client initialization
        self.s3_client = boto3.client("s3")
        self.kb_docs_bucket = os.getenv("KB_DOCS_BUCKET")
        if not self.kb_docs_bucket:
            logger.warning("KB_DOCS_BUCKET environment variable not set")

        # Knowledge Base ID from environment
        self.kb_id = os.getenv("KB_ID")
        if not self.kb_id:
            logger.warning("KB_ID environment variable not set")

        # Session state for selected catalog
        self._selected_catalog_id: Optional[str] = None

        logger.info(
            f"KBCatalogManager initialized: user={user_id}, session={session_id}"
        )
        logger.info(f"KB_ID={self.kb_id}, KB_DOCS_BUCKET={self.kb_docs_bucket}")

    # ============================================================
    # T013: Helper method to extract user/session IDs from ToolContext
    # ============================================================

    @staticmethod
    def get_user_session_ids(tool_context) -> Tuple[str, str]:
        """Extract user_id and session_id from ToolContext.

        Args:
            tool_context: Strands ToolContext object

        Returns:
            Tuple of (user_id, session_id)
        """
        invocation_state = tool_context.invocation_state
        user_id = invocation_state.get("user_id", "default_user")
        session_id = invocation_state.get("session_id", "default_session")
        logger.info(f"Extracted IDs: user_id={user_id}, session_id={session_id}")
        return user_id, session_id

    # ============================================================
    # Catalog Validation Helpers
    # ============================================================

    def validate_catalog_name(self, catalog_name: str) -> Tuple[bool, Optional[str]]:
        """Validate catalog name format and uniqueness.

        Args:
            catalog_name: Proposed catalog name

        Returns:
            Tuple of (is_valid, error_message)

        T029: Query GSI for uniqueness check per user
        """
        # Check length
        if not catalog_name or len(catalog_name) < 1:
            return False, "Catalog name cannot be empty"
        if len(catalog_name) > 100:
            return False, "Catalog name must be 100 characters or less"

        # Check characters (alphanumeric, spaces, hyphens, underscores)
        if not re.match(r"^[a-zA-Z0-9\s\-_]+$", catalog_name):
            return (
                False,
                "Catalog name can only contain letters, numbers, spaces, hyphens, and underscores",
            )

        # Check for uniqueness (case-insensitive) using GSI
        try:
            existing_catalogs = self.list_user_catalogs()
            for cat in existing_catalogs:
                if cat.get("catalog_name", "").lower() == catalog_name.lower():
                    return False, f"A catalog named '{catalog_name}' already exists"
        except Exception as e:
            logger.error(f"Error checking catalog uniqueness: {e}")
            # Allow creation if we can't verify uniqueness

        return True, None

    def _generate_catalog_id(self) -> str:
        """Generate a unique catalog ID."""
        return f"cat-{uuid.uuid4().hex[:12]}"

    def _generate_document_id(self) -> str:
        """Generate a unique document ID."""
        return f"doc-{uuid.uuid4().hex[:12]}"

    def _get_timestamp(self) -> int:
        """Get current timestamp in milliseconds."""
        return int(datetime.utcnow().timestamp() * 1000)

    # ============================================================
    # Catalog CRUD Operations (Phase 3 - US1)
    # ============================================================

    def create_catalog_record(
        self,
        catalog_name: str,
        description: str = "",
        data_source_id: str = "",
        catalog_id: str = "",
    ) -> Dict[str, Any]:
        """Create a new catalog record in DynamoDB.

        Args:
            catalog_name: User-provided catalog name
            description: Optional description
            data_source_id: Bedrock data source ID for this catalog
            catalog_id: Pre-generated catalog ID (if empty, will generate new one)

        Returns:
            Dict with catalog metadata

        New key schema (T016):
        - PK: catalog_id
        - SK: METADATA
        - user_id stored as regular attribute for GSI
        """
        if not catalog_id:
            catalog_id = self._generate_catalog_id()
        timestamp = self._get_timestamp()
        s3_prefix = f"{self.user_id}/{catalog_id}/"

        # T016/T027: New key schema with catalog_id as PK and user_id as attribute
        item = {
            "catalog_id": catalog_id,  # PK
            "sk": "METADATA",  # SK for catalog records
            "user_id": self.user_id,  # T027: Regular attribute for GSI
            "catalog_name": catalog_name,
            "description": description,
            "data_source_id": data_source_id,
            "s3_prefix": s3_prefix,
            "created_at": timestamp,
            "updated_at": timestamp,
            "document_count": 0,
            "total_size_bytes": 0,
            "indexing_status": "pending",
            "last_sync_at": None,
        }

        self.table.put_item(Item=item)
        logger.info(f"!!! Created catalog: {catalog_id} - {catalog_name}")

        return item

    def get_catalog(self, catalog_id: str) -> Optional[Dict[str, Any]]:
        """Get a catalog by ID.

        Args:
            catalog_id: Catalog identifier

        Returns:
            Catalog dict or None if not found

        T018: New key schema - PK=catalog_id, SK=METADATA
        """
        try:
            response = self.table.get_item(
                Key={"catalog_id": catalog_id, "sk": "METADATA"}
            )
            item = response.get("Item")
            # Verify ownership (multi-tenant isolation)
            if item and item.get("user_id") != self.user_id:
                logger.warning(f"Catalog {catalog_id} belongs to different user")
                return None
            return item
        except Exception as e:
            logger.error(f"Error getting catalog {catalog_id}: {e}")
            return None

    def list_user_catalogs(self) -> List[Dict[str, Any]]:
        """List all catalogs for the current user.

        Returns:
            List of catalog dicts

        T020: Query GSI user_id-index, then fetch full items
        """
        try:
            # Step 1: Query GSI to get catalog_ids for this user
            response = self.table.query(
                IndexName="user_id-index",
                KeyConditionExpression="user_id = :uid",
                ExpressionAttributeValues={":uid": self.user_id},
            )

            # GSI returns only keys (KEYS_ONLY projection)
            catalog_keys = response.get("Items", [])

            if not catalog_keys:
                return []

            # Step 2: Batch get full catalog records
            # Filter to only METADATA records (catalogs, not documents)
            catalogs = []
            for key_item in catalog_keys:
                catalog_id = key_item.get("catalog_id")
                sk = key_item.get("sk", "")
                # Only fetch catalog metadata records, not document records
                if sk == "METADATA":
                    catalog = self.get_catalog(catalog_id)
                    if catalog:
                        catalogs.append(catalog)

            return catalogs
        except Exception as e:
            logger.error(f"Error listing catalogs: {e}")
            return []

    def update_catalog_status(
        self, catalog_id: str, indexing_status: str, last_sync_at: Optional[int] = None
    ) -> bool:
        """Update catalog indexing status.

        Args:
            catalog_id: Catalog identifier
            indexing_status: New status (pending, indexing, ready, error)
            last_sync_at: Optional sync timestamp

        Returns:
            True if successful

        T024: New key schema - PK=catalog_id, SK=METADATA
        """
        try:
            update_expr = "SET indexing_status = :status, updated_at = :updated"
            expr_values = {
                ":status": indexing_status,
                ":updated": self._get_timestamp(),
                ":uid": self.user_id,
            }

            if last_sync_at is not None:
                update_expr += ", last_sync_at = :sync"
                expr_values[":sync"] = last_sync_at

            self.table.update_item(
                Key={"catalog_id": catalog_id, "sk": "METADATA"},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
                ConditionExpression="user_id = :uid",
            )
            logger.info(f"Updated catalog {catalog_id} status to {indexing_status}")
            return True
        except Exception as e:
            logger.error(f"Error updating catalog status: {e}")
            return False

    def delete_catalog_record(self, catalog_id: str) -> bool:
        """Delete a catalog record from DynamoDB.

        Args:
            catalog_id: Catalog identifier

        Returns:
            True if successful

        T022: New key schema - PK=catalog_id, SK=METADATA
        """
        try:
            # Verify ownership before delete
            catalog = self.get_catalog(catalog_id)
            if not catalog:
                logger.warning(f"Catalog {catalog_id} not found or not owned by user")
                return False

            self.table.delete_item(Key={"catalog_id": catalog_id, "sk": "METADATA"})
            logger.info(f"Deleted catalog record: {catalog_id}")
            return True
        except Exception as e:
            logger.error(f"Error deleting catalog record: {e}")
            return False

    # ============================================================
    # Document CRUD Operations (Phase 3 - US1)
    # ============================================================

    def create_document_record(
        self,
        catalog_id: str,
        filename: str,
        file_type: str,
        file_size_bytes: int,
        s3_key: str,
    ) -> Dict[str, Any]:
        """Create a document record in DynamoDB.

        Args:
            catalog_id: Parent catalog ID
            filename: Original filename
            file_type: File extension (pdf, docx, etc.)
            file_size_bytes: File size
            s3_key: Full S3 object key

        Returns:
            Dict with document metadata

        T017/T028: New key schema - PK=catalog_id, SK=DOC#{document_id}
        user_id stored as regular attribute (denormalized)
        """
        document_id = self._generate_document_id()
        timestamp = self._get_timestamp()

        item = {
            "catalog_id": catalog_id,  # PK
            "sk": f"DOC#{document_id}",  # SK for document records
            "document_id": document_id,
            "user_id": self.user_id,  # T028: Denormalized for queries/filtering
            "filename": filename,
            "file_type": file_type,
            "file_size_bytes": file_size_bytes,
            "s3_key": s3_key,
            "uploaded_at": timestamp,
            "indexed_at": None,
            "indexing_status": "uploading",
            "error_message": None,
        }

        self.table.put_item(Item=item)
        logger.info(f"Created document record: {document_id} - {filename}")

        return item

    def get_document(
        self, catalog_id: str, document_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get a document by ID.

        Args:
            catalog_id: Catalog identifier
            document_id: Document identifier

        Returns:
            Document dict or None if not found

        T019: New key schema - PK=catalog_id, SK=DOC#{document_id}
        """
        try:
            response = self.table.get_item(
                Key={
                    "catalog_id": catalog_id,
                    "sk": f"DOC#{document_id}",
                }
            )
            item = response.get("Item")
            # Verify ownership (multi-tenant isolation)
            if item and item.get("user_id") != self.user_id:
                logger.warning(f"Document {document_id} belongs to different user")
                return None
            return item
        except Exception as e:
            logger.error(f"Error getting document {document_id}: {e}")
            return None

    def list_documents_in_catalog(self, catalog_id: str) -> List[Dict[str, Any]]:
        """List all documents in a catalog.

        Args:
            catalog_id: Catalog identifier

        Returns:
            List of document dicts

        T021: New key schema - PK=catalog_id, SK begins_with DOC#
        """
        try:
            # Verify user owns this catalog first
            catalog = self.get_catalog(catalog_id)
            if not catalog:
                logger.warning(f"Catalog {catalog_id} not found or not owned by user")
                return []

            response = self.table.query(
                KeyConditionExpression="catalog_id = :cid AND begins_with(sk, :prefix)",
                ExpressionAttributeValues={
                    ":cid": catalog_id,
                    ":prefix": "DOC#",
                },
            )
            return response.get("Items", [])
        except Exception as e:
            logger.error(f"Error listing documents: {e}")
            return []

    def update_document_status(
        self,
        catalog_id: str,
        document_id: str,
        indexing_status: str,
        indexed_at: Optional[int] = None,
        error_message: Optional[str] = None,
    ) -> bool:
        """Update document indexing status.

        Args:
            catalog_id: Catalog identifier
            document_id: Document identifier
            indexing_status: New status
            indexed_at: Optional indexing timestamp
            error_message: Optional error message for failed status

        Returns:
            True if successful

        T025: New key schema - PK=catalog_id, SK=DOC#{document_id}
        """
        try:
            update_expr = "SET indexing_status = :status"
            expr_values = {
                ":status": indexing_status,
                ":uid": self.user_id,
            }

            if indexed_at is not None:
                update_expr += ", indexed_at = :indexed"
                expr_values[":indexed"] = indexed_at

            if error_message is not None:
                update_expr += ", error_message = :error"
                expr_values[":error"] = error_message

            self.table.update_item(
                Key={
                    "catalog_id": catalog_id,
                    "sk": f"DOC#{document_id}",
                },
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
                ConditionExpression="user_id = :uid",
            )
            logger.info(f"Updated document {document_id} status to {indexing_status}")
            return True
        except Exception as e:
            logger.error(f"Error updating document status: {e}")
            return False

    def delete_document_record(self, catalog_id: str, document_id: str) -> bool:
        """Delete a document record from DynamoDB.

        Args:
            catalog_id: Catalog identifier
            document_id: Document identifier

        Returns:
            True if successful

        T023: New key schema - PK=catalog_id, SK=DOC#{document_id}
        """
        try:
            # Verify ownership before delete
            doc = self.get_document(catalog_id, document_id)
            if not doc:
                logger.warning(f"Document {document_id} not found or not owned by user")
                return False

            self.table.delete_item(
                Key={
                    "catalog_id": catalog_id,
                    "sk": f"DOC#{document_id}",
                }
            )
            logger.info(f"Deleted document record: {document_id}")
            return True
        except Exception as e:
            logger.error(f"Error deleting document record: {e}")
            return False

    def update_catalog_document_count(self, catalog_id: str, delta: int) -> bool:
        """Update catalog document count and total size.

        Args:
            catalog_id: Catalog identifier
            delta: Change in document count (+1 or -1)

        Returns:
            True if successful

        T026: New key schema - PK=catalog_id, SK=METADATA
        """
        try:
            self.table.update_item(
                Key={"catalog_id": catalog_id, "sk": "METADATA"},
                UpdateExpression="SET document_count = document_count + :delta, updated_at = :updated",
                ExpressionAttributeValues={
                    ":delta": delta,
                    ":updated": self._get_timestamp(),
                    ":uid": self.user_id,
                },
                ConditionExpression="user_id = :uid",
            )
            return True
        except Exception as e:
            logger.error(f"Error updating catalog document count: {e}")
            return False

    def update_catalog_total_size(self, catalog_id: str, size_delta_bytes: int) -> bool:
        """Update catalog total_size_bytes.

        Args:
            catalog_id: Catalog identifier
            size_delta_bytes: Change in size (positive for add, negative for delete)

        Returns:
            True if successful
        """
        try:
            self.table.update_item(
                Key={"catalog_id": catalog_id, "sk": "METADATA"},
                UpdateExpression="SET total_size_bytes = if_not_exists(total_size_bytes, :zero) + :delta, updated_at = :updated",
                ExpressionAttributeValues={
                    ":delta": size_delta_bytes,
                    ":zero": 0,
                    ":updated": self._get_timestamp(),
                    ":uid": self.user_id,
                },
                ConditionExpression="user_id = :uid",
            )
            logger.info(
                f"Updated catalog {catalog_id} total_size_bytes by {size_delta_bytes}"
            )
            return True
        except Exception as e:
            logger.error(f"Error updating catalog total size: {e}")
            return False

    # ============================================================
    # S3 Document Operations (Phase 3 - US1)
    # ============================================================

    def upload_document(
        self, catalog_id: str, document_id: str, filename: str, file_content: bytes
    ) -> str:
        """Upload document to S3.

        Args:
            catalog_id: Catalog identifier
            document_id: Document identifier
            filename: Original filename
            file_content: File content bytes

        Returns:
            S3 key of uploaded document
        """
        s3_key = f"{self.user_id}/{catalog_id}/{document_id}-{filename}"

        self.s3_client.put_object(
            Bucket=self.kb_docs_bucket,
            Key=s3_key,
            Body=file_content,
            ContentType=self._get_content_type(filename),
        )

        logger.info(f"Uploaded document to S3: {s3_key}")
        return s3_key

    def create_metadata_json(
        self, catalog_id: str, document_id: str, filename: str, s3_key: str
    ) -> str:
        """Create metadata.json companion file for Bedrock KB.

        Args:
            catalog_id: Catalog identifier
            document_id: Document identifier
            filename: Original filename
            s3_key: S3 key of the document

        Returns:
            S3 key of metadata file
        """
        metadata = {
            "metadataAttributes": {
                "user_id": {
                    "value": {"type": "STRING", "stringValue": self.user_id},
                    "includeForEmbedding": False,
                },
                "catalog_id": {
                    "value": {"type": "STRING", "stringValue": catalog_id},
                    "includeForEmbedding": False,
                },
                "document_id": {
                    "value": {"type": "STRING", "stringValue": document_id},
                    "includeForEmbedding": False,
                },
                "filename": {
                    "value": {"type": "STRING", "stringValue": filename},
                    "includeForEmbedding": False,
                },
                "uploaded_at": {
                    "value": {
                        "type": "NUMBER",
                        "numberValue": int(datetime.utcnow().timestamp()),
                    },
                    "includeForEmbedding": False,
                    "isFilterable": False,
                },
            }
        }

        metadata_key = f"{s3_key}.metadata.json"

        self.s3_client.put_object(
            Bucket=self.kb_docs_bucket,
            Key=metadata_key,
            Body=json.dumps(metadata),
            ContentType="application/json",
        )

        logger.info(f"Created metadata file: {metadata_key}")
        return metadata_key

    def delete_s3_document(self, s3_key: str) -> bool:
        """Delete document and its metadata file from S3.

        Args:
            s3_key: S3 key of the document

        Returns:
            True if successful
        """
        try:
            # Delete document
            self.s3_client.delete_object(Bucket=self.kb_docs_bucket, Key=s3_key)

            # Delete metadata file
            metadata_key = f"{s3_key}.metadata.json"
            self.s3_client.delete_object(Bucket=self.kb_docs_bucket, Key=metadata_key)

            logger.info(f"Deleted S3 document and metadata: {s3_key}")
            return True
        except Exception as e:
            logger.error(f"Error deleting S3 document: {e}")
            return False

    def generate_download_url(self, s3_key: str, expiration: int = 900) -> str:
        """Generate presigned URL for document download.

        Args:
            s3_key: S3 key of the document
            expiration: URL expiration in seconds (default: 15 minutes)

        Returns:
            Presigned download URL
        """
        url = self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.kb_docs_bucket, "Key": s3_key},
            ExpiresIn=expiration,
        )
        logger.info(f"Generated presigned URL for {s3_key}")
        return url

    def delete_all_catalog_documents(self, catalog_id: str) -> int:
        """Delete all documents for a catalog from S3 and DynamoDB.

        Args:
            catalog_id: Catalog identifier

        Returns:
            Number of documents deleted
        """
        # Get all documents
        documents = self.list_documents_in_catalog(catalog_id)
        deleted_count = 0

        for doc in documents:
            try:
                # Delete from S3
                if doc.get("s3_key"):
                    self.delete_s3_document(doc["s3_key"])

                # Delete DynamoDB record
                self.delete_document_record(catalog_id, doc["document_id"])
                deleted_count += 1
            except Exception as e:
                logger.error(f"Error deleting document {doc.get('document_id')}: {e}")

        logger.info(f"Deleted {deleted_count} documents from catalog {catalog_id}")
        return deleted_count

    def _get_content_type(self, filename: str) -> str:
        """Get MIME content type for filename."""
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        content_types = {
            "pdf": "application/pdf",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "txt": "text/plain",
            "md": "text/markdown",
            "csv": "text/csv",
        }
        return content_types.get(ext, "application/octet-stream")

    # ============================================================
    # Bedrock Data Source Operations (Phase 3 - US1)
    # ============================================================

    def create_data_source(self, catalog_id: str, catalog_name: str) -> str:
        """Create a Bedrock data source for a catalog.

        Each catalog gets its own data source pointing to its S3 prefix.
        This enables concurrent ingestion jobs.

        Args:
            catalog_id: Catalog identifier
            catalog_name: Catalog name for data source name

        Returns:
            Data source ID
        """
        if not self.kb_id:
            raise ValueError("KB_ID environment variable not set")
        if not self.kb_docs_bucket:
            raise ValueError("KB_DOCS_BUCKET environment variable not set")

        s3_prefix = f"{self.user_id}/{catalog_id}/"
        data_source_name = f"{self.user_id[:8]}-{catalog_id}"

        response = self.bedrock_agent.create_data_source(
            knowledgeBaseId=self.kb_id,
            name=data_source_name,
            description=f"Data source for catalog: {catalog_name}",
            dataSourceConfiguration={
                "type": "S3",
                "s3Configuration": {
                    "bucketArn": f"arn:aws:s3:::{self.kb_docs_bucket}",
                    "inclusionPrefixes": [s3_prefix],
                },
            },
        )

        data_source_id = response["dataSource"]["dataSourceId"]
        logger.info(f"Created data source {data_source_id} for catalog {catalog_id}")

        return data_source_id

    def delete_data_source(self, data_source_id: str) -> bool:
        """Delete a Bedrock data source.

        Args:
            data_source_id: Data source identifier

        Returns:
            True if successful
        """
        if not self.kb_id:
            raise ValueError("KB_ID environment variable not set")

        try:
            self.bedrock_agent.delete_data_source(
                knowledgeBaseId=self.kb_id, dataSourceId=data_source_id
            )
            logger.info(f"Deleted data source: {data_source_id}")
            return True
        except ClientError as e:
            logger.error(f"Error deleting data source: {e}")
            return False

    def start_ingestion(self, data_source_id: str) -> str:
        """Start an ingestion job for a data source.

        Args:
            data_source_id: Data source identifier

        Returns:
            Ingestion job ID
        """
        if not self.kb_id:
            raise ValueError("KB_ID environment variable not set")

        response = self.bedrock_agent.start_ingestion_job(
            knowledgeBaseId=self.kb_id, dataSourceId=data_source_id
        )

        job_id = response["ingestionJob"]["ingestionJobId"]
        logger.info(f"Started ingestion job {job_id} for data source {data_source_id}")

        return job_id

    def get_ingestion_job_status(
        self, data_source_id: str, job_id: str
    ) -> Dict[str, Any]:
        """Get the status of an ingestion job.

        Args:
            data_source_id: Data source identifier
            job_id: Ingestion job identifier

        Returns:
            Dict with job status and statistics
        """
        if not self.kb_id:
            raise ValueError("KB_ID environment variable not set")

        response = self.bedrock_agent.get_ingestion_job(
            knowledgeBaseId=self.kb_id,
            dataSourceId=data_source_id,
            ingestionJobId=job_id,
        )

        job = response["ingestionJob"]
        return {
            "status": job["status"],
            "started_at": job.get("startedAt"),
            "updated_at": job.get("updatedAt"),
            "statistics": job.get("statistics", {}),
            "failure_reasons": job.get("failureReasons", []),
        }

    def trigger_vector_cleanup(self, data_source_id: str) -> str:
        """Trigger a re-sync ingestion to clean up orphaned vectors.

        When documents are deleted, this re-syncs the data source
        to remove vectors for deleted documents.

        Args:
            data_source_id: Data source identifier

        Returns:
            Ingestion job ID
        """
        return self.start_ingestion(data_source_id)

    def get_latest_ingestion_job(self, data_source_id: str) -> Optional[Dict[str, Any]]:
        """Get the most recent ingestion job for a data source.

        Args:
            data_source_id: Data source identifier

        Returns:
            Dict with latest job info or None if no jobs found
        """
        if not self.kb_id:
            raise ValueError("KB_ID environment variable not set")

        try:
            response = self.bedrock_agent.list_ingestion_jobs(
                knowledgeBaseId=self.kb_id,
                dataSourceId=data_source_id,
                maxResults=1,
                sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
            )

            jobs = response.get("ingestionJobSummaries", [])
            if not jobs:
                return None

            latest = jobs[0]
            return {
                "job_id": latest.get("ingestionJobId"),
                "status": latest.get("status"),
                "started_at": latest.get("startedAt"),
                "updated_at": latest.get("updatedAt"),
                "statistics": latest.get("statistics", {}),
            }
        except ClientError as e:
            logger.error(f"Error listing ingestion jobs: {e}")
            return None

    def sync_catalog_status_from_bedrock(self, catalog_id: str) -> Dict[str, Any]:
        """Sync catalog and document status from Bedrock ingestion job status.

        Polls Bedrock for the latest ingestion job status and updates
        DynamoDB records accordingly.

        Args:
            catalog_id: Catalog identifier

        Returns:
            Dict with sync results
        """
        catalog = self.get_catalog(catalog_id)
        if not catalog:
            return {"error": "Catalog not found"}

        data_source_id = catalog.get("data_source_id")
        if not data_source_id:
            return {"error": "No data source configured", "status": "no_data_source"}

        # Get latest ingestion job
        latest_job = self.get_latest_ingestion_job(data_source_id)
        if not latest_job:
            return {
                "status": "no_jobs",
                "catalog_status": catalog.get("indexing_status"),
            }

        job_status = latest_job.get("status", "UNKNOWN")
        statistics = latest_job.get("statistics", {})

        # Map Bedrock status to our status
        # Bedrock statuses: STARTING, IN_PROGRESS, COMPLETE, FAILED, STOPPING, STOPPED
        status_map = {
            "STARTING": "indexing",
            "IN_PROGRESS": "indexing",
            "COMPLETE": "ready",
            "FAILED": "error",
            "STOPPING": "indexing",
            "STOPPED": "error",
        }
        new_status = status_map.get(job_status, "unknown")

        # Update catalog status
        last_sync_at = None
        if job_status == "COMPLETE":
            last_sync_at = self._get_timestamp()

        self.update_catalog_status(catalog_id, new_status, last_sync_at)

        # Update document statuses based on job completion
        documents = self.list_documents_in_catalog(catalog_id)
        docs_updated = 0

        if job_status == "COMPLETE":
            # Mark all documents as indexed
            for doc in documents:
                if doc.get("indexing_status") != "indexed":
                    self.update_document_status(
                        catalog_id,
                        doc["document_id"],
                        "indexed",
                        indexed_at=self._get_timestamp(),
                    )
                    docs_updated += 1
        elif job_status == "FAILED":
            # Mark documents as failed
            for doc in documents:
                if doc.get("indexing_status") in ("pending", "indexing", "uploading"):
                    failure_reasons = latest_job.get("failure_reasons", [])
                    error_msg = (
                        "; ".join(failure_reasons)
                        if failure_reasons
                        else "Ingestion failed"
                    )
                    self.update_document_status(
                        catalog_id,
                        doc["document_id"],
                        "failed",
                        error_message=error_msg,
                    )
                    docs_updated += 1

        return {
            "status": new_status,
            "bedrock_status": job_status,
            "job_id": latest_job.get("job_id"),
            "statistics": statistics,
            "documents_updated": docs_updated,
            "last_sync_at": last_sync_at,
        }

    # ============================================================
    # Session State Management (Phase 4 - US2)
    # ============================================================

    def set_selected_catalog(self, catalog_id: Optional[str]) -> None:
        """Set the selected catalog for RAG queries.

        Args:
            catalog_id: Catalog to select, or None to deselect
        """
        self._selected_catalog_id = catalog_id
        logger.info(f"Selected catalog: {catalog_id}")

    def get_selected_catalog(self) -> Optional[str]:
        """Get the currently selected catalog ID.

        Returns:
            Selected catalog ID or None
        """
        return self._selected_catalog_id

    # ============================================================
    # RAG Query Operations (Phase 4 - US2)
    # ============================================================

    def query_knowledge_base(
        self, query: str, catalog_id: str, num_results: int = 5
    ) -> Dict[str, Any]:
        """Query the knowledge base with metadata filtering.

        Args:
            query: Natural language query
            catalog_id: Catalog to query
            num_results: Maximum number of results (max 20)

        Returns:
            Dict with results and citations
        """
        if not self.kb_id:
            raise ValueError("KB_ID environment variable not set")

        num_results = min(num_results, 20)

        response = self.bedrock_runtime.retrieve(
            knowledgeBaseId=self.kb_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": num_results,
                    "filter": {
                        "andAll": [
                            {"equals": {"key": "user_id", "value": self.user_id}},
                            {"equals": {"key": "catalog_id", "value": catalog_id}},
                        ]
                    },
                }
            },
        )

        results = response.get("retrievalResults", [])
        logger.info(f"KB query returned {len(results)} results")

        return {"results": results, "query": query, "catalog_id": catalog_id}

    def format_citations(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Format retrieval results into citation format.

        Args:
            results: Retrieval results from query_knowledge_base

        Returns:
            List of formatted citations
        """
        citations = []

        for i, result in enumerate(results, 1):
            content = result.get("content", {}).get("text", "")
            metadata = result.get("metadata", {})
            location = result.get("location", {})

            citation = {
                "index": i,
                "text": content[:500] + "..." if len(content) > 500 else content,
                "filename": metadata.get("filename", "Unknown"),
                "score": result.get("score", 0),
                "s3_uri": location.get("s3Location", {}).get("uri", ""),
            }
            citations.append(citation)

        return citations

    # ============================================================
    # File Validation Helpers
    # ============================================================

    def validate_file_type(self, filename: str) -> Tuple[bool, Optional[str]]:
        """Validate file type is allowed.

        Args:
            filename: Filename to validate

        Returns:
            Tuple of (is_valid, error_message)
        """
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        if ext not in self.ALLOWED_FILE_TYPES:
            return (
                False,
                f"File type '.{ext}' not supported. Allowed: {', '.join(self.ALLOWED_FILE_TYPES)}",
            )
        return True, None

    def validate_file_size(self, size_bytes: int) -> Tuple[bool, Optional[str]]:
        """Validate file size is within limits.

        Args:
            size_bytes: File size in bytes

        Returns:
            Tuple of (is_valid, error_message)
        """
        if size_bytes > self.MAX_FILE_SIZE_BYTES:
            max_mb = self.MAX_FILE_SIZE_BYTES / (1024 * 1024)
            return False, f"File exceeds {max_mb}MB limit"
        return True, None

    def check_duplicate_filename(
        self, catalog_id: str, filename: str
    ) -> Optional[Dict[str, Any]]:
        """Check if a filename already exists in the catalog.

        Args:
            catalog_id: Catalog identifier
            filename: Filename to check

        Returns:
            Existing document dict if duplicate, None otherwise
        """
        documents = self.list_documents_in_catalog(catalog_id)
        for doc in documents:
            if doc.get("filename", "").lower() == filename.lower():
                return doc
        return None
