/**
 * Lambda Stack for AgentCore Gateway
 * Deploys Lambda functions for MCP tools
 */
import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'

export interface LambdaStackProps extends cdk.StackProps {
  projectName: string
  lambdaRole: iam.IRole
  gatewayArn: string
  tavilyApiKeySecret: secretsmanager.ISecret
  googleCredentialsSecret: secretsmanager.ISecret
}

export class LambdaStack extends cdk.Stack {
  public readonly functions: Map<string, lambda.Function>

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props)

    const { projectName, lambdaRole, gatewayArn, tavilyApiKeySecret, googleCredentialsSecret } =
      props

    this.functions = new Map()

    // ============================================================
    // Lambda Function Configurations
    // ============================================================

    interface LambdaConfig {
      id: string
      functionName: string
      description: string
      codePath: string
      timeout: number
      memorySize: number
      environment: { [key: string]: string }
    }

    const lambdaConfigs: LambdaConfig[] = [
      {
        id: 'tavily',
        functionName: 'mcp-tavily',
        description: 'Tavily AI-powered web search and content extraction',
        codePath: '../lambda-functions/tavily',
        timeout: 300,
        memorySize: 1024,
        environment: {
          TAVILY_API_KEY_SECRET_ARN: tavilyApiKeySecret.secretArn,
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'wikipedia',
        functionName: 'mcp-wikipedia',
        description: 'Wikipedia article search and retrieval',
        codePath: '../lambda-functions/wikipedia',
        timeout: 60,
        memorySize: 512,
        environment: {
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'arxiv',
        functionName: 'mcp-arxiv',
        description: 'ArXiv scientific paper search and retrieval',
        codePath: '../lambda-functions/arxiv',
        timeout: 120,
        memorySize: 512,
        environment: {
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'google-search',
        functionName: 'mcp-google-search',
        description: 'Google Custom Search for web and images',
        codePath: '../lambda-functions/google-search',
        timeout: 60,
        memorySize: 512,
        environment: {
          GOOGLE_CREDENTIALS_SECRET_ARN: googleCredentialsSecret.secretArn,
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'finance',
        functionName: 'mcp-finance',
        description: 'Yahoo Finance stock data and analysis',
        codePath: '../lambda-functions/finance',
        timeout: 120,
        memorySize: 1024,
        environment: {
          LOG_LEVEL: 'INFO',
        },
      },
    ]

    // ============================================================
    // Create Lambda Functions
    // ============================================================

    lambdaConfigs.forEach((config) => {
      // Create Lambda function
      const fn = new lambda.Function(this, `${config.id}Function`, {
        functionName: config.functionName,
        description: config.description,
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: 'lambda_function.lambda_handler',
        code: lambda.Code.fromAsset(`${config.codePath}/build.zip`),
        role: lambdaRole,
        architecture: lambda.Architecture.ARM_64,
        timeout: cdk.Duration.seconds(config.timeout),
        memorySize: config.memorySize,
        environment: config.environment,
      })

      // CloudWatch Log Group
      new logs.LogGroup(this, `${config.id}LogGroup`, {
        logGroupName: `/aws/lambda/${config.functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      })

      // Lambda Permission for Gateway to invoke
      fn.addPermission(`${config.id}GatewayPermission`, {
        principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: gatewayArn,
      })

      // Store function reference
      this.functions.set(config.id, fn)

      // Output
      new cdk.CfnOutput(this, `${config.id}FunctionArn`, {
        value: fn.functionArn,
        description: `Lambda ARN for ${config.id}`,
        exportName: `${projectName}-${config.id}-arn`,
      })
    })

    // ============================================================
    // Summary Output
    // ============================================================

    new cdk.CfnOutput(this, 'LambdaFunctionsSummary', {
      value: Array.from(this.functions.keys()).join(', '),
      description: 'Deployed Lambda functions',
    })

    new cdk.CfnOutput(this, 'TotalFunctions', {
      value: this.functions.size.toString(),
      description: 'Total number of Lambda functions',
    })
  }
}
