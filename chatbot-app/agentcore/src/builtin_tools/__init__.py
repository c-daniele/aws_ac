"""Built-in tools powered by AWS Bedrock services

This package contains tools that leverage AWS Bedrock capabilities:
- Code Interpreter: Execute Python code for diagrams and charts
- Browser Automation: Navigate, interact, and extract data from web pages using Nova Act AI
"""

from .code_interpreter_diagram_tool import generate_diagram_and_validate
from .browser_tools import browser_navigate, browser_act, browser_extract, browser_get_page_info

__all__ = [
    'generate_diagram_and_validate',
    'browser_navigate',
    'browser_act',
    'browser_extract',
    'browser_get_page_info'
]
