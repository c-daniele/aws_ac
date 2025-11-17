#!/usr/bin/env python3
"""
Report Writer MCP Server - CDK Application
Deploys Report Writer as AgentCore Runtime MCP Server
"""
import os
import aws_cdk as cdk
from stacks import ReportWriterAgentCoreStack

app = cdk.App()

# Get AWS account and region from environment
env = cdk.Environment(
    account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
    region=os.environ.get("CDK_DEFAULT_REGION", "us-west-2")
)

# Deploy Report Writer AgentCore Stack
ReportWriterAgentCoreStack(
    app,
    "ReportWriterAgentCoreStack",
    env=env,
    description="Report Writer MCP Server on Bedrock AgentCore Runtime"
)

app.synth()
