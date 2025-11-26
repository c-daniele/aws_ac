"""Browser WebSocket connectivity test endpoint

This endpoint tests if AgentCore Browser WebSocket connections work
from the AgentCore Runtime environment.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
import logging
import os

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/test-browser")
async def test_browser_websocket():
    """Test AgentCore Browser WebSocket connectivity from Runtime environment.

    This endpoint attempts to:
    1. Create a browser session with AgentCore Browser (System Browser)
    2. Connect via WebSocket using Playwright CDP
    3. Navigate to a test page
    4. Return success/failure status

    Returns:
        JSONResponse with test results including:
        - status: "success" or "error"
        - details: Test execution details
        - websocket_url: WebSocket endpoint (if successful)
        - page_title: Loaded page title (if successful)
        - error: Error message (if failed)
    """
    logger.info("=== AgentCore Browser WebSocket Test ===")

    try:
        from bedrock_agentcore.tools.browser_client import browser_session
        from playwright.async_api import async_playwright

        region = os.getenv('AWS_REGION', 'us-west-2')
        logger.info(f"Testing browser connectivity in region: {region}")

        # Step 1: Create browser session
        logger.info("Creating AgentCore Browser session (System Browser)...")
        with browser_session(region) as client:
            ws_url, headers = client.generate_ws_headers()
            logger.info(f"✅ Browser session created - WebSocket URL: {ws_url[:50]}...")

            # Step 2: Connect via Playwright CDP
            logger.info("Connecting to browser via Playwright CDP...")
            async with async_playwright() as p:
                browser = await p.chromium.connect_over_cdp(ws_url, headers=headers)
                logger.info(f"✅ Connected to browser: {browser.version}")

                # Step 3: Create page and navigate
                logger.info("Creating page and navigating to example.com...")
                contexts = browser.contexts
                if not contexts:
                    raise Exception("No browser contexts available")

                page = await contexts[0].new_page()
                await page.goto("https://example.com", timeout=10000)
                title = await page.title()
                logger.info(f"✅ Page loaded successfully: {title}")

                # Cleanup
                await page.close()
                await browser.close()

        logger.info("=== Test PASSED ===")

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": "✅ AgentCore Browser WebSocket connectivity works!",
                "details": {
                    "region": region,
                    "websocket_url": ws_url[:50] + "...",
                    "browser_version": browser.version,
                    "page_title": title,
                    "test_url": "https://example.com"
                }
            }
        )

    except ImportError as e:
        logger.error(f"❌ Missing dependency: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "error": "dependency_missing",
                "message": str(e),
                "required_packages": [
                    "bedrock-agentcore",
                    "playwright"
                ]
            }
        )

    except Exception as e:
        import traceback
        logger.error(f"❌ Test FAILED: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "error": type(e).__name__,
                "message": str(e),
                "traceback": traceback.format_exc()[:500],
                "possible_causes": [
                    "Outbound WebSocket connections blocked in AgentCore Runtime",
                    "IAM permissions missing for bedrock-agentcore:* actions",
                    "AgentCore Browser service not available in region",
                    "Network timeout or connectivity issues"
                ]
            }
        )


@router.get("/test-browser-simple")
async def test_browser_session_only():
    """Simplified test - only session creation without WebSocket connection.

    This tests if the browser session can be created and WebSocket URL
    can be generated, without actually connecting.
    """
    logger.info("=== Simple Browser Session Test ===")

    try:
        from bedrock_agentcore.tools.browser_client import browser_session

        region = os.getenv('AWS_REGION', 'us-west-2')

        with browser_session(region) as client:
            ws_url, headers = client.generate_ws_headers()

            logger.info("✅ Session created successfully")

            return JSONResponse(
                status_code=200,
                content={
                    "status": "success",
                    "message": "✅ Browser session creation works",
                    "details": {
                        "region": region,
                        "websocket_url": ws_url[:50] + "...",
                        "headers_present": list(headers.keys())
                    }
                }
            )

    except Exception as e:
        import traceback
        logger.error(f"❌ Session creation failed: {e}")

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "error": type(e).__name__,
                "message": str(e),
                "traceback": traceback.format_exc()[:500]
            }
        )
