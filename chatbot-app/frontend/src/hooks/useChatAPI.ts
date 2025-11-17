import { useCallback, useRef, useState, useEffect } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { StreamEvent, ChatUIState } from '@/types/events'
import { getApiUrl } from '@/config/environment'
import logger from '@/utils/logger'
import { fetchAuthSession } from 'aws-amplify/auth'
import { apiGet, apiPost } from '@/lib/api-client'

interface UseChatAPIProps {
  backendUrl: string
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  availableTools: Tool[]  // Added: need current tools state
  setAvailableTools: React.Dispatch<React.SetStateAction<Tool[]>>
  handleStreamEvent: (event: StreamEvent) => void
  handleLegacyEvent: (data: any) => void
  onSessionCreated?: () => void  // Callback when new session is created
  gatewayToolIds?: string[]  // Gateway tool IDs from frontend
}

interface UseChatAPIReturn {
  loadTools: () => Promise<void>
  toggleTool: (toolId: string) => Promise<void>
  newChat: () => Promise<boolean>
  sendMessage: (messageToSend: string, files?: File[], onSuccess?: () => void, onError?: (error: string) => void) => Promise<void>
  cleanup: () => void
  sessionId: string | null
  isLoadingTools: boolean
  loadSession: (sessionId: string) => Promise<void>
}

