"""
Chart Storage

In-memory storage for generated charts. Charts are stored as base64-encoded data
and retrieved during finalize_report for embedding in the DOCX document.
"""
from typing import Dict, Any

# Global chart storage (session-based in production with proper session management)
_chart_storage: Dict[str, Dict[str, Any]] = {}

def get_chart_storage() -> Dict[str, Dict[str, Any]]:
    """
    Get the chart storage dictionary.

    Returns:
        Dictionary mapping chart filenames to chart data
    """
    return _chart_storage
