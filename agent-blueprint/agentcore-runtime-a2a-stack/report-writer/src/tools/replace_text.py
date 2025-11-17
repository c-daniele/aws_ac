"""Replace Text Tool - Find and replace text in the report"""
from strands import tool
from report_manager import get_report_manager

@tool
def replace_text_tool(find: str, replace: str) -> str:
    """
    Find and replace text in the report.

    Performs a global search and replace across all report content.
    Useful for corrections or standardizing terminology.

    Args:
        find: Text to find
        replace: Text to replace with

    Returns:
        Success message with replacement count
    """
    try:
        manager = get_report_manager()
        result = manager.replace_text(find, replace)
        return result
    except Exception as e:
        return f"❌ Error replacing text: {str(e)}"