export const useChatAPI = ({
  backendUrl,
  setUIState,
  setMessages,
  availableTools,
  setAvailableTools,
  handleStreamEvent,
  handleLegacyEvent,
  onSessionCreated,
  gatewayToolIds = []
}: UseChatAPIProps) => {

  const abortControllerRef = useRef<AbortController | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  // Restore last session on page load
  useEffect(() => {
    const lastSessionId = sessionStorage.getItem('chat-session-id')

    if (lastSessionId) {
      setSessionId(lastSessionId)
      sessionIdRef.current = lastSessionId
      // Note: loadSession will be called by useChat hook
    } else {
      setSessionId(null)
      sessionIdRef.current = null
    }
  }, [])

  // Sync sessionIdRef with sessionId state
  useEffect(() => {
    sessionIdRef.current = sessionId
    if (sessionId) {
      sessionStorage.setItem('chat-session-id', sessionId)
    }
  }, [sessionId])

  /**
   * Get Authorization header with Cognito JWT token
   */
  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    try {
      const session = await fetchAuthSession()
      const token = session.tokens?.idToken?.toString()

      if (token) {
        return { 'Authorization': `Bearer ${token}` }
      }
    } catch (error) {
      logger.debug('No auth session available (local dev or not authenticated)')
    }
    return {}
  }

  const loadTools = useCallback(async () => {
    try {
      const authHeaders = await getAuthHeaders()

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...authHeaders
      }

      // Include session ID in headers if available
      if (sessionId) {
        headers['X-Session-ID'] = sessionId
      }

      const response = await fetch(getApiUrl('tools'), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000)
      })

      if (response.ok) {
        // Extract session ID from response headers
        const responseSessionId = response.headers.get('X-Session-ID')

        // Only update session ID if we don't have one yet (initial load)
        if (responseSessionId && !sessionId) {
          setSessionId(responseSessionId)
        }

        const data = await response.json()
        // Combine regular tools and MCP servers from unified API response
        const allTools = [...(data.tools || []), ...(data.mcp_servers || [])]
        setAvailableTools(allTools)
      } else {
        setAvailableTools([])
      }
    } catch (error) {
      setAvailableTools([])
    }
  }, [setAvailableTools, sessionId])

  /**
   * Toggle tool enabled state (frontend-only, no API call)
   * Tool preferences are committed to DDB only when message is sent
   */
  const toggleTool = useCallback(async (toolId: string) => {
    try {
      // Update frontend state immediately (optimistic update)
      setAvailableTools(prev => prev.map(tool =>
        tool.id === toolId
          ? { ...tool, enabled: !tool.enabled }
          : tool
      ))

      logger.debug(`Tool ${toolId} toggled (frontend state only, will commit on next message)`)
    } catch (error) {
      logger.error('Failed to toggle tool:', error)
    }
  }, [setAvailableTools])

  const newChat = useCallback(async () => {
    try {
      // Clear local state only - no server call
      setMessages([])
      setSessionId(null)
      sessionIdRef.current = null
      sessionStorage.removeItem('chat-session-id')

      return true
    } catch (error) {
      logger.error('Error clearing chat:', error)
      return false
    }
  }, [setMessages])

  const sendMessage = useCallback(async (
    messageToSend: string,
    files?: File[],
    onSuccess?: () => void,
    onError?: (error: string) => void
  ) => {
    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      let response: Response;

      const authHeaders = await getAuthHeaders()

      // Use ref to get latest sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current

      // Extract enabled LOCAL tools only (exclude gateway tools)
      const enabledToolIds = availableTools
        .filter(tool => tool.enabled && !tool.id.startsWith('gateway_'))
        .map(tool => tool.id)

      // Combine with Gateway tool IDs (from props)
      const allEnabledToolIds = [...enabledToolIds, ...gatewayToolIds]

      logger.info(`Sending message with ${allEnabledToolIds.length} enabled tools (${enabledToolIds.length} local + ${gatewayToolIds.length} gateway)${files && files.length > 0 ? ` and ${files.length} files` : ''}`)

      if (files && files.length > 0) {
        // Use FormData for file uploads
        const formData = new FormData()
        formData.append('message', messageToSend)
        formData.append('enabled_tools', JSON.stringify(allEnabledToolIds))

        // Add all files to form data
        files.forEach((file) => {
          formData.append('files', file)
        })

        const headers: Record<string, string> = {
          ...authHeaders
        }
        if (currentSessionId) {
          headers['X-Session-ID'] = currentSessionId
        }

        response = await fetch(getApiUrl('stream/chat'), {
          method: 'POST',
          headers,
          body: formData,
          signal: abortControllerRef.current.signal
        })
      } else {
        // Use JSON for text-only messages
        response = await fetch(getApiUrl('stream/chat'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
            ...(currentSessionId && { 'X-Session-ID': currentSessionId })
          },
          body: JSON.stringify({
            message: messageToSend,
            enabled_tools: allEnabledToolIds
          }),
          signal: abortControllerRef.current.signal
        })
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // Extract session ID from response headers
      const responseSessionId = response.headers.get('X-Session-ID')

      if (responseSessionId && responseSessionId !== currentSessionId) {
        setSessionId(responseSessionId)
        sessionIdRef.current = responseSessionId
        sessionStorage.setItem('chat-session-id', responseSessionId)
        logger.info('Session updated:', responseSessionId)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body reader available')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            continue
          }
          
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.substring(6))
              
              // Handle new simplified events
              if (eventData.type && [
                'text', 'reasoning', 'response', 'tool_use', 'tool_result', 'tool_progress', 'complete', 'init', 'thinking', 'error',
                'spending_analysis_start', 'spending_analysis_step', 'spending_analysis_result',
                'spending_analysis_progress', 'spending_analysis_complete', 'spending_analysis_chart'
              ].includes(eventData.type)) {
                handleStreamEvent(eventData as StreamEvent)
              } else {
                // Handle other event types
                handleLegacyEvent(eventData)
              }
            } catch (parseError) {
              logger.error('Error parsing SSE data:', parseError)
            }
          }
        }
      }

      setUIState(prev => ({ ...prev, isConnected: true }))

      // Session metadata is automatically updated by backend (/api/stream/chat)
      // Just check if it's a new session and refresh the list
      const isNewSession = response.headers.get('X-Session-Is-New') === 'true'

      if (isNewSession) {
        logger.info(`New session created: ${responseSessionId || sessionId}`)
        // Refresh session list to show new session
        onSessionCreated?.()
      }

      onSuccess?.()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return // Request was aborted, don't show error
      }
      
      logger.error('Error sending message:', error)
      setUIState(prev => ({ ...prev, isConnected: false, isTyping: false }))
      
      const errorMessage = `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: errorMessage,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString()
      }])
      
      onError?.(errorMessage)
    }
  }, [handleStreamEvent, handleLegacyEvent, setUIState, setMessages, availableTools, gatewayToolIds, onSessionCreated])
  // sessionId removed from dependency array - using sessionIdRef.current instead

  const loadSession = useCallback(async (newSessionId: string) => {
    try {
      logger.info(`Loading session: ${newSessionId}`)

      const authHeaders = await getAuthHeaders()

      // Load conversation history from AgentCore Memory
      const url = getApiUrl(`conversation/history?session_id=${newSessionId}`)

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.status}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to load conversation history')
      }

      // Process messages - content is now an array format from AgentCore
      // First pass: collect all toolUse and toolResult across all messages
      const toolUseMap = new Map<string, any>() // toolUseId -> toolUse
      const toolResultMap = new Map<string, any>() // toolUseId -> toolResult

      data.messages.forEach((msg: any) => {
        if (Array.isArray(msg.content)) {
          msg.content.forEach((item: any) => {
            if (item.toolUse) {
              toolUseMap.set(item.toolUse.toolUseId, item.toolUse)
            } else if (item.toolResult) {
              toolResultMap.set(item.toolResult.toolUseId, item.toolResult)
            }
          })
        }
      })

      const loadedMessages: Message[] = data.messages
        .filter((msg: any) => {
          // Filter out messages that only contain toolResult (they'll be merged with toolUse)
          if (Array.isArray(msg.content)) {
            const hasOnlyToolResult = msg.content.every((item: any) => item.toolResult)
            return !hasOnlyToolResult
          }
          return true
        })
        .map((msg: any, index: number) => {
          // Extract text and tool executions from content array
          let text = ''
          const toolExecutions: any[] = []

          if (Array.isArray(msg.content)) {
            msg.content.forEach((item: any) => {
              if (item.text) {
                text += item.text
              } else if (item.toolUse) {
                // Find corresponding toolResult from the map
                const toolResult = toolResultMap.get(item.toolUse.toolUseId)

                // Convert toolResult.content array to string format
                let toolResultString = ''
                if (toolResult?.content && Array.isArray(toolResult.content)) {
                  toolResultString = toolResult.content
                    .map((c: any) => c.text || JSON.stringify(c))
                    .join('\n')
                }

                const execution: ToolExecution = {
                  id: item.toolUse.toolUseId,
                  toolName: item.toolUse.name,
                  toolInput: item.toolUse.input,
                  reasoning: [],
                  toolResult: toolResultString,
                  isComplete: true,
                  isExpanded: false
                }

                toolExecutions.push(execution)
              }
            })
          }

          const messageObj = {
            id: msg.id || `${newSessionId}-${index}`,
            text: text,
            sender: msg.role === 'user' ? 'user' : 'bot',
            timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
            ...(toolExecutions.length > 0 && {
              toolExecutions: toolExecutions,
              isToolMessage: true
            })
          }

          return messageObj
        })

      // Update messages and session ID
      setMessages(loadedMessages)
      setSessionId(newSessionId)
      sessionStorage.setItem('chat-session-id', newSessionId)

      logger.info(`Session loaded: ${newSessionId} with ${loadedMessages.length} messages`)
    } catch (error) {
      logger.error('Failed to load session:', error)
      throw error
    }
  }, [setMessages, getAuthHeaders])

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  return {
    loadTools,
    toggleTool,
    newChat,
    sendMessage,
    cleanup,
    sessionId,
    isLoadingTools: false,
    loadSession
  }
}