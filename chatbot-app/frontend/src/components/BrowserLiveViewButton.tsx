'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Monitor, Loader2 } from 'lucide-react';
import { BrowserLiveViewModal } from './BrowserLiveViewModal';
import { useBrowserSessionValidation } from '@/hooks/useBrowserSessionValidation';

interface BrowserSession {
  sessionId: string | null;
  browserId: string | null;
}

interface BrowserLiveViewButtonProps {
  sessionId: string | null;
  browserSession: BrowserSession | null; // Directly from useChat state
}

/**
 * Button to open Browser Live View
 *
 * Shows immediately when browserSession is set in state (from tool metadata).
 * Validates session status asynchronously to ensure it's still READY.
 *
 * Flow:
 * 1. Receives browserSession from parent (set by tool result metadata)
 * 2. Shows button immediately
 * 3. Validates session status in background (must be READY)
 * 4. Hides button if validation fails
 */
export function BrowserLiveViewButton({ sessionId, browserSession }: BrowserLiveViewButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Validate browser session in background (won't block rendering)
  const { isValid, isLoading } = useBrowserSessionValidation(sessionId, browserSession);

  // Don't show button if no browser session in state
  if (!browserSession) {
    return null;
  }

  // Show button immediately, but disable while validating
  // This provides instant feedback to user
  if (isLoading) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="gap-2 opacity-50"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking...
      </Button>
    );
  }

  // Hide button if validation failed (session not READY)
  if (!isValid) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsModalOpen(true)}
        className="gap-2"
        title="View browser automation in real-time"
      >
        <Monitor className="w-4 h-4" />
        View Browser
        <span className="ml-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      </Button>

      <BrowserLiveViewModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        sessionId={browserSession.sessionId}
        browserId={browserSession.browserId}
      />
    </>
  );
}
