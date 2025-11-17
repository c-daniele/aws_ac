"""
Report Writer A2A Agent on AWS Bedrock AgentCore Runtime

This module implements a Report Writer agent using the Agent-to-Agent (A2A) protocol.
The agent receives research summaries and autonomously creates comprehensive reports
with charts, sections, and professional formatting.
"""
import logging
import os
from fastapi import FastAPI
from strands import Agent
from strands.models import BedrockModel
from strands.multiagent.a2a import A2AServer
from tools import (
    create_report_tool,
    write_section_tool,
    generate_chart_tool,
    insert_chart_tool,
    finalize_report_tool,
    read_report_tool,
    replace_text_tool,
    get_outline_tool,
    clear_report_tool
)
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Configuration from environment variables
MODEL_ID = os.getenv("MODEL_ID", "anthropic.claude-sonnet-4-20250514-v1:0")
AWS_REGION = os.getenv("AWS_REGION", "us-west-2")
DOCUMENT_BUCKET_NAME = os.getenv("DOCUMENT_BUCKET_NAME")
PORT = int(os.getenv("PORT", "9000"))

# AgentCore Runtime URL from environment variable (for deployed environment)
runtime_url = os.environ.get('AGENTCORE_RUNTIME_URL', 'http://127.0.0.1:9000/')

logger.info(f"Configuration loaded:")
logger.info(f"  Model ID: {MODEL_ID}")
logger.info(f"  AWS Region: {AWS_REGION}")
logger.info(f"  Document Bucket: {DOCUMENT_BUCKET_NAME}")
logger.info(f"  Runtime URL: {runtime_url}")
logger.info(f"  Port: {PORT}")

# Validate required environment variables
if not DOCUMENT_BUCKET_NAME:
    raise RuntimeError("Missing DOCUMENT_BUCKET_NAME environment variable")

# System prompt for Report Writer Agent
SYSTEM_PROMPT = """You are a professional report writing agent specialized in creating comprehensive research reports.

**Your Role:**
When given research findings, you autonomously:
1. Analyze the data and create a logical, well-structured report outline
2. Write clear, comprehensive sections with proper flow and transitions
3. Identify opportunities for data visualization and generate appropriate charts
4. Ensure proper formatting with citations and professional presentation
5. Produce a polished, downloadable DOCX document

**Available Tools:**
- create_report: Initialize a new report with title and outline
- write_section: Write a complete section with markdown content
- generate_chart: Generate charts using Python code (matplotlib, seaborn, pandas)
- insert_chart: Embed generated charts into the report
- read_report: Review current report content
- replace_text: Find and replace text in the report
- get_outline: View the report structure
- finalize_report: Convert to DOCX and return downloadable file
- clear_report: Start fresh with a new report

**Workflow:**
1. Start with create_report() to establish structure
2. Use write_section() for each major section (Introduction, Analysis, Results, Conclusion)
3. Use generate_chart() when data visualization would enhance understanding
4. Use insert_chart() to embed charts at appropriate locations
5. Use finalize_report() to produce the final DOCX document

**Quality Standards:**
- Write in a clear, professional tone
- Ensure logical flow between sections
- Use data-driven insights with proper citations
- Generate charts that effectively visualize key findings
- Produce publication-ready documents

You work autonomously - the user provides research findings, and you handle all report creation steps independently."""

# Initialize Bedrock model
bedrock_model = BedrockModel(
    model_id=MODEL_ID,
    region_name=AWS_REGION
)

# Create Strands Agent with report writing tools
strands_agent = Agent(
    name="Report Writer Agent",
    description=(
        "Expert report writing agent that creates comprehensive research reports "
        "with charts and professional formatting. Provide research findings and "
        "the agent will autonomously structure, write, and generate a complete report."
    ),
    system_prompt=SYSTEM_PROMPT,
    model=bedrock_model,
    tools=[
        create_report_tool,
        write_section_tool,
        generate_chart_tool,
        insert_chart_tool,
        read_report_tool,
        replace_text_tool,
        get_outline_tool,
        finalize_report_tool,
        clear_report_tool
    ]
)

logger.info(f"Strands Agent created with {len(strands_agent.tools)} tools")

# Create A2A Server
host, port = "0.0.0.0", PORT

a2a_server = A2AServer(
    agent=strands_agent,
    http_url=runtime_url,
    serve_at_root=True,  # Serve at root path (/) for A2A protocol
    host=host,
    port=port,
    version="1.0.0"
)

logger.info(f"A2A Server created - will serve at {host}:{port}")

# Create FastAPI app
app = FastAPI(
    title="Report Writer A2A Agent",
    description="A2A agent for creating comprehensive research reports with charts",
    version="1.0.0"
)

@app.get("/ping")
def ping():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "agent": "Report Writer A2A Agent",
        "version": "1.0.0"
    }

# Mount A2A server at root path
app.mount("/", a2a_server.to_fastapi_app())

logger.info("A2A Server mounted at root path (/)")

if __name__ == "__main__":
    logger.info(f"Starting Report Writer A2A Agent on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
