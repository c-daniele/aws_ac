import { NextRequest, NextResponse } from 'next/server';

/**
 * Gateway Tools List API - Proxy to AgentCore Runtime
 *
 * This endpoint proxies requests from the frontend to the AgentCore Runtime
 * to get the list of available gateway tools.
 *
 * Frontend → BFF (this) → AgentCore Runtime
 */
export async function GET(request: NextRequest) {
  try {
    // Get AgentCore Runtime URL from environment
    const agentCoreUrl = process.env.AGENT_CORE_URL || 'http://localhost:8080';
    const targetUrl = `${agentCoreUrl}/api/gateway-tools/list`;

    console.log('[BFF] Proxying gateway-tools request to:', targetUrl);

    // Forward request to AgentCore Runtime
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[BFF] AgentCore Runtime returned error:', response.status);
      return NextResponse.json(
        {
          success: false,
          error: `AgentCore Runtime returned ${response.status}`
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[BFF] Gateway tools fetched successfully:', data.tools?.length || 0, 'tools');

    return NextResponse.json(data);
  } catch (error) {
    console.error('[BFF] Failed to fetch gateway tools:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
