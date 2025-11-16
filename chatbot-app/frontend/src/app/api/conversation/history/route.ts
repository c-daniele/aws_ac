/**
 * Conversation History API - Load chat messages from AgentCore Memory
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractUserFromRequest } from '@/lib/auth-utils'

// Check if running in local development mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'
const MEMORY_ID = process.env.MEMORY_ID || process.env.NEXT_PUBLIC_MEMORY_ID
const AWS_REGION = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-2'

export const runtime = 'nodejs'

// Dynamic import for AWS SDK (only in cloud mode)
let BedrockAgentCoreClient: any
let ListEventsCommand: any

async function initializeAwsClients() {
  if (IS_LOCAL || !MEMORY_ID) return

  if (!BedrockAgentCoreClient) {
    const bedrockModule = await import('@aws-sdk/client-bedrock-agentcore')
    BedrockAgentCoreClient = bedrockModule.BedrockAgentCoreClient
    ListEventsCommand = bedrockModule.ListEventsCommand
  }
}

export async function GET(request: NextRequest) {
  try {
    // Extract user from Cognito JWT token
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const sessionId = searchParams.get('session_id')
    const limit = parseInt(searchParams.get('limit') || '100')

    if (!sessionId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing session_id parameter',
        },
        { status: 400 }
      )
    }

    console.log(`[API] Loading conversation history for session ${sessionId}, user ${userId}`)

    let messages: any[] = []

    if (userId === 'anonymous' || IS_LOCAL || !MEMORY_ID) {
      // Local mode or anonymous user - load from local file storage
      const { getSessionMessages } = await import('@/lib/local-session-store')
      messages = getSessionMessages(sessionId)
      console.log(`[API] Loaded ${messages.length} messages from local file`)
    } else {
      // AWS mode - load from AgentCore Memory
      await initializeAwsClients()

      if (!BedrockAgentCoreClient) {
        throw new Error('AgentCore Memory client not available')
      }

      const client = new BedrockAgentCoreClient({ region: AWS_REGION })

      const command = new ListEventsCommand({
        memoryId: MEMORY_ID,
        sessionId: sessionId,
        actorId: userId,
        includePayloads: true,
        maxResults: limit,
      })

      const response = await client.send(command)
      const events = response.events || []

      console.log(`[API] Retrieved ${events.length} events from AgentCore Memory`)

      // Convert AgentCore Memory events to chat messages
      // Events are returned newest-first, reverse to get chronological order
      const reversedEvents = [...events].reverse()

      messages = reversedEvents
        .filter((event: any) => {
          // Only include conversational events
          return event.payload && event.payload[0]?.conversational
        })
        .map((event: any) => {
          const conv = event.payload[0].conversational
          const metadata = event.metadata || {}

          // Extract tool information from metadata if present
          const toolUse = metadata.tool_use?.stringValue
            ? JSON.parse(metadata.tool_use.stringValue)
            : null

          const toolResult = metadata.tool_result?.stringValue
            ? JSON.parse(metadata.tool_result.stringValue)
            : null

          return {
            id: event.eventId,
            role: conv.role.toLowerCase(), // "USER" | "ASSISTANT" | "TOOL" → lowercase
            content: conv.content?.text || '',
            timestamp: event.eventTimestamp,
            ...(toolUse && {
              toolUse: {
                toolUseId: toolUse.toolUseId,
                name: toolUse.name,
                input: toolUse.input,
              },
            }),
            ...(toolResult && {
              toolResult: {
                toolUseId: toolResult.toolUseId,
                content: toolResult.content,
                status: toolResult.status,
              },
            }),
            metadata,
          }
        })

      console.log(`[API] Converted to ${messages.length} chat messages`)
    }

    // Step 2: Merge toolUse and toolResult into single toolExecution objects
    const toolExecutionMap = new Map<string, any>()

    // First pass: collect all toolUse and toolResult by toolUseId
    messages.forEach((msg: any) => {
      if (msg.toolUse) {
        const toolUseId = msg.toolUse.toolUseId
        toolExecutionMap.set(toolUseId, {
          id: toolUseId,
          toolName: msg.toolUse.name,
          toolInput: msg.toolUse.input,
          reasoning: [],
          isComplete: false,
          isExpanded: false,
          timestamp: msg.timestamp
        })
      }

      if (msg.toolResult) {
        const toolUseId = msg.toolResult.toolUseId
        const existing = toolExecutionMap.get(toolUseId)

        // Convert content array to string if needed
        let resultContent = msg.toolResult.content
        if (Array.isArray(resultContent)) {
          resultContent = resultContent.map((c: any) => {
            if (typeof c === 'string') return c
            if (c.text) return c.text
            if (c.json) return JSON.stringify(c.json, null, 2)
            return JSON.stringify(c)
          }).join('\n')
        } else if (typeof resultContent === 'object') {
          resultContent = JSON.stringify(resultContent, null, 2)
        }

        if (existing) {
          existing.toolResult = resultContent
          existing.isComplete = true
        } else {
          // toolResult without toolUse (edge case)
          toolExecutionMap.set(toolUseId, {
            id: toolUseId,
            toolName: 'unknown_tool',
            toolInput: {},
            toolResult: resultContent,
            reasoning: [],
            isComplete: true,
            isExpanded: false,
            timestamp: msg.timestamp
          })
        }
      }
    })

    // Second pass: build final message array with merged tool executions
    const mergedMessages: any[] = []
    const processedToolUseIds = new Set<string>()

    messages.forEach((msg: any) => {
      // User messages - only add if has content
      if (msg.role === 'user') {
        if (msg.content && msg.content.trim()) {
          mergedMessages.push({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp
          })
        }
        return
      }

      // Assistant messages with toolUse - create merged toolExecution
      if (msg.toolUse) {
        const toolUseId = msg.toolUse.toolUseId

        if (!processedToolUseIds.has(toolUseId)) {
          const toolExecution = toolExecutionMap.get(toolUseId)

          if (toolExecution) {
            mergedMessages.push({
              id: `${msg.id}-tool`,
              role: 'assistant',
              content: '',
              timestamp: msg.timestamp,
              toolExecutions: [toolExecution],
              isToolMessage: true
            })
            processedToolUseIds.add(toolUseId)
          }
        }
        return
      }

      // Assistant messages with toolResult - skip (already merged)
      if (msg.toolResult) {
        return
      }

      // Regular assistant text messages - only add if has content
      if (msg.content && msg.content.trim()) {
        mergedMessages.push({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp
        })
      }
    })

    console.log(`[API] Merged to ${mergedMessages.length} messages with ${toolExecutionMap.size} tool executions`)
    console.log('[API] Sample messages:', mergedMessages.slice(0, 5))

    return NextResponse.json({
      success: true,
      sessionId,
      messages: mergedMessages,
      count: mergedMessages.length,
    })
  } catch (error) {
    console.error('[API] Error loading conversation history:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load conversation history',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
