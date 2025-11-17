/**
 * Tools endpoint - returns available tools with user-specific enabled state
 * Loads user preferences from DynamoDB (AWS) or local file storage (local)
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'
import { getUserEnabledTools as getDynamoUserEnabledTools, getUserProfile, upsertUserProfile } from '@/lib/dynamodb-client'
import toolsConfig from '@/config/tools-config.json'

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    let enabledToolIds: string[] = []

    if (userId !== 'anonymous') {
      // Authenticated user - load from DynamoDB (AWS) or local file (local)
      if (IS_LOCAL) {
        // Local: Load from file
        const { getUserEnabledTools: getLocalUserEnabledTools } = await import('@/lib/local-tool-store')
        enabledToolIds = getLocalUserEnabledTools(userId)
        console.log(`[API] Loaded authenticated user ${userId} from local file: ${enabledToolIds.length} enabled`)
      } else {
        // AWS: Load from DynamoDB
        const storedTools = await getDynamoUserEnabledTools(userId)
        const profile = await getUserProfile(userId)

        if (!profile) {
          // New user - initialize with all tools DISABLED (default)
          enabledToolIds = []

          // Create user profile with default preferences (all disabled)
          await upsertUserProfile(userId, user.email || '', user.username, {
            enabledTools: []
          })

          console.log(`[API] Initialized NEW user ${userId} with all tools DISABLED (default)`)
        } else {
          // Existing user - use stored preferences
          enabledToolIds = storedTools
          console.log(`[API] Loaded existing user ${userId} from DynamoDB: ${enabledToolIds.length} enabled`)
        }
      }
    } else {
      // Anonymous user - load from local file storage (works for both local and AWS)
      const { getUserEnabledTools: getLocalUserEnabledTools } = await import('@/lib/local-tool-store')
      enabledToolIds = getLocalUserEnabledTools(userId)
      console.log(`[API] Loaded anonymous user from local file: ${enabledToolIds.length} enabled`)
    }

    // Get local tools from config and map with user-specific enabled state
    const localTools = (toolsConfig.local_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      type: 'local_tools',
      tool_type: 'local',
      enabled: enabledToolIds.includes(tool.id)
    }))

    // Get builtin tools from config and map with user-specific enabled state
    const builtinTools = (toolsConfig.builtin_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      icon: tool.icon,
      type: 'builtin_tools',
      tool_type: 'builtin',
      enabled: enabledToolIds.includes(tool.id)
    }))

    // Get gateway tools from config and map with user-specific enabled state
    const gatewayTargets = toolsConfig.gateway_targets || []
    const gatewayTools = gatewayTargets.flatMap((target: any) =>
      target.tools.map((tool: any) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: target.category,
        type: 'gateway',
        tool_type: 'gateway',
        enabled: enabledToolIds.includes(tool.id)
      }))
    )

    console.log(`[API] Returning tools for user ${userId} - ${enabledToolIds.length} enabled`)

    return NextResponse.json({
      tools: [...localTools, ...builtinTools],
      mcp_servers: gatewayTools
    })
  } catch (error) {
    console.error('[API] Error loading tools:', error)

    // Fallback: return all tools from config with default enabled state
    const localTools = (toolsConfig.local_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      type: 'local_tools',
      tool_type: 'local',
      enabled: tool.enabled ?? true
    }))

    const builtinTools = (toolsConfig.builtin_tools || []).map((tool: any) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      icon: tool.icon,
      type: 'builtin_tools',
      tool_type: 'builtin',
      enabled: tool.enabled ?? true
    }))

    const gatewayTargets = toolsConfig.gateway_targets || []
    const gatewayTools = gatewayTargets.flatMap((target: any) =>
      target.tools.map((tool: any) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: target.category,
        type: 'gateway',
        tool_type: 'gateway',
        enabled: target.enabled ?? false
      }))
    )

    return NextResponse.json({
      tools: [...localTools, ...builtinTools],
      mcp_servers: gatewayTools
    })
  }
}
