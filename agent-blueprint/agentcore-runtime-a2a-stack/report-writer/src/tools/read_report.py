"""Read Report Tool - Returns current report content for review"""
from strands import tool
from report_manager import get_report_manager

@tool
def read_report_tool() -> str:
    """
    Read the current report content for review.

    Returns the full markdown content of the current report, including all sections
    and chart placeholders. Useful for reviewing progress before finalizing.

    Returns:
        Current report content in markdown format
    """
    try:
        manager = get_report_manager()
        if not manager.title:
            return "❌ No report exists. Create one first using create_report_tool()."

        return f"""**Report: {manager.title}**

{manager.content}

---
*Total length: {len(manager.content)} characters*"""
    except Exception as e:
        return f"❌ Error reading report: {str(e)}"
