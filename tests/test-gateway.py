#!/usr/bin/env python3
"""
Test script for AgentCore Gateway with MCP tools
Tests connection and tool execution through deployed Gateway
"""

import asyncio
import boto3
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.tools.mcp import MCPClient
from gateway_auth import get_sigv4_auth, get_gateway_region_from_url

# AWS configuration
REGION = "us-west-2"
PROJECT_NAME = "strands-agent-chatbot"
ENVIRONMENT = "dev"

def get_gateway_url():
    """Retrieve Gateway URL from SSM Parameter Store"""
    ssm = boto3.client('ssm', region_name=REGION)
    try:
        response = ssm.get_parameter(
            Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/mcp/gateway-url'
        )
        return response['Parameter']['Value']
    except Exception as e:
        print(f"❌ Failed to get Gateway URL from Parameter Store: {e}")
        return None

async def test_gateway():
    """Test Gateway connection and tool execution"""

    # Get Gateway URL
    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🧪 Testing AgentCore Gateway with MCP Tools")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"Gateway URL: {gateway_url}")
    print()

    # Create MCP client for Gateway (Streamable HTTP transport with SigV4 auth)
    # Gateway requires AWS_IAM (SigV4) authentication
    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth  # Use httpx Auth class for automatic request signing
        ),
        prefix="gateway"  # Prefix to identify tools from this Gateway
    )

    # Test 1: List available tools
    print("📋 Test 1: Listing available tools...")
    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            print(f"✅ Found {len(tools)} tools:")
            for tool in tools:
                # Get description from tool metadata
                desc = getattr(tool, 'tool_description', 'No description')
                print(f"   • {tool.tool_name}")
                print(f"     Description: {desc}")
                # Debug: print tool object attributes
                # print(f"     Debug: {vars(tool)}")
            print()

            # Test 2: Create agent with Gateway tools
            print("🤖 Test 2: Creating agent with Gateway tools...")
            agent = Agent(
                tools=tools,
                model="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
            )
            print("✅ Agent created successfully")
            print()

            # Test 3: Simple tool invocation (Wikipedia search)
            print("🔍 Test 3: Testing Wikipedia search...")
            response = agent("Search Wikipedia for 'Amazon Web Services' and summarize the key points")
            print("✅ Response:")
            print(response.message['content'][0]['text'])
            print()

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

async def test_direct_tool_call():
    """Test direct tool invocation without agent"""

    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🔧 Testing Direct Tool Invocation")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        )
    )

    try:
        with gateway_client:
            # Get available tools first to see actual names
            tools = gateway_client.list_tools_sync()
            tool_names = [t.tool_name for t in tools]
            print(f"Available tool names: {tool_names[:3]}...")  # Show first 3
            print()

            # Direct call to Wikipedia search tool
            # Use the actual tool name from the list
            wiki_tool_name = next((name for name in tool_names if 'wikipedia' in name.lower() and 'search' in name.lower()), None)

            if not wiki_tool_name:
                print("❌ Wikipedia search tool not found")
                return

            print(f"📞 Calling {wiki_tool_name} tool directly...")
            result = gateway_client.call_tool_sync(
                tool_use_id="test-001",
                name=wiki_tool_name,
                arguments={"query": "AWS Lambda"}
            )

            print("✅ Tool execution result:")
            print(f"   Status: {result['status']}")
            if result['content']:
                print(f"   Content: {result['content'][0]['text'][:200]}...")
            print()

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

async def test_multiple_tools():
    """Test using multiple tools in sequence"""

    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🔀 Testing Multiple Tool Usage")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        ),
        prefix="gateway"
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            agent = Agent(
                tools=tools,
                model="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
            )

            # Complex query requiring multiple tools
            print("🎯 Query: Research AWS Lambda pricing and recent Wikipedia updates...")
            response = agent(
                "First, search Wikipedia for 'AWS Lambda' and get the article. "
                "Then search ArXiv for recent papers about serverless computing."
            )

            print("✅ Multi-tool response:")
            print(response.message['content'][0]['text'])
            print()

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

def main():
    """Run all tests"""
    print()
    print("╔═══════════════════════════════════════════════════╗")
    print("║   AgentCore Gateway + MCP Tools Test Suite       ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    # Run tests
    asyncio.run(test_gateway())
    asyncio.run(test_direct_tool_call())
    asyncio.run(test_multiple_tools())

    print()
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✅ All tests completed!")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

if __name__ == "__main__":
    main()
