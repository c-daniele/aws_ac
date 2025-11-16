/**
 * Gateway Target Stack for AgentCore Gateway
 * Creates Gateway Targets that connect Lambda functions to the Gateway
 * Total: 12 tools across 5 Lambda functions
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'

export interface GatewayTargetStackProps extends cdk.StackProps {
  gateway: agentcore.CfnGateway
  functions: Map<string, lambda.Function>
}

export class GatewayTargetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GatewayTargetStackProps) {
    super(scope, id, props)

    const { gateway, functions } = props

    // ============================================================
    // Tavily Targets (2 tools)
    // ============================================================

    const tavilyFn = functions.get('tavily')!

    new agentcore.CfnGatewayTarget(this, 'TavilySearchTarget', {
      name: 'tavily-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Tavily AI-powered web search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: tavilyFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'tavily_search',
                  description:
                    'AI-powered web search using Tavily. Returns up to 5 high-quality results with relevance scores.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                    required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query',
                      },
                      search_depth: {
                        type: 'string',
                        description: "Search depth: 'basic' or 'advanced' (default: basic)",
                      },
                      topic: {
                        type: 'string',
                        description: "Search topic: 'general' or 'news' (default: general)",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'TavilyExtractTarget', {
      name: 'tavily-extract',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Tavily content extraction from URLs',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: tavilyFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'tavily_extract',
                  description:
                    'Extract clean content from web URLs using Tavily. Removes ads and boilerplate.',
                  inputSchema: {
                    type: 'object',
                    description: 'Extraction parameters',
                        required: ['urls'],
                    properties: {
                      urls: {
                        type: 'string',
                        description: 'Comma-separated URLs to extract content from',
                      },
                      extract_depth: {
                        type: 'string',
                        description: "Extraction depth: 'basic' or 'advanced' (default: basic)",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Wikipedia Targets (2 tools)
    // ============================================================

    const wikipediaFn = functions.get('wikipedia')!

    new agentcore.CfnGatewayTarget(this, 'WikipediaSearchTarget', {
      name: 'wikipedia-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Wikipedia article search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: wikipediaFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'wikipedia_search',
                  description:
                    'Search Wikipedia for articles. Returns up to 5 results with titles, snippets, and URLs.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                        required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query for Wikipedia articles',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'WikipediaGetArticleTarget', {
      name: 'wikipedia-get-article',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Wikipedia article retrieval',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: wikipediaFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'wikipedia_get_article',
                  description: 'Get full content of a specific Wikipedia article by title.',
                  inputSchema: {
                    type: 'object',
                    description: 'Article retrieval parameters',
                        required: ['title'],
                    properties: {
                      title: {
                        type: 'string',
                        description: 'Exact title of the Wikipedia article',
                      },
                      summary_only: {
                        type: 'boolean',
                        description:
                          'If true, return only summary; if false, return full text (default: false)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // ArXiv Targets (2 tools)
    // ============================================================

    const arxivFn = functions.get('arxiv')!

    new agentcore.CfnGatewayTarget(this, 'ArxivSearchTarget', {
      name: 'arxiv-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'ArXiv paper search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: arxivFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'arxiv_search',
                  description:
                    'Search for scientific papers on ArXiv. Returns up to 5 results with title, authors, abstract, and paper ID.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                        required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query for ArXiv papers',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'ArxivGetPaperTarget', {
      name: 'arxiv-get-paper',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'ArXiv paper retrieval',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: arxivFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'arxiv_get_paper',
                  description:
                    "Get full paper content from ArXiv by paper ID. Supports batch retrieval with comma-separated IDs.",
                  inputSchema: {
                    type: 'object',
                    description: 'Paper retrieval parameters',
                        required: ['paper_ids'],
                    properties: {
                      paper_ids: {
                        type: 'string',
                        description:
                          "ArXiv paper ID or comma-separated IDs (e.g., '2308.08155' or '2308.08155,2401.12345')",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Google Search Targets (2 tools)
    // ============================================================

    const googleFn = functions.get('google-search')!

    new agentcore.CfnGatewayTarget(this, 'GoogleWebSearchTarget', {
      name: 'google-web-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google web search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'google_web_search',
                  description:
                    'Search the web using Google Custom Search API. Returns up to 5 high-quality results.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                        required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query string',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'GoogleImageSearchTarget', {
      name: 'google-image-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google image search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'google_image_search',
                  description:
                    "Search for images using Google's image search. Returns up to 5 verified accessible images.",
                  inputSchema: {
                    type: 'object',
                    description: 'Image search parameters',
                        required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query for images',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Finance Targets (4 tools)
    // ============================================================

    const financeFn = functions.get('finance')!

    new agentcore.CfnGatewayTarget(this, 'StockQuoteTarget', {
      name: 'stock-quote',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Stock quote data',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'stock_quote',
                  description:
                    'Get current stock quote with price, change, volume, and key metrics.',
                  inputSchema: {
                    type: 'object',
                    description: 'Stock quote parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'StockHistoryTarget', {
      name: 'stock-history',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Stock historical data',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'stock_history',
                  description:
                    'Get historical stock price data (OHLCV) over a specified time period.',
                  inputSchema: {
                    type: 'object',
                    description: 'Historical data parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                      period: {
                        type: 'string',
                        description:
                          'Time period: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max (default: 1mo)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'FinancialNewsTarget', {
      name: 'financial-news',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Financial news articles',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'financial_news',
                  description: 'Get latest financial news articles for a stock symbol.',
                  inputSchema: {
                    type: 'object',
                    description: 'News parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                      count: {
                        type: 'integer',
                        description: 'Number of news articles to return (1-20, default: 5)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'StockAnalysisTarget', {
      name: 'stock-analysis',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Stock analysis and metrics',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'stock_analysis',
                  description:
                    'Get comprehensive stock analysis including valuation metrics, financial metrics, and analyst recommendations.',
                  inputSchema: {
                    type: 'object',
                    description: 'Analysis parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'TotalTargets', {
      value: '12',
      description: 'Total number of Gateway Targets (tools)',
    })

    new cdk.CfnOutput(this, 'TargetsSummary', {
      value: 'Tavily (2), Wikipedia (2), ArXiv (2), Google (2), Finance (4)',
      description: 'Gateway Targets by category',
    })
  }
}
