"""
Finalize Report Tool

Converts the markdown report to DOCX format and saves to S3.
"""
from strands import tool
from report_manager import get_report_manager
from chart_storage import get_chart_storage
from markdown_converter import markdown_to_docx
import boto3
import base64
import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

s3_client = boto3.client("s3")
BUCKET_NAME = os.getenv("DOCUMENT_BUCKET_NAME")

@tool
def finalize_report_tool(filename: str) -> str:
    """
    Convert the markdown report to DOCX format and save to S3.

    This creates the final Word document with all content, formatting, and embedded charts.
    The document is uploaded to S3 and a base64-encoded version is returned for download.

    Args:
        filename: Desired filename for the DOCX file (e.g., "ai_retail_report.docx")
                 Will be automatically suffixed with .docx if not present

    Returns:
        Base64-encoded DOCX file wrapped in XML tags for download

    Example:
        finalize_report_tool(filename="ai_trends_report.docx")
    """
    try:
        # Ensure filename has .docx extension
        if not filename.endswith(".docx"):
            filename = f"{filename}.docx"

        # Get report content
        manager = get_report_manager()
        if not manager.title or not manager.content:
            return "❌ No report to finalize. Create a report first using create_report_tool()."

        markdown_content = manager.content

        # Get chart storage for embedding
        chart_storage = get_chart_storage()

        # Convert markdown to DOCX
        logger.info(f"Converting report to DOCX: {filename}")
        doc = markdown_to_docx(markdown_content, chart_storage)

        # Save DOCX to bytes
        from io import BytesIO
        docx_buffer = BytesIO()
        doc.save(docx_buffer)
        docx_bytes = docx_buffer.getvalue()

        # Upload to S3
        s3_key = f"reports/{datetime.now().strftime('%Y/%m/%d')}/{filename}"
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=docx_bytes,
            ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Metadata={
                "report-title": manager.title,
                "created-at": manager.created_at.isoformat() if manager.created_at else "",
                "section-count": str(len(manager.outline) if manager.outline else 0)
            }
        )

        logger.info(f"Report uploaded to S3: s3://{BUCKET_NAME}/{s3_key}")

        # Generate base64 for download
        docx_base64 = base64.b64encode(docx_bytes).decode('utf-8')

        # Return with XML tags for download (Strands agent will parse this)
        result = f"""✅ Report finalized successfully!

**Report Details:**
- Title: {manager.title}
- Filename: {filename}
- S3 Location: s3://{BUCKET_NAME}/{s3_key}
- Size: {len(docx_bytes)} bytes

**Download:**
<download filename="{filename}" mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document">
{docx_base64}
</download>

The report has been saved to S3 and is ready for download."""

        logger.info(f"Report finalized: {filename}")
        return result

    except Exception as e:
        logger.error(f"Error finalizing report: {str(e)}")
        return f"❌ Error finalizing report: {str(e)}"
