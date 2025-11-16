import { useCallback, useRef, useState, useEffect } from 'react'
import { Message, Tool } from '@/types/chat'
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
      console.log(`[useChatAPI] Restoring last session: ${lastSessionId}`)
      setSessionId(lastSessionId)
      sessionIdRef.current = lastSessionId
      // Note: loadSession will be called by useChat hook
    } else {
      console.log('[useChatAPI] No last session, starting with empty state')
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
      console.log('[useChatAPI] Starting new chat (lazy creation)')

      // Clear local state only - no server call
      setMessages([])
      setSessionId(null)
      sessionIdRef.current = null
      sessionStorage.removeItem('chat-session-id')

      console.log('[useChatAPI] Chat cleared, new session will be created on first message')
      return true
    } catch (error) {
      console.error('[useChatAPI] Error clearing chat:', error)
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

      // Extract enabled tools from current state
      const enabledToolIds = availableTools
        .filter(tool => tool.enabled)
        .map(tool => tool.id)

      // Combine with Gateway tool IDs
      const allEnabledToolIds = [...enabledToolIds, ...gatewayToolIds]

      logger.info(`Sending message with ${allEnabledToolIds.length} enabled tools (${enabledToolIds.length} local + ${gatewayToolIds.length} gateway)${files && files.length > 0 ? ` and ${files.length} files` : ''}:`, allEnabledToolIds)

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
        console.log(`[useChatAPI] Session updated: ${currentSessionId} -> ${responseSessionId}`)
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
        console.log(`[useChatAPI] New session created, refreshing session list`)
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
      console.log(`[useChatAPI] Loading session: ${newSessionId}`)
      logger.info(`Loading session: ${newSessionId}`)

      const authHeaders = await getAuthHeaders()

      // Load conversation history from AgentCore Memory
      const url = getApiUrl(`conversation/history?session_id=${newSessionId}`)
      console.log(`[useChatAPI] Fetching from URL: ${url}`)

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      })

      console.log(`[useChatAPI] Response status: ${response.status}`)

      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.status}`)
      }

      const data = await response.json()
      console.log(`[useChatAPI] Response data:`, data)

      if (!data.success) {
        throw new Error(data.error || 'Failed to load conversation history')
      }

      // BFF already merged toolUse + toolResult, just convert to UI format
      const loadedMessages: Message[] = data.messages
        .filter((msg: any) => {
          // Filter out empty messages
          const hasContent = msg.content && msg.content.trim()
          const hasToolExecutions = msg.toolExecutions && msg.toolExecutions.length > 0
          return hasContent || hasToolExecutions
        })
        .map((msg: any, index: number) => {
          console.log(`[useChatAPI] Processing message ${index}:`, {
            role: msg.role,
            isToolMessage: !!msg.isToolMessage,
            hasToolExecutions: !!msg.toolExecutions,
            content: msg.content?.substring(0, 50)
          })

          return {
            id: msg.id || `${newSessionId}-${index}`,
            text: msg.content || '',
            sender: msg.role === 'user' ? 'user' : 'bot',
            timestamp: new Date(msg.timestamp).toLocaleTimeString(),
            ...(msg.toolExecutions && {
              toolExecutions: msg.toolExecutions,
              isToolMessage: msg.isToolMessage
            })
          }
        })

      console.log(`[useChatAPI] Loaded ${loadedMessages.length} messages from BFF`)

      // Update messages and session ID
      setMessages(loadedMessages)
      setSessionId(newSessionId)
      sessionStorage.setItem('chat-session-id', newSessionId)

      logger.info(`Session loaded: ${newSessionId} with ${loadedMessages.length} messages`)
    } catch (error) {
      console.error('[useChatAPI] Failed to load session:', error)
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