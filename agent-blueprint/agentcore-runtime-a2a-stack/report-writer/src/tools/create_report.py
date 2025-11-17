"""
Create Report Tool

Initializes a new research report with title and optional outline.
"""
from strands import tool
from typing import Optional, List, Dict, Any
from report_manager import get_report_manager
import json
import logging

logger = logging.getLogger(__name__)

@tool
def create_report_tool(title: str, outline: Optional[str] = None) -> str:
    """
    Create a new research report with title and optional outline.

    This initializes a new report document. If an outline is provided, it establishes
    the structure for the report. The outline should be a JSON string representing
    a list of sections with optional subsections.

    Args:
        title: The title of the report
        outline: Optional JSON string representing the report outline structure.
                Format: [{"title": "Section Name", "subsections": [{"title": "Subsection"}]}]

    Returns:
        Success message confirming report creation with outline details

    Example:
        create_report_tool(
            title="AI Impact on Retail Industry",
            outline='[{"title": "Executive Summary"}, {"title": "Introduction", "subsections": [{"title": "Background"}]}, {"title": "Analysis"}, {"title": "Conclusion"}]'
        )
    """
    try:
        manager = get_report_manager()

        # Parse outline if provided
        parsed_outline = None
        if outline:
            try:
                parsed_outline = json.loads(outline)
                if not isinstance(parsed_outline, list):
                    return "❌ Error: outline must be a JSON array of section objects"
            except json.JSONDecodeError as e:
                return f"❌ Error: outline must be valid JSON. Parse error: {str(e)}"

        result = manager.create(title, parsed_outline)
        logger.info(f"Report created: {title}")
        return result

    except Exception as e:
        logger.error(f"Error creating report: {str(e)}")
        return f"❌ Error creating report: {str(e)}"
