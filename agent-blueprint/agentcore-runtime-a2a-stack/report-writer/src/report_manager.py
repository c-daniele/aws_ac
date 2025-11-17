"""
Report Manager - Manages report state and markdown content
Handles report creation, section management, and content operations
"""
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class ReportManager:
    """
    Manages report state and markdown content.
    Similar to DocumentManager but optimized for multi-section reports.
    """

    def __init__(self):
        self.title: Optional[str] = None
        self.outline: Optional[List[Dict[str, Any]]] = None
        self.content: str = ""
        self.created_at: Optional[datetime] = None

    def has_report(self) -> bool:
        """Check if a report exists"""
        return self.title is not None

    def create(self, title: str, outline: Optional[List[Dict[str, Any]]] = None) -> str:
        """
        Create a new report with title and optional outline.

        Args:
            title: Report title
            outline: Optional hierarchical structure
                Example: [
                    {"title": "Introduction", "subsections": [{"title": "Background"}]},
                    {"title": "Methods"},
                    {"title": "Results"}
                ]

        Returns:
            Success message with outline preview
        """
        self.title = title
        self.outline = outline or []
        self.created_at = datetime.now()

        # Initialize markdown with title
        self.content = f"# {title}\n\n"
        self.content += f"*Generated: {self.created_at.strftime('%Y-%m-%d %H:%M:%S')}*\n\n"
        self.content += "---\n\n"

        # Add outline as HTML comments for context
        if self.outline:
            outline_text = self._format_outline(self.outline)
            return f"✅ Report created: '{title}'\n\n**Outline:**\n{outline_text}\n\nYou can now add sections using write_section()."

        return f"✅ Report created: '{title}'\n\nYou can now add sections using write_section()."

    def _format_outline(self, outline: List[Dict[str, Any]], indent: int = 0) -> str:
        """Format outline as readable text"""
        result = ""
        for item in outline:
            prefix = "  " * indent
            result += f"{prefix}- {item.get('title', 'Untitled')}\n"

            # Recursively format subsections
            subsections = item.get('subsections', [])
            if subsections:
                result += self._format_outline(subsections, indent + 1)

        return result

    def write_section(self, section_title: str, content: str) -> str:
        """
        Add or update a section in the report.

        Args:
            section_title: Section heading
            content: Markdown content

        Returns:
            Success message
        """
        if not self.has_report():
            return "❌ No report exists. Create a report first using create_report()."

        # Format as complete section with heading
        section_content = f"## {section_title}\n\n{content}\n\n"

        # Append to content
        self.content += section_content

        line_count = section_content.count('\n')
        char_count = len(section_content)

        logger.info(f"Added section '{section_title}': {line_count} lines, {char_count} chars")

        return f"✅ Section added: '{section_title}' ({line_count} lines, {char_count} characters)"

    def read_report(self) -> str:
        """
        Read the current report content.

        Returns:
            Full markdown content
        """
        if not self.has_report():
            return "❌ No report exists. Create a report first using create_report()."

        return self.content

    def replace_content(self, find: str, replace: str) -> str:
        """
        Find and replace text in the report.

        Args:
            find: Text to search for
            replace: Replacement text

        Returns:
            Success message with replacement count
        """
        if not self.has_report():
            return "❌ No report exists. Create a report first using create_report()."

        if find not in self.content:
            return f"❌ Text not found: '{find[:50]}...'"

        count = self.content.count(find)
        self.content = self.content.replace(find, replace)

        logger.info(f"Replaced {count} occurrence(s) of text")

        return f"✅ Replaced {count} occurrence(s) of '{find[:30]}...'"

    def get_outline(self) -> str:
        """
        Get the report outline.

        Returns:
            Formatted outline text
        """
        if not self.has_report():
            return "❌ No report exists."

        if not self.outline:
            return "No outline defined for this report."

        return f"**Report Outline:**\n\n{self._format_outline(self.outline)}"

    def clear(self) -> str:
        """
        Clear the current report and start fresh.

        Returns:
            Success message
        """
        self.title = None
        self.outline = None
        self.content = ""
        self.created_at = None

        logger.info("Report cleared")

        return "✅ Report cleared. You can create a new report using create_report()."

    def get_stats(self) -> Dict[str, Any]:
        """Get report statistics"""
        if not self.has_report():
            return {"exists": False}

        lines = self.content.count('\n')
        words = len(self.content.split())
        chars = len(self.content)

        return {
            "exists": True,
            "title": self.title,
            "lines": lines,
            "words": words,
            "characters": chars,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
