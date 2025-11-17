# Strands Agent Chatbot with AgentCore

AI agent platform built on **AWS Bedrock AgentCore** and **Strands Agents framework**. Deploy conversational AI with dynamic tool management, multi-layered memory, and flexible integration patterns.

## What's New: AgentCore Integration

This platform showcases AWS Bedrock AgentCore's capabilities:

- **AgentCore Runtime**: Containerized Strands Agent as managed AWS service
- **AgentCore Memory**: Persistent conversation history with DynamoDB backend
- **AgentCore Gateway**: SigV4-authenticated Lambda tools (12 tools via 5 functions)
- **Turn-based Session Management**: Optimized memory persistence with buffering
- **Dynamic Tool Filtering**: Per-user tool selection with real-time updates

## Architecture

<img src="docs/images/architecture-overview.svg"
     alt="Architecture Overview"
     width="1200">

### Core Components

1. **Frontend + BFF** (Next.js)
   - Server-side API routes as Backend-for-Frontend
   - Cognito authentication with JWT validation
   - SSE streaming from AgentCore Runtime
   - Session management and file upload handling

2. **AgentCore Runtime**
   - Strands Agent with Bedrock Claude models
   - Turn-based session manager (optimized message buffering)
   - Uses AgentCore Memory for conversation persistence
   - Integrates with AgentCore Gateway via SigV4
   - Calls Built-in Tools via AWS API
   - Communicates with other agents via A2A protocol (Work in Progress)

3. **AgentCore Gateway**
   - API Gateway with SigV4 authentication
   - Routes requests to 5 Lambda functions (12 tools total)
   - Lambda functions use MCP protocol
   - Tools: Wikipedia, ArXiv, Google Search, Tavily, Finance

4. **AgentCore Memory**
   - DynamoDB-backed conversation persistence
   - Automatic history management across sessions

5. **Tool Ecosystem**
   - **Local Tools**: Weather, visualization, web search, URL fetcher (embedded in Runtime)
   - **Built-in Tools**: Bedrock Code Interpreter for diagrams/charts (AWS API)
   - **Gateway Tools**: Research, search, and finance data (via AgentCore Gateway + MCP)
   - **Runtime Tools** (Work in Progress): Report Writer with A2A protocol

## Key Features

![Demo](docs/images/home.gif)

### Dynamic Tool Management

- **Per-user tool selection**: Each user can enable/disable specific tools
- **Real-time filtering**: Tools are filtered before each agent invocation
- **Category organization**: Local, Built-in, Gateway, Runtime
- **Connection monitoring**: Real-time status for Gateway tools

### Memory Layers

**Turn-based Session Management**:
- Buffers messages within a "turn" to reduce API calls
- Merges consecutive user messages before persistence
- Integrated with AgentCore Memory 
- Conversation history retained across sessions

**Session Isolation**:
- User-specific sessions via Cognito user ID
- Automatic session creation and cleanup
- Fresh start with page refresh

## Tool Categories

### Local Tools (5 tools)
Embedded in AgentCore Runtime container:
- **Calculator**: Mathematical computations (Strands built-in)
- **Weather**: Current weather by city (wttr.in API)
- **Visualization**: Chart generation (Plotly)
- **Web Search**: DuckDuckGo search
- **URL Fetcher**: Web content extraction

### Built-in Tools (1 tool)
AWS Bedrock-powered capabilities:
- **Diagram Generator**: Python code + Bedrock Code Interpreter
  - Architecture diagrams (AWS, UML)
  - Charts and visualizations
  - Server-side rendering with file download

### Gateway Tools (12 tools via 5 Lambdas)
Accessed via AgentCore Gateway with SigV4 auth:

| Lambda Function | Tools | API Keys Required |
|----------------|-------|-------------------|
| **mcp-wikipedia** | search, get_article | None |
| **mcp-arxiv** | search, get_paper | None |
| **mcp-google-search** | web_search, image_search | Google API + Search Engine ID |
| **mcp-tavily** | search, extract | Tavily API Key |
| **mcp-finance** | stock_quote, stock_history, news, analysis | None (Yahoo Finance) |

<img src="docs/images/finance.gif" alt="Finance Tools Demo" width="800">

### Runtime Tools (9 tools via 1 Runtime)
Agent-to-Agent (A2A) protocol communication (**Work in Progress**):
- **Report Writer**: Comprehensive research reports
  - Create report with outline
  - Write sections with markdown
  - Generate charts (Python + Code Interpreter)
  - Export to DOCX (S3 storage)

## Quick Start

### Prerequisites

- AWS Account with Bedrock access
- AWS CLI configured
- Docker installed
- Node.js 18+ and Python 3.13+

### Local Development

```bash
# 1. Clone and setup
git clone <repository-url>
cd sample-strands-agent-chatbot/chatbot-app
./setup.sh

# 2. Configure environment
cd ../agent-blueprint
cp .env.example .env
# Edit .env with your AWS credentials

# 3. Start services
cd ../chatbot-app
./start.sh
```

