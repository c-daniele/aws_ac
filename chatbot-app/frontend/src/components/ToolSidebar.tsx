'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Settings, Wrench, Server, Brain, Moon, Sun, MessageSquare, Plus, Trash2, Globe } from 'lucide-react';
import { Tool } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useTheme } from 'next-themes';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { AddMcpServerDialog } from './AddMcpServerDialog';
import { EditMcpServerDialog } from './EditMcpServerDialog';
import { ModelConfigDialog } from './ModelConfigDialog';
import { useGatewayTools } from '@/hooks/useGatewayTools';
import toolsConfig from '@/config/tools-config.json';

interface ToolSidebarProps {
  availableTools: Tool[];
  onToggleTool: (toolId: string) => void;
  onNewChat: () => void;
  refreshTools: () => Promise<void>;
  sessionId: string | null;
  loadSession?: (sessionId: string) => Promise<void>;
  onSessionListRefresh?: () => void;
  onGatewayToolsChange?: (enabledToolIds: string[]) => void;  // Callback for Gateway tool changes
}

interface ChatSession {
  sessionId: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
  starred?: boolean;
  status: string;
  createdAt: string;
  tags?: string[];
}

interface McpServer {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  connected?: boolean;
  tool_count?: number;
  type?: string;
  config?: {
    url: string;
  };
  category?: string;
  icon?: string;
}

interface CustomTool {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: string;
  icon: string;
}

