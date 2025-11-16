/**
 * Chat streaming endpoint (BFF)
 * Invokes AgentCore Runtime and streams responses
 */
import { NextRequest } from 'next/server'
import { invokeAgentCoreRuntime } from '@/lib/agentcore-runtime-client'
import { extractUserFromRequest, getSessionId } from '@/lib/auth-utils'
import { createDefaultHookManager } from '@/lib/chat-hooks'

// Check if running in local mode
const IS_LOCAL = process.env.NEXT_PUBLIC_AGENTCORE_LOCAL === 'true'

export const runtime = 'nodejs'
export const maxDuration = 1800 // 30 minutes for long-running agent tasks (self-hosted, no Vercel limits)

export async function POST(request: NextRequest) {
  try {
    // Check if request is FormData (file upload) or JSON (text only)
    const contentType = request.headers.get('content-type') || ''
    const isFormData = contentType.includes('multipart/form-data')

    let message: string
    let model_id: string | undefined
    let enabled_tools: string[] | undefined
    let files: File[] | undefined

    if (isFormData) {
      // Parse FormData for file uploads
      const formData = await request.formData()
      message = formData.get('message') as string
      model_id = formData.get('model_id') as string | undefined

      const enabledToolsJson = formData.get('enabled_tools') as string | null
      if (enabledToolsJson) {
        enabled_tools = JSON.parse(enabledToolsJson)
      }

      // Extract and convert files to AgentCore format
      const uploadedFiles: File[] = []
      for (const [key, value] of formData.entries()) {
        if (key === 'files' && value instanceof File) {
          uploadedFiles.push(value)
        }
      }

      // Convert File objects to AgentCore format
      if (uploadedFiles.length > 0) {
        files = await Promise.all(
          uploadedFiles.map(async (file) => {
            const buffer = await file.arrayBuffer()
            const base64 = Buffer.from(buffer).toString('base64')

            return {
              filename: file.name,
              content_type: file.type || 'application/octet-stream',
              bytes: base64
            } as any // Type assertion to avoid AgentCore File type conflict
          })
        )
        console.log(`[BFF] Converted ${files.length} file(s) to AgentCore format`)
      }
    } else {
      // Parse JSON for text-only messages
      const body = await request.json()
      message = body.message
      model_id = body.model_id
      enabled_tools = body.enabled_tools
    }

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Extract user from Cognito JWT token in Authorization header
    const user = extractUserFromRequest(request)
    const userId = user.userId

    // Get or generate session ID (user-specific)
    const { sessionId, isNew: isNewSession } = getSessionId(request, userId)

    console.log(`[BFF] User: ${userId}, Session: ${sessionId}${isNewSession ? ' (new)' : ''}`)

    // If new session, create session metadata
    if (isNewSession) {
      const now = new Date().toISOString()
      const sessionData = {
        title: message.length > 50 ? message.substring(0, 47) + '...' : message,
        messageCount: 0,
        lastMessageAt: now,
        status: 'active' as const,
        starred: false,
        tags: [],
      }

      // Create session in storage
      if (userId === 'anonymous') {
        if (IS_LOCAL) {
          const { upsertSession } = await import('@/lib/local-session-store')
          upsertSession(userId, sessionId, sessionData)
        }
      } else {
        if (IS_LOCAL) {
          const { upsertSession } = await import('@/lib/local-session-store')
          upsertSession(userId, sessionId, sessionData)
        } else {
          const { upsertSession: upsertDynamoSession } = await import('@/lib/dynamodb-client')
          await upsertDynamoSession(userId, sessionId, sessionData)
        }
      }
    }

    // Load or use provided enabled_tools
    let enabledToolsList: string[] = []

    if (enabled_tools && Array.isArray(enabled_tools)) {
      enabledToolsList = enabled_tools
    } else if (userId !== 'anonymous') {
      if (IS_LOCAL) {
        const { getUserEnabledTools } = await import('@/lib/local-tool-store')
        enabledToolsList = getUserEnabledTools(userId)
      } else {
        const { getUserEnabledTools } = await import('@/lib/dynamodb-client')
        enabledToolsList = await getUserEnabledTools(userId)
      }
    }

    // Load model configuration from storage
    const defaultModelId = model_id || 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
    let modelConfig = {
      model_id: defaultModelId,
      temperature: 0.7,
      system_prompt: `You are an intelligent AI agent with dynamic tool capabilities. You can perform various tasks based on the combination of tools available to you.

Key guidelines:
- You can ONLY use tools that are explicitly provided to you in each conversation
- Available tools may change throughout the conversation based on user preferences
- When multiple tools are available, select and use the most appropriate combination in the optimal order to fulfill the user's request
- Break down complex tasks into steps and use multiple tools sequentially or in parallel as needed
- Always explain your reasoning when using tools
- If you don't have the right tool for a task, clearly inform the user about the limitation

Your goal is to be helpful, accurate, and efficient in completing user requests using the available tools.`,
      caching_enabled: defaultModelId.toLowerCase().includes('claude') || defaultModelId.toLowerCase().includes('nova')
    }

    if (userId !== 'anonymous') {
      if (IS_LOCAL) {
        try {
          const { getUserModelConfig } = await import('@/lib/local-tool-store')
          const config = getUserModelConfig(userId)
          if (config) {
            modelConfig = { ...modelConfig, ...config }
            // Auto-enable caching for Claude and Nova models
            if (config.model_id) {
              modelConfig.caching_enabled = config.model_id.toLowerCase().includes('claude') || config.model_id.toLowerCase().includes('nova')
            }
          }
        } catch (error) {
          // Use defaults
        }
      } else {
        try {
          const { getUserProfile } = await import('@/lib/dynamodb-client')
          const profile = await getUserProfile(userId)
          if (profile?.preferences) {
            if (profile.preferences.defaultModel) {
              modelConfig.model_id = profile.preferences.defaultModel
              // Auto-enable caching for Claude and Nova models
              modelConfig.caching_enabled = profile.preferences.defaultModel.toLowerCase().includes('claude') || profile.preferences.defaultModel.toLowerCase().includes('nova')
            }
            if (profile.preferences.defaultTemperature !== undefined) {
              modelConfig.temperature = profile.preferences.defaultTemperature
            }
            if (profile.preferences.systemPrompt) {
              modelConfig.system_prompt = profile.preferences.systemPrompt
            }
          }
        } catch (error) {
          // Use defaults
        }
      }
    }

    // Create a custom stream that:
    // 1. Immediately starts sending keep-alive (before AgentCore responds)
    // 2. Continues keep-alive during AgentCore processing
    // 3. Forwards AgentCore chunks when they arrive
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        let lastActivityTime = Date.now()
        let keepAliveInterval: NodeJS.Timeout | null = null
        let agentStarted = false

        // Send initial keep-alive immediately to establish connection
        controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`))

        // Start keep-alive interval (runs every 20 seconds)
        keepAliveInterval = setInterval(() => {
          const now = Date.now()
          const timeSinceActivity = now - lastActivityTime

          if (timeSinceActivity >= 20000) {
            controller.enqueue(encoder.encode(`: keep-alive ${new Date().toISOString()}\n\n`))
            lastActivityTime = now
          }
        }, 20000)

        try {
          // Execute before hooks (session metadata, tool config, etc.)
          const hookManager = createDefaultHookManager()
          await hookManager.executeBeforeHooks({
            userId,
            sessionId,
            message,
            modelConfig,
            enabledTools: enabledToolsList,
          })

          const agentStream = await invokeAgentCoreRuntime(
            userId,
            sessionId,
            message,
            modelConfig.model_id,
            enabledToolsList.length > 0 ? enabledToolsList : undefined,
            files, // Pass uploaded files to AgentCore
            modelConfig.temperature,
            modelConfig.system_prompt,
            modelConfig.caching_enabled
          )
          agentStarted = true

          // Read from AgentCore stream and forward chunks
          const reader = agentStream.getReader()

          while (true) {
            const { done, value } = await reader.read()

            if (done) break

            controller.enqueue(value)
            lastActivityTime = Date.now()
          }

        } catch (error) {
          console.error('[BFF] Error:', error)
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            content: error instanceof Error ? error.message : 'Unknown error',
            metadata: { session_id: sessionId }
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
        } finally {
          // Update session metadata after message processing
          try {
            let currentSession: any = null
            if (userId === 'anonymous') {
              if (IS_LOCAL) {
                const { getSession } = await import('@/lib/local-session-store')
                currentSession = getSession(userId, sessionId)
              }
            } else {
              if (IS_LOCAL) {
                const { getSession } = await import('@/lib/local-session-store')
                currentSession = getSession(userId, sessionId)
              } else {
                const { getSession: getDynamoSession } = await import('@/lib/dynamodb-client')
                currentSession = await getDynamoSession(userId, sessionId)
              }
            }

            if (currentSession) {
              const updates: any = {
                lastMessageAt: new Date().toISOString(),
                messageCount: (currentSession.messageCount || 0) + 1,
              }

              if (userId === 'anonymous') {
                if (IS_LOCAL) {
                  const { updateSession } = await import('@/lib/local-session-store')
                  updateSession(userId, sessionId, updates)
                }
              } else {
                if (IS_LOCAL) {
                  const { updateSession } = await import('@/lib/local-session-store')
                  updateSession(userId, sessionId, updates)
                } else {
                  const { updateSession: updateDynamoSession } = await import('@/lib/dynamodb-client')
                  await updateDynamoSession(userId, sessionId, updates)
                }
              }
            }
          } catch (updateError) {
            console.error('[BFF] Session update error:', updateError)
          }

          if (keepAliveInterval) {
            clearInterval(keepAliveInterval)
          }
          controller.close()
        }
      }
    })

    // Set headers for Server-Sent Events
    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Session-ID': sessionId,
      'X-Session-Is-New': isNewSession ? 'true' : 'false',
      'Connection': 'keep-alive'
    })

    // Return the stream
    return new Response(stream, { headers })

  } catch (error) {
    console.error('[BFF] Error in chat endpoint:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
