"""Clear Report Tool - Clears the current report and starts fresh"""
from strands import tool
from report_manager import get_report_manager
from chart_storage import get_chart_storage

@tool
def clear_report_tool() -> str:
    """
    Clear the current report and start fresh.

    Removes all report content, outline, and chart storage.
    Use this to start a new report without restarting the agent.

    Returns:
        Success message confirming report was cleared
    """
    try:
        manager = get_report_manager()
        manager.clear()

        # Also clear chart storage
        chart_storage = get_chart_storage()
        chart_storage.clear()

        return "✅ Report cleared successfully. Ready for a new report."
    except Exception as e:
        return f"❌ Error clearing report: {str(e)}"
