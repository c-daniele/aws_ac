"""
Generate Chart Tool

Generates charts using Python code via Bedrock Code Interpreter.
"""
from strands import tool
from chart_storage import get_chart_storage
import boto3
import base64
import logging

logger = logging.getLogger(__name__)

# Initialize Bedrock Runtime client for Code Interpreter
bedrock_runtime = boto3.client("bedrock-agent-runtime")

@tool
def generate_chart_tool(python_code: str, chart_filename: str) -> str:
    """
    Generate a chart using Python code via Bedrock Code Interpreter.

    Executes Python code to create visualizations. The code must save the chart
    to the specified filename. Charts are stored in memory for later insertion.

    Args:
        python_code: Python code to generate the chart. Must save to chart_filename.
                    Available libraries: matplotlib, seaborn, pandas, numpy
                    Example: plt.savefig('chart.png', dpi=300, bbox_inches='tight')
        chart_filename: Filename for the chart (e.g., "growth.png")
                       Must match the filename in plt.savefig()

    Returns:
        Success message confirming chart generation and storage

    Example:
        generate_chart_tool(
            python_code='''
import matplotlib.pyplot as plt
categories = ['Q1', 'Q2', 'Q3', 'Q4']
values = [15, 22, 28, 35]
plt.figure(figsize=(10, 6))
plt.bar(categories, values, color='steelblue')
plt.title('Quarterly Growth Trend', fontsize=14, fontweight='bold')
plt.xlabel('Quarter')
plt.ylabel('Growth (%)')
plt.grid(axis='y', alpha=0.3)
plt.savefig('growth.png', dpi=300, bbox_inches='tight')
''',
            chart_filename="growth.png"
        )
    """
    try:
        # Invoke Bedrock Code Interpreter
        response = bedrock_runtime.invoke_inline_agent(
            inputText=f"Execute this Python code and return the generated file '{chart_filename}':\\n\\n{python_code}",
            sessionId="report-writer-session",
            enableTrace=False,
            actionGroupInvocations=[{
                "actionGroupName": "CodeInterpreterAction",
                "verb": "POST",
                "apiPath": "/execute",
                "parameters": [{
                    "name": "code",
                    "type": "string",
                    "value": python_code
                }]
            }]
        )

        # Extract generated files
        files = response.get("completion", {}).get("files", [])
        chart_data = None

        for file in files:
            if file.get("name") == chart_filename:
                chart_data = file.get("bytes")  # base64 encoded
                break

        if not chart_data:
            return f"❌ Chart file '{chart_filename}' not found in Code Interpreter output. Make sure your code saves to '{chart_filename}'."

        # Store chart in memory
        chart_storage = get_chart_storage()
        chart_storage[chart_filename] = {
            "data": chart_data,
            "filename": chart_filename
        }

        logger.info(f"Chart generated and stored: {chart_filename}")
        return f"✅ Chart '{chart_filename}' generated successfully and stored. Use insert_chart_tool() to add it to the report."

    except Exception as e:
        logger.error(f"Error generating chart: {str(e)}")
        return f"❌ Error generating chart: {str(e)}"
