/**
 * Sync tool registry - Force update DynamoDB TOOL_REGISTRY with tools-config.json
 * Admin endpoint to update tool registry when tools-config.json changes
 */
import { NextResponse } from 'next/server'
import { initializeToolRegistry } from '@/lib/dynamodb-client'
import toolsConfigFallback from '@/config/tools-config.json'

export const runtime = 'nodejs'

/**
 * POST /api/tools/sync-registry
 * Force update DynamoDB TOOL_REGISTRY from tools-config.json
 */
export async function POST() {
  try {
    console.log('[API] Force syncing TOOL_REGISTRY from tools-config.json...')

    await initializeToolRegistry(toolsConfigFallback)

    return NextResponse.json({
      success: true,
      message: 'Tool registry synced successfully',
      local_tools: toolsConfigFallback.local_tools?.length || 0,
      builtin_tools: toolsConfigFallback.builtin_tools?.length || 0,
      browser_automation: toolsConfigFallback.browser_automation?.length || 0,
      gateway_targets: toolsConfigFallback.gateway_targets?.length || 0,
      agentcore_runtime_mcp: toolsConfigFallback.agentcore_runtime_mcp?.length || 0,
    })
  } catch (error: any) {
    console.error('[API] Error syncing tool registry:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sync tool registry',
        details: error.message
      },
      { status: 500 }
    )
  }
}
