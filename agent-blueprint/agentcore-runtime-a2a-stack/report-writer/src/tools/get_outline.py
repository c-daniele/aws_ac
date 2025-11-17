"""Get Outline Tool - Returns the report structure"""
from strands import tool
from report_manager import get_report_manager
import json

@tool
def get_outline_tool() -> str:
    """
    Get the report outline structure.

    Returns the hierarchical structure of the report showing all sections
    and subsections. Useful for planning or reviewing organization.

    Returns:
        JSON string representing the report outline
    """
    try:
        manager = get_report_manager()
        if not manager.title:
            return "❌ No report exists. Create one first using create_report_tool()."

        outline = manager.get_outline()
        return f"""**Report Outline: {manager.title}**

{json.dumps(outline, indent=2)}"""
    except Exception as e:
        return f"❌ Error getting outline: {str(e)}"
