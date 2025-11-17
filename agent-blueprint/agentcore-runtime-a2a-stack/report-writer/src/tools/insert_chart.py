"""
Insert Chart Tool

Inserts a previously generated chart into the report.
"""
from strands import tool
from report_manager import get_report_manager
from chart_storage import get_chart_storage
import logging

logger = logging.getLogger(__name__)

@tool
def insert_chart_tool(chart_filename: str, chart_title: str, chart_description: str) -> str:
    """
    Insert a previously generated chart into the report.

    The chart must have been generated using generate_chart_tool() first.
    Charts are embedded as images in the markdown and will appear in the final DOCX.

    Args:
        chart_filename: The filename of the chart to insert (must match generate_chart_tool)
        chart_title: Title/caption for the chart
        chart_description: Brief description of what the chart shows

    Returns:
        Success message confirming chart insertion

    Example:
        insert_chart_tool(
            chart_filename="growth.png",
            chart_title="Quarterly Growth Trend",
            chart_description="Bar chart showing quarterly growth percentages from Q1 to Q4"
        )
    """
    try:
        # Check if chart exists in storage
        chart_storage = get_chart_storage()
        if chart_filename not in chart_storage:
            return f"❌ Chart '{chart_filename}' not found. Generate it first using generate_chart_tool()."

        # Insert chart reference into report
        manager = get_report_manager()
        result = manager.insert_chart(chart_filename, chart_title, chart_description)

        logger.info(f"Chart inserted: {chart_filename}")
        return result

    except Exception as e:
        logger.error(f"Error inserting chart: {str(e)}")
        return f"❌ Error inserting chart: {str(e)}"
