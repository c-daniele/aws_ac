#!/usr/bin/env python3
"""
Simple Gateway Test - Direct MCP JSON-RPC with SigV4 authentication
Tests Gateway connection without Strands Agent
"""
import json
import sys
import asyncio
import boto3

try:
    import httpx
    from gateway_auth import SigV4HTTPXAuth, get_gateway_region_from_url
except ImportError:
    print("❌ Required packages not installed. Install with:")
    print("   pip install httpx boto3")
    sys.exit(1)

# Configuration
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
        sys.exit(1)


async def test_gateway(gateway_url: str, region: str):
    """Test Gateway connection and list tools"""
    print(f"🔗 Connecting to Gateway: {gateway_url}")
    print(f"📍 Region: {region}")
    print()

    # Get AWS credentials
    session = boto3.Session()
    credentials = session.get_credentials()

    if not credentials:
        print("❌ AWS credentials not found")
        sys.exit(1)

    print(f"✅ AWS credentials obtained")
    print(f"   Account: {boto3.client('sts').get_caller_identity()['Account']}")
    print()

    # Create HTTP client with SigV4
    auth = SigV4HTTPXAuth(credentials, 'bedrock-agentcore', region)

    async with httpx.AsyncClient(auth=auth, timeout=30.0) as http_client:
        try:
            # MCP initialize request
            print("🔌 Initializing MCP session...")

            init_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "test-client",
                        "version": "1.0.0"
                    }
                }
            }

            response = await http_client.post(
                gateway_url,
                json=init_request,
                headers={"Content-Type": "application/json"}
            )

            print(f"Status: {response.status_code}")

            if response.status_code != 200:
                print(f"❌ Failed to initialize: {response.text}")
                return

            init_result = response.json()
            print("✅ MCP session initialized")
            print(f"   Server: {init_result.get('result', {}).get('serverInfo', {}).get('name', 'Unknown')}")
            print()

            # List tools
            print("📋 Listing available tools...")

            list_tools_request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {}
            }

            response = await http_client.post(
                gateway_url,
                json=list_tools_request,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code != 200:
                print(f"❌ Failed to list tools: {response.text}")
                return

            tools_result = response.json()
            tools = tools_result.get('result', {}).get('tools', [])

            print(f"✅ Found {len(tools)} tools:")
            print()

            for tool in tools:
                print(f"  🔧 {tool['name']}")
                print(f"     {tool.get('description', 'No description')}")
                print()

            # Test a tool call - Wikipedia search
            if tools:
                print("🧪 Testing tool call: wikipedia_search")

                call_tool_request = {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        "name": "wikipedia_search",
                        "arguments": {
                            "query": "Amazon Web Services"
                        }
                    }
                }

                response = await http_client.post(
                    gateway_url,
                    json=call_tool_request,
                    headers={"Content-Type": "application/json"}
                )

                print(f"Status: {response.status_code}")

                if response.status_code == 200:
                    result = response.json()
                    print("✅ Tool call successful!")

                    content = result.get('result', {}).get('content', [])
                    if content:
                        tool_output = content[0].get('text', '')
                        print(f"   Output (first 200 chars): {tool_output[:200]}...")
                else:
                    print(f"❌ Tool call failed: {response.text}")

        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()


def main():
    print()
    print("╔═══════════════════════════════════════════════════╗")
    print("║     AgentCore Gateway Simple Test (MCP)          ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    gateway_url = get_gateway_url()
    region = get_gateway_region_from_url(gateway_url)

    asyncio.run(test_gateway(gateway_url, region))

    print()
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✅ Test complete!")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()


if __name__ == "__main__":
    main()