Access at: http://localhost:3000

### Cloud Deployment

```bash
# Full deployment (all components)
cd agent-blueprint
./deploy.sh

# Or deploy individually:
# 1. Main application (Frontend + AgentCore Runtime)
cd chatbot-deployment/infrastructure
./scripts/deploy.sh

# 2. AgentCore Gateway (Lambda tools)
cd ../../agentcore-gateway-stack
./scripts/deploy.sh

# 3. Report Writer Runtime (optional)
cd ../agentcore-runtime-a2a-stack/report-writer
./deploy.sh
```

## Configuration

### Tool Filtering

Tools are configured in `chatbot-app/frontend/src/config/tools-config.json`:

```json
{
  "local_tools": [
    {
      "id": "calculator",
      "name": "Calculator",
      "enabled": true,
      "isDynamic": false
    }
  ],
  "gateway_targets": [
    {
      "id": "gateway_wikipedia-search",
      "name": "Wikipedia",
      "enabled": false,
      "isDynamic": true,
      "tools": [
        {
          "id": "gateway_wikipedia-search___wikipedia_search",
          "name": "Search Articles"
        }
      ]
    }
  ]
}
```

**isDynamic**: Controls whether users can toggle the tool on/off

### API Keys

Configure Gateway tool API keys in AWS Secrets Manager:

```bash
# Tavily API Key
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/tavily-api-key \
  --secret-string "YOUR_KEY"

# Google Search Credentials
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/google-credentials \
  --secret-string '{"api_key":"KEY","search_engine_id":"ID"}'
```

### Model Configuration

<img src="docs/images/model-config.png"
     alt="Model Configuration"
     width="400">

Configure via UI:
- **Model**: Claude Sonnet 4, Haiku 4.5, etc.
- **Temperature**: 0.0 (focused) to 1.0 (creative)
- **System Prompt**: General, Code, Research, RAG Agent
- **Caching**: Enable/disable prompt caching

## Deployment Architecture

```
User → CloudFront → ALB → Frontend+BFF (Fargate)
                              ↓ HTTP
                         AgentCore Runtime
                         (AWS Bedrock service)
                              ↓
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ↓ SigV4           ↓ A2A             ↓ AWS API
     AgentCore Gateway   Report Writer     Built-in Tools
     (API Gateway)       Runtime           (Code Interpreter)
            ↓
     Lambda Functions (5x)
     (MCP Protocol)
```

## Technology Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui
- **BFF**: Next.js API Routes (server-side) on Fargate
- **Runtime**: Strands Agents v1.2.0 + FastAPI (Python 3.13) on AgentCore Runtime
- **AI**: AWS Bedrock (Claude Haiku 4.5 default)
- **AgentCore**: Runtime, Memory, Gateway components
- **Tools**: Lambda Functions (MCP protocol)
- **Infrastructure**: AWS CDK, CloudFront, Cognito


## Iframe Embedding

Embed the chatbot in external applications:

```html
<iframe
  src="https://your-domain.com/embed"
  width="100%"
  height="600"
  frameborder="0">
</iframe>
```

See [docs/guides/EMBEDDING_GUIDE.md](docs/guides/EMBEDDING_GUIDE.md) for details.

## Project Structure

```
sample-strands-agent-chatbot/
├── chatbot-app/
│   ├── frontend/              # Next.js (Frontend + BFF)
│   │   └── src/
│   │       ├── app/api/       # API routes (BFF layer)
│   │       ├── components/    # React components
│   │       └── config/        # Tool configuration
│   └── agentcore/             # AgentCore Runtime
│       └── src/
│           ├── agent/         # ChatbotAgent + session management
│           ├── local_tools/   # Weather, visualization, etc.
│           ├── builtin_tools/ # Code Interpreter tools
│           └── routers/       # FastAPI routes
│
└── agent-blueprint/
    ├── chatbot-deployment/    # Main app stack (Frontend+Runtime)
    ├── agentcore-gateway-stack/   # Gateway + 5 Lambda functions
    ├── agentcore-runtime-stack/   # Runtime deployment (shared)
    └── agentcore-runtime-a2a-stack/   # Report Writer (optional)
```

## What's Not Implemented

- **Browser Built-in Tool**: Natural language browser automation (planned)
- **Redis Short-term Memory**: Currently using AgentCore Memory only
- **Multi-model Support**: Only Claude models (Bedrock limitation)

## Documentation

- [DEPLOYMENT.md](DEPLOYMENT.md): Detailed deployment instructions

## Support

- **Issues**: [GitHub Issues](https://github.com/aws-samples/sample-strands-agent-chatbot/issues)
- **Troubleshooting**: [docs/guides/TROUBLESHOOTING.md](docs/guides/TROUBLESHOOTING.md)

## License

MIT License - see LICENSE file for details.

---

**Built with AWS Bedrock AgentCore** | [AWS Samples](https://github.com/aws-samples)
