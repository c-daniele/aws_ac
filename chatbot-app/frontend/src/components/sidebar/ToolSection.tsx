'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { Tool } from '@/types/chat';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
} from '@/components/ui/sidebar';
import { ToolItem } from './ToolItem';

interface ToolSectionProps {
  title: string;
  icon: LucideIcon;
  tools: Tool[];
  category: 'local' | 'builtin' | 'gateway' | 'runtime-a2a';
  showToggleAll?: boolean;
  onToggleTool: (toolId: string) => void;
  onToggleCategory?: (category: 'local' | 'builtin' | 'gateway' | 'runtime-a2a') => void;
  areAllEnabled?: boolean;
}

export function ToolSection({
  title,
  icon: Icon,
  tools,
  category,
  showToggleAll = true,
  onToggleTool,
  onToggleCategory,
  areAllEnabled,
}: ToolSectionProps) {
  if (tools.length === 0) {
    return null;
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between">
        <div className="flex items-center">
          <Icon className="h-4 w-4 mr-2" />
          {title}
        </div>
        {showToggleAll && onToggleCategory && (
          <button
            onClick={() => onToggleCategory(category)}
            className="text-xs px-2 py-0.5 rounded hover:bg-sidebar-accent transition-colors"
          >
            {areAllEnabled ? 'Disable All' : 'Enable All'}
          </button>
        )}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {tools.map((tool) => (
            <ToolItem key={tool.id} tool={tool} onToggleTool={onToggleTool} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