export function ToolSidebar({ availableTools, onToggleTool, onNewChat, refreshTools, sessionId, loadSession, onSessionListRefresh, onGatewayToolsChange }: ToolSidebarProps) {
  const { setOpenMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // AgentCore Gateway MCP Servers management
  const { gatewayTargets, isLoading: isLoadingGateway, refreshGatewayStatus, toggleGatewayTarget, getEnabledToolIds } = useGatewayTools();

  // Notify parent about Gateway tool changes
  useEffect(() => {
    if (onGatewayToolsChange) {
      const enabledIds = getEnabledToolIds();
      onGatewayToolsChange(enabledIds);
    }
  }, [gatewayTargets, onGatewayToolsChange, getEnabledToolIds]);

  // Load chat sessions function
  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const data = await apiGet<{ success: boolean; sessions: ChatSession[] }>(
        'session/list?limit=20&status=active',
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      if (data.success && data.sessions) {
        setChatSessions(data.sessions);
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [sessionId]);

  // Load chat sessions on mount and when sessionId changes
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Expose loadSessions to parent via callback
  useEffect(() => {
    if (onSessionListRefresh) {
      onSessionListRefresh();
    }
  }, []);

  // Provide refresh function to parent
  useEffect(() => {
    (window as any).__refreshSessionList = loadSessions;
    return () => {
      delete (window as any).__refreshSessionList;
    };
  }, [loadSessions]);

  // Extract MCP servers from availableTools
  const mcpServers = useMemo(() => {
    return availableTools
      .filter(tool => tool.tool_type === 'mcp')
      .map(tool => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        enabled: tool.enabled,
        connected: true, // Assume connected if in list
        tool_count: 1, // Default count
        type: tool.tool_type || 'mcp',
        config: (tool as any).config || { url: '' },
        category: tool.category || 'general',
        icon: tool.icon || 'server',
        connection_status: tool.connection_status || 'unknown'
      }));
  }, [availableTools]);

  // Group tools by tool_type (exclude MCP tools as they are handled separately)
  const groupedTools = useMemo(() => {
    const groups = {
      'local': [] as Tool[],
      'built-in': [] as Tool[],
      'custom': [] as Tool[],
      'agent': [] as Tool[]
    };

    availableTools.forEach(tool => {
      const toolType = tool.tool_type || 'built-in';
      // Skip MCP tools as they are handled in the separate MCP Servers section
      if (toolType === 'mcp') return;

      if (groups[toolType as keyof typeof groups]) {
        groups[toolType as keyof typeof groups].push(tool);
      }
    });

    return groups;
  }, [availableTools]);

  const enabledCount = availableTools.filter(tool => tool.enabled).length;
  const totalCount = availableTools.length;

  // Toggle all tools in a category
  const toggleCategory = (category: 'local' | 'built-in' | 'custom' | 'agent' | 'mcp') => {
    const tools = category === 'mcp' ? mcpServers.map(s => s.id) : groupedTools[category].map(t => t.id);
    const allEnabled = tools.every(toolId => {
      const tool = availableTools.find(t => t.id === toolId);
      return tool?.enabled;
    });

    // Toggle all tools in the category
    tools.forEach(toolId => {
      const tool = availableTools.find(t => t.id === toolId);
      if (tool && tool.enabled === allEnabled) {
        onToggleTool(toolId);
      }
    });
  };

  const toggleMcpServer = async (serverId: string) => {
    // Use the main onToggleTool function for MCP servers too
    await onToggleTool(serverId);
  };

  const updateMcpServer = async (serverId: string, serverConfig: any) => {
    try {
      const result = await apiPost(`mcp/servers/${serverId}/update`, serverConfig, {
        headers: {
          'X-Session-ID': sessionId || '',
        },
      });

      // Refresh tools to reflect the changes
      await refreshTools();

      return result;
    } catch (error) {
      console.error('Error updating MCP server:', error);
      throw error;
    }
  };

  // Add MCP server to session configuration
  const addMcpServer = async (serverConfig: any) => {
    try {
      const result = await apiPost<{ success: boolean; message?: string }>(
        'tools/mcp',
        serverConfig,
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      if (result.success) {
        // Refresh tools to show the new server
        await refreshTools();
      } else {
        throw new Error(result.message || 'Failed to add MCP server');
      }
    } catch (error) {
      console.error('Error adding MCP server:', error);
      throw error;
    }
  };

  const removeMcpServer = async (serverId: string) => {
    // Remove MCP server not implemented yet
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMins = Math.floor(diffInMs / 60000);
    const diffInHours = Math.floor(diffInMs / 3600000);
    const diffInDays = Math.floor(diffInMs / 86400000);

    if (diffInMins < 1) return 'Just now';
    if (diffInMins < 60) return `${diffInMins}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInDays < 7) return `${diffInDays}d ago`;
    return date.toLocaleDateString();
  };

  const deleteSession = async (sessionIdToDelete: string, e: React.MouseEvent) => {
    // Prevent the click from triggering the session load
    e.stopPropagation();

    try {
      const data = await apiDelete<{ success: boolean; error?: string }>(
        `session/delete?session_id=${sessionIdToDelete}`,
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      if (data.success) {
        // Refresh session list
        await loadSessions();

        // If deleted session was the active one, start new chat
        if (sessionIdToDelete === sessionId) {
          onNewChat();
        }
      } else {
        throw new Error(data.error || 'Failed to delete session');
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('Failed to delete session. Please try again.');
    }
  };

  return (
    <Sidebar side="left" className="group-data-[side=left]:border-r-0 bg-sidebar-background border-sidebar-border text-sidebar-foreground flex flex-col h-full">
        {/* Header */}
        <SidebarHeader className="flex-shrink-0 border-b border-sidebar-border/50">
          <SidebarMenu>
            <div className="flex flex-row justify-between items-center">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-sidebar-foreground" />
                <span className="text-lg font-semibold text-sidebar-foreground">Chatbot</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="h-8 w-8 p-0 relative"
                >
                  <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                  <span className="sr-only">Toggle theme</span>
                </Button>
                <ModelConfigDialog sessionId={sessionId} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onNewChat}
                  className="h-8 w-8 p-0"
                  title="New chat"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SidebarMenu>
        </SidebarHeader>

      {/* Chat Sessions Section - Top (1/3) */}
      <div className="flex-[1] min-h-0 flex flex-col border-b-2 border-sidebar-border/80">
        <div className="flex-1 overflow-y-auto">
          <SidebarMenu className="p-2">
            {isLoadingSessions ? (
              <div className="text-center py-8 text-sidebar-foreground/60">
                <p className="text-sm">Loading sessions...</p>
              </div>
            ) : chatSessions.length > 0 ? (
              chatSessions.map((session) => (
                <SidebarMenuItem key={session.sessionId} className="group">
                  <div
                    className={`flex items-start gap-2 p-2.5 rounded-lg hover:bg-sidebar-accent transition-colors cursor-pointer relative ${
                      session.sessionId === sessionId ? 'bg-sidebar-accent/50 ring-1 ring-primary/20' : ''
                    }`}
                    onClick={() => {
                      if (loadSession) {
                        loadSession(session.sessionId);
                      }
                    }}
                  >
                    <MessageSquare className="h-4 w-4 mt-0.5 text-sidebar-foreground/60 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-sidebar-foreground truncate">
                        {session.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-sidebar-foreground/60">
                          {session.messageCount} messages
                        </span>
                        <span className="text-xs text-sidebar-foreground/40">•</span>
                        <span className="text-xs text-sidebar-foreground/60">
                          {formatRelativeTime(session.lastMessageAt)}
                        </span>
                      </div>
                    </div>
                    {/* Delete button - shows on hover */}
                    <button
                      onClick={(e) => deleteSession(session.sessionId, e)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10 text-sidebar-foreground/60 hover:text-destructive flex-shrink-0"
                      title="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </SidebarMenuItem>
              ))
            ) : (
              <div className="text-center py-8 text-sidebar-foreground/60">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No chat history yet</p>
                <p className="text-xs mt-1 opacity-60">Start a conversation to see it here</p>
              </div>
            )}
          </SidebarMenu>
        </div>
      </div>

      {/* Tools Section - Bottom (2/3) */}
      <div className="flex-[2] min-h-0 flex flex-col">
        <div className="flex-shrink-0 px-4 py-3 border-b border-sidebar-border/50 bg-sidebar-accent/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-sidebar-foreground" />
              <span className="text-sm font-semibold text-sidebar-foreground">Tools</span>
            </div>
            <span className="text-xs text-sidebar-foreground/60">
              {enabledCount}/{totalCount} enabled
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarContent>
        {/* Only show content when tools are loaded */}
        {availableTools.length > 0 && (
          <div className="animate-in fade-in-0 duration-300">
            {/* Local Tools */}
            {groupedTools['local'].length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Wrench className="h-4 w-4 mr-2" />
                    Local Tools
                  </div>
                  <button
                    onClick={() => toggleCategory('local')}
                    className="text-xs px-2 py-0.5 rounded hover:bg-sidebar-accent transition-colors"
                  >
                    {groupedTools['local'].every(t => t.enabled) ? 'Disable All' : 'Enable All'}
                  </button>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupedTools['local'].map((tool) => (
                      <SidebarMenuItem key={tool.id}>
                        <div className="flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-sidebar-foreground truncate">
                              {tool.name}
                            </div>
                            <div className="text-xs text-sidebar-foreground truncate">
                              {tool.description}
                            </div>
                          </div>
                          <Switch
                            checked={tool.enabled}
                            onCheckedChange={() => onToggleTool(tool.id)}
                            className="ml-2 flex-shrink-0"
                          />
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {/* Built-In Tools (from tools-config.json) */}
            {toolsConfig.builtin_tools && toolsConfig.builtin_tools.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Brain className="h-4 w-4 mr-2" />
                    Built-In Tools
                  </div>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {toolsConfig.builtin_tools.map((tool) => {
                      // Find matching tool in availableTools to get enabled state
                      const matchedTool = availableTools.find(t => t.id === tool.id);
                      const isEnabled = matchedTool?.enabled ?? tool.enabled;

                      return (
                        <SidebarMenuItem key={tool.id}>
                          <div className="flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-sidebar-foreground truncate">
                                {tool.icon} {tool.name}
                              </div>
                              <div className="text-xs text-sidebar-foreground/70 truncate">
                                {tool.description}
                              </div>
                            </div>
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={() => onToggleTool(tool.id)}
                              className="ml-2 flex-shrink-0"
                            />
                          </div>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {/* Strands Built-in Tools */}
            {groupedTools['built-in'].length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Wrench className="h-4 w-4 mr-2" />
                    Strands Built-in
                  </div>
                  <button
                    onClick={() => toggleCategory('built-in')}
                    className="text-xs px-2 py-0.5 rounded hover:bg-sidebar-accent transition-colors"
                  >
                    {groupedTools['built-in'].every(t => t.enabled) ? 'Disable All' : 'Enable All'}
                  </button>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupedTools['built-in'].map((tool) => (
                      <SidebarMenuItem key={tool.id}>
                        <div className="flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-sidebar-foreground truncate">
                              {tool.name}
                            </div>
                            <div className="text-xs text-sidebar-foreground truncate">
                              {tool.description}
                            </div>
                          </div>
                          <Switch
                            checked={tool.enabled}
                            onCheckedChange={() => onToggleTool(tool.id)}
                            className="ml-2 flex-shrink-0"
                          />
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {/* Custom Tools */}
            {groupedTools['custom'].length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Wrench className="h-4 w-4 mr-2" />
                    Custom Tools
                  </div>
                  <button
                    onClick={() => toggleCategory('custom')}
                    className="text-xs px-2 py-0.5 rounded hover:bg-sidebar-accent transition-colors"
                  >
                    {groupedTools['custom'].every(t => t.enabled) ? 'Disable All' : 'Enable All'}
                  </button>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupedTools['custom'].map((tool) => (
                      <SidebarMenuItem key={tool.id}>
                        <div className="flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-sidebar-foreground truncate">
                              {tool.name}
                            </div>
                            <div className="text-xs text-sidebar-foreground truncate">
                              {tool.description}
                            </div>
                          </div>
                          <Switch
                            checked={tool.enabled}
                            onCheckedChange={() => onToggleTool(tool.id)}
                            className="ml-2 flex-shrink-0"
                          />
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {/* Agent Tools */}
            {groupedTools['agent'].length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Brain className="h-4 w-4 mr-2" />
                    AI Agents
                  </div>
                  <button
                    onClick={() => toggleCategory('agent')}
                    className="text-xs px-2 py-0.5 rounded hover:bg-sidebar-accent transition-colors"
                  >
                    {groupedTools['agent'].every(t => t.enabled) ? 'Disable All' : 'Enable All'}
                  </button>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupedTools['agent'].map((tool) => (
                      <SidebarMenuItem key={tool.id}>
                        <div className="flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-sidebar-foreground truncate">
                              {tool.name}
                            </div>
                            <div className="text-xs text-sidebar-foreground truncate">
                              {tool.description}
                            </div>
                          </div>
                          <Switch
                            checked={tool.enabled}
                            onCheckedChange={() => onToggleTool(tool.id)}
                            className="ml-2 flex-shrink-0"
                          />
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {/* AgentCore Gateway MCP Servers */}
            <SidebarGroup>
              <SidebarGroupLabel>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center">
                    <Globe className="h-4 w-4 mr-2" />
                    AgentCore Gateway MCP Servers
                  </div>
                  {gatewayTargets.length > 0 && (
                    <button
                      onClick={() => {
                        const allEnabled = gatewayTargets.every(t => t.enabled);
                        gatewayTargets.forEach(t => {
                          if (t.enabled === allEnabled) {
                            toggleGatewayTarget(t.id);
                          }
                        });
                      }}
                      className="text-xs px-2 py-0.5 rounded hover:bg-sidebar-accent transition-colors"
                    >
                      {gatewayTargets.every(t => t.enabled) ? 'Disable All' : 'Enable All'}
                    </button>
                  )}
                </div>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {isLoadingGateway ? (
                    <div className="text-center py-4 text-sidebar-foreground/60">
                      <p className="text-xs">Checking Gateway...</p>
                    </div>
                  ) : gatewayTargets.length > 0 ? (
                    gatewayTargets.map((target) => (
                      <SidebarMenuItem key={target.id}>
                        <div className="flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-sidebar-foreground truncate">
                              {target.name}
                            </div>
                            <div className="text-xs text-sidebar-foreground/70 truncate">
                              {target.description}
                            </div>
                            <div className="text-xs mt-1">
                              {target.available === true && (
                                <span className="text-green-600">● Available ({target.tools.length} tools)</span>
                              )}
                              {target.available === false && (
                                <span className="text-red-600">● Unavailable</span>
                              )}
                              {target.available === undefined && (
                                <span className="text-gray-500">● Checking...</span>
                              )}
                            </div>
                          </div>
                          <Switch
                            checked={target.enabled}
                            disabled={target.available === false}
                            onCheckedChange={() => {
                              // Collect all tool IDs BEFORE toggle (to predict next state)
                              const enabledToolIds: string[] = []
                              gatewayTargets.forEach(t => {
                                // Check if this target will be enabled after toggle
                                const willBeEnabled = (t.id === target.id) ? !t.enabled : t.enabled
                                if (willBeEnabled && t.tools) {
                                  t.tools.forEach(tool => {
                                    enabledToolIds.push(tool.id)
                                  })
                                }
                              })

                              // Toggle state and notify parent
                              toggleGatewayTarget(target.id)
                              onGatewayToolsChange?.(enabledToolIds)
                            }}
                            className="ml-2 flex-shrink-0"
                          />
                        </div>
                      </SidebarMenuItem>
                    ))
                  ) : (
                    <div className="text-center py-4 text-sidebar-foreground/60">
                      <Globe className="h-6 w-6 mx-auto mb-2 opacity-50" />
                      <p className="text-xs">No Gateway tools configured</p>
                    </div>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* AgentCore Runtime MCP Servers */}
            <SidebarGroup>
              <SidebarGroupLabel>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center">
                    <Server className="h-4 w-4 mr-2" />
                    AgentCore Runtime MCP Servers
                  </div>
                </div>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {toolsConfig.agentcore_runtime_mcp.map((server) => (
                    <SidebarMenuItem key={server.id}>
                      <div className="flex items-center justify-between p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors duration-150">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-sidebar-foreground truncate">
                            {server.name}
                          </div>
                          <div className="text-xs text-sidebar-foreground/70 truncate">
                            {server.description}
                          </div>
                          <div className="text-xs mt-1">
                            <span className="text-blue-600">● Available ({server.tools.length} tools)</span>
                          </div>
                        </div>
                        <div title="Coming soon - deploy via agent-blueprint/deploy.sh">
                          <Switch
                            checked={false}
                            disabled={true}
                            className="ml-2 flex-shrink-0"
                          />
                        </div>
                      </div>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        )}
          </SidebarContent>
        </div>
      </div>

      {/* Footer */}
      <SidebarFooter className="flex-shrink-0 border-t border-sidebar-border/50">
        <div className="text-xs text-sidebar-foreground/60 text-center">
          Press <kbd className="px-1.5 py-0.5 bg-sidebar-accent rounded text-xs font-mono">⌘B</kbd> to toggle
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
