"""Browser Live View API endpoint

Provides presigned URLs for DCV live view connections.
Uses BrowserClient SDK to generate properly signed URLs.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import logging
import os

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/browser/live-view")
async def get_browser_live_view_url(sessionId: str, browserId: str):
    """Get presigned live view URL for browser session.

    This endpoint uses BrowserClient.generate_live_view_url() to create
    a properly signed WebSocket URL for DCV live view connections.

    Query Parameters:
        sessionId: Browser session ID (from metadata)
        browserId: Browser identifier

    Returns:
        JSONResponse with:
        - presignedUrl: WSS URL with AWS SigV4 signature
        - sessionId: Browser session ID
        - browserId: Browser identifier
        - expiresIn: URL expiration time (seconds)
    """
    try:
        logger.info(f"[Live View] Request for browser sessionId={sessionId}, browserId={browserId}")

        # Import here to avoid circular dependencies
        from builtin_tools.lib.browser_controller import _browser_sessions

        # Find controller by browser session ID
        # sessionId here is actually the browser session ID from metadata
        controller = None
        for chat_session_id, ctrl in _browser_sessions.items():
            if (ctrl.browser_session_client and
                ctrl.browser_session_client.session_id == sessionId):
                controller = ctrl
                logger.info(f"[Live View] Found controller for chat session: {chat_session_id}")
                break

        if not controller:
            logger.error(f"[Live View] No controller found for browser session: {sessionId}")
            logger.error(f"[Live View] Available sessions: {list(_browser_sessions.keys())}")
            raise HTTPException(
                status_code=404,
                detail=f"Browser session not found: {sessionId}"
            )

        if not controller.browser_session_client:
            raise HTTPException(
                status_code=400,
                detail="Browser session client not initialized"
            )

        # Verify browser IDs match
        if controller.browser_id != browserId:
            logger.warning(
                f"[Live View] Browser ID mismatch: requested={browserId}, "
                f"controller={controller.browser_id}"
            )

        # Generate presigned live view URL using SDK
        # Note: SDK limits expires to max 300 seconds (5 minutes)
        expires = 300

        try:
            presigned_url = controller.browser_session_client.generate_live_view_url(
                expires=expires
            )

            # Keep HTTPS format - DCV SDK handles WebSocket conversion internally
            logger.info(
                f"[Live View] Generated fresh presigned URL for browser session {sessionId}: "
                f"{presigned_url[:100]}..."
            )

            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "presignedUrl": presigned_url,
                    "sessionId": sessionId,
                    "browserId": browserId,
                    "expiresIn": expires,
                }
            )

        except Exception as e:
            import traceback
            logger.error(f"[Live View] Failed to generate presigned URL: {e}")
            logger.error(f"[Live View] Traceback: {traceback.format_exc()}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate live view URL: {str(e)}"
            )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[Live View] Unexpected error: {e}")
        logger.error(f"[Live View] Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )
