"""
Write Section Tool

Writes a complete section to the report with markdown content.
"""
from strands import tool
from report_manager import get_report_manager
import logging

logger = logging.getLogger(__name__)

@tool
def write_section_tool(section_title: str, content: str) -> str:
    """
    Write a complete section to the report with markdown content.

    Adds or updates a section in the report. Content should be in markdown format
    and can include headers, lists, bold/italic text, code blocks, and citations.

    Args:
        section_title: The title of the section (will be formatted as ## heading)
        content: The markdown content for the section. Supports:
                - Headings: ###, ####
                - Bold: **text**
                - Italic: *text*
                - Lists: - item or 1. item
                - Citations: [https://url]
                - Code: `code` or ```code block```

    Returns:
        Success message confirming section was written

    Example:
        write_section_tool(
            section_title="Introduction",
            content='''Artificial Intelligence is transforming retail [https://example.com].

### Background
- Digital transformation initiatives
- Evolving customer expectations

### Research Gap
Limited research exists on in-store AI applications.'''
        )
    """
    try:
        manager = get_report_manager()
        result = manager.write_section(section_title, content)
        logger.info(f"Section written: {section_title}")
        return result

    except Exception as e:
        logger.error(f"Error writing section: {str(e)}")
        return f"❌ Error writing section: {str(e)}"
