/**
 * AWS Bedrock AgentCore Runtime Stack
 * Deploys Strands Agent as AgentCore Runtime using L1 constructs (CfnRuntime)
 * Includes CodeBuild for automated container image building
 * Includes AgentCore Memory for user preference retention using L1 construct (CfnMemory)
 * Includes Bedrock Knowledge Base with S3 Vector Bucket for RAG capabilities
 * Based on: sdk-python/sample-amazon-bedrock-agentcore-fullstack-webapp
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import * as cr from 'aws-cdk-lib/custom-resources'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import { Construct } from 'constructs'

export interface AgentRuntimeStackProps extends cdk.StackProps {
  projectName?: string
  environment?: string
  vpcId?: string
}

export class AgentRuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.CfnRuntime
  public readonly runtimeArn: string
  public readonly memory: agentcore.CfnMemory
  public readonly memoryArn: string

  constructor(scope: Construct, id: string, props?: AgentRuntimeStackProps) {
    super(scope, id, props)

    const projectName = props?.projectName || 'strands-agent-chatbot'
    const environment = props?.environment || 'dev'

    // ECR Repository for Agent Core container
    // Use existing repository if USE_EXISTING_ECR=true
    const useExistingEcr = process.env.USE_EXISTING_ECR === 'true'
    const repository = useExistingEcr
      ? ecr.Repository.fromRepositoryName(
          this,
          'AgentCoreRepository',
          `${projectName}-agent-core`
        )
      : new ecr.Repository(this, 'AgentCoreRepository', {
          repositoryName: `${projectName}-agent-core`,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          imageScanOnPush: true,
          lifecycleRules: [
            {
              description: 'Keep last 10 images',
              maxImageCount: 10,
            },
          ],
        })

    // IAM Execution Role for AgentCore Runtime
    // Service Principal: bedrock-agentcore.amazonaws.com (WITH hyphen!)
    const executionRole = new iam.Role(this, 'AgentCoreExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for AgentCore Runtime',
    })

    // ECR Image Access
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRImageAccess',
        effect: iam.Effect.ALLOW,
        actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
        resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/*`],
      })
    )

    // ECR Token Access
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRTokenAccess',
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    )

    // CloudWatch Logs
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
        ],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
        ],
      })
    )

    // X-Ray Tracing
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
        ],
        resources: ['*'],
      })
    )

    // CloudWatch Metrics
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'bedrock-agentcore',
          },
        },
      })
    )

    // Bedrock Model Access (including Converse API and Inference Profiles)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockModelInvocation',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
        ],
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          `arn:aws:bedrock:${this.region}:${this.account}:*`,
        ],
      })
    )

    // CloudWatch Logs for AgentCore Runtime
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:DescribeLogStreams',
          'logs:CreateLogGroup',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
        ],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
        ],
      })
    )

    // X-Ray Tracing for AgentCore Runtime
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
        ],
        resources: ['*'],
      })
    )

    // CloudWatch Metrics for AgentCore Runtime
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'bedrock-agentcore',
          },
        },
      })
    )

    // Parameter Store permissions for MCP endpoints
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/mcp/*`,
        ],
      })
    )

    // API Gateway invoke permissions for MCP servers
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:Invoke'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/mcp`,
          `arn:aws:execute-api:${this.region}:${this.account}:mcp-*/*/*/*`,
        ],
      })
    )

    // AgentCore Gateway Access (MCP Gateway integration)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GatewayAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeGateway',
          'bedrock-agentcore:GetGateway',
          'bedrock-agentcore:ListGateways',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`,
        ],
      })
    )

    // AgentCore A2A (Agent-to-Agent) Runtime Access
    // Allow all bedrock-agentcore actions for A2A communication
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'A2ARuntimeAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:*',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:*`,
        ],
      })
    )

    // AgentCore Browser Access (System Browser for WebSocket connectivity)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BrowserAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:StartBrowserSession',
          'bedrock-agentcore:StopBrowserSession',
          'bedrock-agentcore:GetBrowserSession',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:aws:browser/aws.browser.v1`,
        ],
      })
    )

    // Import existing VPC (if provided)
    let vpc: ec2.IVpc | undefined
    if (props?.vpcId) {
      vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
        vpcId: props.vpcId,
      })
    }

    // ============================================================
    // Step 1: S3 Bucket for CodeBuild Source
    // ============================================================
    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      bucketName: `${projectName}-agentcore-sources-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
          id: 'DeleteOldSources',
        },
      ],
    })

    // ============================================================
    // Document Storage Bucket (Word, PowerPoint, Excel, PDF)
    // ============================================================
    const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `${projectName}-docs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain user documents on stack deletion
      autoDeleteObjects: false,
      versioned: true, // Enable versioning for document history
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          noncurrentVersionExpiration: cdk.Duration.days(90), // Keep old versions for 90 days
        },
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30), // Move to IA after 30 days
            },
          ],
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ['*'], // TODO: Restrict to frontend domain in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    // Grant Runtime execution role permissions for document bucket
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DocumentBucketAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:GetObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          documentBucket.bucketArn,
          `${documentBucket.bucketArn}/*`,
        ],
      })
    )

    // ============================================================
    // Knowledge Base Infrastructure
    // S3 bucket for KB documents, S3 Vector Bucket, Bedrock KB
    // ============================================================

    // T001: S3 bucket for KB documents (user uploads for RAG)
    const kbDocsBucket = new s3.Bucket(this, 'KBDocsBucket', {
      bucketName: `${projectName}-kb-docs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain user documents on stack deletion
      autoDeleteObjects: false,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ['*'], // TODO: Restrict to frontend domain in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    // Grant Runtime execution role permissions for KB docs bucket
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'KBDocsBucketAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:GetObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          kbDocsBucket.bucketArn,
          `${kbDocsBucket.bucketArn}/*`,
        ],
      })
    )

    // T002: S3 Vector Bucket for KB embeddings (shared across all catalogs)
    // Note: Using CfnResource as S3 Vectors is a newer service
    const kbVectorBucketName = `${projectName}-kb-vectors`
    const kbVectorBucket = new cdk.CfnResource(this, 'KBVectorBucket', {
      type: 'AWS::S3Vectors::VectorBucket',
      properties: {
        VectorBucketName: kbVectorBucketName,
      },
    })

    // T003: S3 Vector Index (float32, 1024 dimensions for Titan embeddings, cosine distance)
    const kbVectorIndexName = `${projectName}-kb-vector-index`
    const kbVectorIndex = new cdk.CfnResource(this, 'KBVectorIndex', {
      type: 'AWS::S3Vectors::Index',
      properties: {
        VectorBucketName: kbVectorBucketName,
        IndexName: kbVectorIndexName,
        DataType: 'float32',
        Dimension: 1024, // Amazon Titan Text Embeddings v2 dimension
        DistanceMetric: 'cosine',
        MetadataConfiguration: {
          // These metadata keys should NOT be used for filtering (internal Bedrock use)
          NonFilterableMetadataKeys: [
            'x-amz-bedrock-kb-source-uri',
            'x-amz-bedrock-kb-chunk-id',
            'x-amz-bedrock-kb-data-source-id',
            'AMAZON_BEDROCK_TEXT',
            'AMAZON_BEDROCK_METADATA',
          ],
        },
      },
    })
    kbVectorIndex.addDependency(kbVectorBucket)

    // T005: IAM role for Bedrock KB service
    const bedrockKBServiceRole = new iam.Role(this, 'BedrockKBServiceRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Service role for Bedrock Knowledge Base to access S3 and embedding models',
    })

    // Grant KB service role access to KB docs bucket
    bedrockKBServiceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3ListAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: [kbDocsBucket.bucketArn],
        conditions: {
          StringEquals: {
            'aws:PrincipalAccount': this.account,
          },
        },
      })
    )

    bedrockKBServiceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3GetAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [`${kbDocsBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            'aws:PrincipalAccount': this.account,
          },
        },
      })
    )

    // Grant KB service role access to S3 Vector Bucket
    bedrockKBServiceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3VectorBucketAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          's3vectors:CreateIndex',
          's3vectors:DeleteIndex',
          's3vectors:GetIndex',
          's3vectors:ListIndexes',
          's3vectors:PutVectors',
          's3vectors:GetVectors',
          's3vectors:DeleteVectors',
          's3vectors:QueryVectors',
          's3vectors:ListVectors',
        ],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}/*`,
        ],
      })
    )

    // Grant KB service role access to Bedrock embedding models
    bedrockKBServiceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockEmbeddingModelAccess',
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    )

    // T004: Bedrock Knowledge Base (single shared KB, data sources created per catalog)
    // Using CfnResource as S3_VECTORS storage type is not yet in CDK types
    const kbName = `${projectName}-knowledge-base`
    const knowledgeBase = new cdk.CfnResource(this, 'KnowledgeBase', {
      type: 'AWS::Bedrock::KnowledgeBase',
      properties: {
        Name: kbName,
        Description: 'Shared Knowledge Base for user document catalogs with RAG capabilities',
        RoleArn: bedrockKBServiceRole.roleArn,
        KnowledgeBaseConfiguration: {
          Type: 'VECTOR',
          VectorKnowledgeBaseConfiguration: {
            EmbeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
            EmbeddingModelConfiguration: {
              BedrockEmbeddingModelConfiguration: {
                Dimensions: 1024,
                EmbeddingDataType: 'FLOAT32',
              },
            },
          },
        },
        StorageConfiguration: {
          Type: 'S3_VECTORS',
          S3VectorsConfiguration: {
            VectorBucketArn: `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}`,
            IndexArn: `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}/index/${kbVectorIndexName}`,
          },
        },
        Tags: {
          Environment: environment,
          Application: projectName
        },
      },
    })
    knowledgeBase.addDependency(kbVectorIndex)
    knowledgeBase.node.addDependency(bedrockKBServiceRole)

    // T006: IAM permissions for application to use Knowledge Base
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockKBQueryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:Retrieve',
          'bedrock:RetrieveAndGenerate',
        ],
        resources: [knowledgeBase.getAtt('KnowledgeBaseArn').toString()],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockKBDataSourceManagement',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:CreateDataSource',
          'bedrock:DeleteDataSource',
          'bedrock:GetDataSource',
          'bedrock:ListDataSources',
          'bedrock:UpdateDataSource',
          'bedrock:StartIngestionJob',
          'bedrock:GetIngestionJob',
          'bedrock:ListIngestionJobs',
        ],
        resources: [
          knowledgeBase.getAtt('KnowledgeBaseArn').toString(),
          `${knowledgeBase.getAtt('KnowledgeBaseArn').toString()}/*`,
        ],
      })
    )

    // Grant application access to S3 Vectors for query operations
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3VectorsQueryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          's3vectors:GetVectors',
          's3vectors:QueryVectors',
          's3vectors:ListVectors',
        ],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}/*`,
        ],
      })
    )

    // Store KB configuration in Parameter Store
    new ssm.StringParameter(this, 'KBIdParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/kb-id`,
      stringValue: knowledgeBase.getAtt('KnowledgeBaseId').toString(),
      description: 'Bedrock Knowledge Base ID for RAG queries',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'KBDocsBucketParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/kb-docs-bucket`,
      stringValue: kbDocsBucket.bucketName,
      description: 'S3 bucket for Knowledge Base documents',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // KB Catalog DynamoDB Table (Data Model Refactor)
    // Dedicated table for catalog and document metadata
    // ============================================================

    // T001-T003: Create DynamoDB table for KB Catalogs with new key schema
    // PK: catalog_id, SK: METADATA (for catalog) or DOC#{document_id} (for documents)
    const kbCatalogTable = new dynamodb.Table(this, 'KBCatalogTable', {
      tableName: `${projectName}-kb-catalog`,
      partitionKey: { name: 'catalog_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    })

    // T002: Add GSI for user_id lookups (list all catalogs for a user)
    kbCatalogTable.addGlobalSecondaryIndex({
      indexName: 'user_id-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    })

    // T004: Grant execution role permissions for KB Catalog table
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'KBCatalogTableAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:DescribeTable',
        ],
        resources: [
          kbCatalogTable.tableArn,
          `${kbCatalogTable.tableArn}/index/*`,
        ],
      })
    )

    // Store KB Catalog table name in Parameter Store
    new ssm.StringParameter(this, 'KBCatalogTableParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/kb-catalog-table`,
      stringValue: kbCatalogTable.tableName,
      description: 'DynamoDB table for KB Catalog metadata',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Step 2: CodeBuild Project for Building Container
    // ============================================================
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Build role for Agent Core container image pipeline',
    })

    // ECR Token Access
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    )

    // ECR Image Operations
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        resources: [
          `arn:aws:ecr:${this.region}:${this.account}:repository/${repository.repositoryName}`,
        ],
      })
    )

    // CloudWatch Logs
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${projectName}-*`,
        ],
      })
    )

    // S3 Access
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            's3:ResourceAccount': this.account,
          },
        },
      })
    )

    const buildProject = new codebuild.Project(this, 'AgentBuildProject', {
      projectName: `${projectName}-agent-builder`,
      description: 'Builds ARM64 container image for AgentCore runtime',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true, // Required for Docker builds
      },
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'agent-source/',
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              'echo Building Docker image for ARM64...',
              'docker build --platform linux/arm64 -t agent:latest .',
              `docker tag agent:latest ${repository.repositoryUri}:latest`,
            ],
          },
          post_build: {
            commands: [
              'echo Pushing Docker image to ECR...',
              `docker push ${repository.repositoryUri}:latest`,
              'echo Build completed successfully',
            ],
          },
        },
      }),
    })

    // ============================================================
    // Step 3: Upload Agent Source to S3
    // ============================================================
    const agentSourcePath = '../../chatbot-app/agentcore'
    const agentSourceUpload = new s3deploy.BucketDeployment(this, 'AgentSourceUpload', {
      sources: [
        s3deploy.Source.asset(agentSourcePath, {
          exclude: [
            'venv/**',
            '.venv/**',
            '__pycache__/**',
            '*.pyc',
            '.git/**',
            'node_modules/**',
            '.DS_Store',
            '*.log',
            'build/**',
            'dist/**',
            'sessions/**',
            'output/**',
            'uploads/**',
            'generated_images/**',
          ],
        }),
      ],
      destinationBucket: sourceBucket,
      destinationKeyPrefix: 'agent-source/',
      prune: false,
      retainOnDelete: false,
    })

    // ============================================================
    // Step 4: Trigger CodeBuild
    // ============================================================
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerCodeBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`build-${Date.now()}`),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`build-${Date.now()}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
          resources: [buildProject.projectArn],
        }),
      ]),
      timeout: cdk.Duration.minutes(5),
    })

    buildTrigger.node.addDependency(agentSourceUpload)

    // ============================================================
    // Step 5: Wait for Build to Complete
    // ============================================================
    const buildWaiterFunction = new lambda.Function(this, 'BuildWaiterFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { CodeBuildClient, BatchGetBuildsCommand } = require('@aws-sdk/client-codebuild');

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', { Status: 'DELETED' });
  }

  const buildId = event.ResourceProperties.BuildId;
  const maxWaitMinutes = 14;
  const pollIntervalSeconds = 30;

  console.log('Waiting for build:', buildId);

  const client = new CodeBuildClient({});
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await client.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = response.builds[0];
      const status = build.buildStatus;

      console.log(\`Build status: \${status}\`);

      if (status === 'SUCCEEDED') {
        return await sendResponse(event, 'SUCCESS', { Status: 'SUCCEEDED' });
      } else if (['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED'].includes(status)) {
        return await sendResponse(event, 'FAILED', {}, \`Build failed with status: \${status}\`);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));

    } catch (error) {
      console.error('Error:', error);
      return await sendResponse(event, 'FAILED', {}, error.message);
    }
  }

  return await sendResponse(event, 'FAILED', {}, \`Build timeout after \${maxWaitMinutes} minutes\`);
};

async function sendResponse(event, status, data, reason) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: reason || \`See CloudWatch Log Stream: \${event.LogStreamName}\`,
    PhysicalResourceId: event.PhysicalResourceId || event.RequestId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  });

  console.log('Response:', responseBody);

  const https = require('https');
  const url = require('url');
  const parsedUrl = url.parse(event.ResponseURL);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length
      }
    };

    const request = https.request(options, (response) => {
      console.log(\`Status: \${response.statusCode}\`);
      resolve(data);
    });

    request.on('error', (error) => {
      console.error('Error:', error);
      reject(error);
    });

    request.write(responseBody);
    request.end();
  });
}
      `),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
    })

    buildWaiterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['codebuild:BatchGetBuilds'],
        resources: [buildProject.projectArn],
      })
    )

    const buildWaiter = new cdk.CustomResource(this, 'BuildWaiter', {
      serviceToken: buildWaiterFunction.functionArn,
      properties: {
        BuildId: buildTrigger.getResponseField('build.id'),
      },
    })

    buildWaiter.node.addDependency(buildTrigger)

    // ============================================================
    // Step 6: Create AgentCore Memory (Long-term user preference storage)
    // ============================================================
    // Create IAM role for Memory execution
    const memoryExecutionRole = new iam.Role(this, 'MemoryExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for AgentCore Memory to access Bedrock models',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy'
        ),
      ],
    })

    // ============================================================
    // Step 6: Create Code Interpreter Custom (Shared Resource)
    // ============================================================
    // Code Interpreter is a shared resource used by:
    // - Main AgentCore Runtime (bedrock_code_interpreter_tool)
    // - Report Writer A2A Agent (chart generation)
    // - Future agents (document-writer, etc.)
    const codeInterpreterName = projectName.replace(/-/g, '_') + '_code_interpreter'
    const codeInterpreter = new agentcore.CfnCodeInterpreterCustom(
      this,
      'CodeInterpreterCustom',
      {
        name: codeInterpreterName,
        networkConfiguration: {
          networkMode: 'SANDBOX', // Isolated sandbox environment without internet access
        },
        description: 'Shared Code Interpreter for all agents',
      }
    )

    // Grant Runtime execution role permissions to use Code Interpreter
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CodeInterpreterAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateCodeInterpreter',
          'bedrock-agentcore:StartCodeInterpreterSession',
          'bedrock-agentcore:InvokeCodeInterpreter',
          'bedrock-agentcore:StopCodeInterpreterSession',
          'bedrock-agentcore:DeleteCodeInterpreter',
          'bedrock-agentcore:ListCodeInterpreters',
          'bedrock-agentcore:GetCodeInterpreter',
          'bedrock-agentcore:GetCodeInterpreterSession',
          'bedrock-agentcore:ListCodeInterpreterSessions',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:*:aws:code-interpreter/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:code-interpreter/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:code-interpreter-custom/*`,
        ],
      })
    )

    // Store Code Interpreter ID in Parameter Store for other agents
    new ssm.StringParameter(this, 'CodeInterpreterIdParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/code-interpreter-id`,
      stringValue: codeInterpreter.attrCodeInterpreterId,
      description: 'Shared Code Interpreter ID for all agents',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Browser Custom: Create AgentCore Browser for web automation
    // ============================================================
    // Create Browser Custom with Public Network (no recording for cost optimization)
    // Add timestamp suffix to avoid naming conflicts
    const browserCustomName = projectName.replace(/-/g, '_') + '_browser_v2'
    const browser = new agentcore.CfnBrowserCustom(
      this,
      'BrowserCustom',
      {
        name: browserCustomName,
        networkConfiguration: {
          networkMode: 'PUBLIC', // Internet access for web browsing
        },
        description: 'AgentCore Browser for web automation with Nova Act',
        executionRoleArn: executionRole.roleArn, // Required when browserSigning is enabled
        browserSigning: {
          enabled: true, // Enable Web Bot Auth to reduce CAPTCHA challenges
        },
      }
    )

    // Grant Runtime execution role permissions to use Browser
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CustomBrowserAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateBrowser',
          'bedrock-agentcore:StartBrowserSession',
          'bedrock-agentcore:GetBrowserSession',
          'bedrock-agentcore:UpdateBrowserSession',
          'bedrock-agentcore:UpdateBrowserStream',
          'bedrock-agentcore:StopBrowserSession',
          'bedrock-agentcore:DeleteBrowser',
          'bedrock-agentcore:ListBrowsers',
          'bedrock-agentcore:GetBrowser',
          'bedrock-agentcore:ListBrowserSessions',
          'bedrock-agentcore:ConnectBrowserAutomationStream', // WebSocket automation stream (NovaAct)
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:browser/*`,        // System browser
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:browser-custom/*`, // Custom browser
        ],
      })
    )

    // Store Browser ID in Parameter Store
    new ssm.StringParameter(this, 'BrowserIdParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/browser-id`,
      stringValue: browser.attrBrowserId,
      description: 'AgentCore Browser ID for web automation',
      tier: ssm.ParameterTier.STANDARD,
    })

    // Create Memory with short-term and long-term strategies using L1 construct (CfnMemory)
    const memoryName = projectName.replace(/-/g, '_') + '_memory'
    const memory = new agentcore.CfnMemory(this, 'AgentCoreMemory', {
      name: memoryName,
      description: 'Long-term memory for user preferences, conversation context, and semantic facts',
      memoryExecutionRoleArn: memoryExecutionRole.roleArn,
      eventExpiryDuration: 90, // Short-term memory retention in days (7-365 days)
      memoryStrategies: [
        // User Preference Extraction: Captures user preferences like coding style, language preference, etc.
        {
          userPreferenceMemoryStrategy: {
            name: 'user_preference_extraction',
            description: 'Extracts and stores user preferences from conversations',
          },
        },
        // Semantic Fact Extraction: Captures semantic facts and learned information
        {
          semanticMemoryStrategy: {
            name: 'semantic_fact_extraction',
            description: 'Extracts semantic facts and learned information from conversations',
          },
        },
        // Conversation Summary: Creates summaries of conversations for context optimization
        {
          summaryMemoryStrategy: {
            name: 'conversation_summary',
            description: 'Creates summaries of conversations for efficient context recall',
          },
        },
      ],
    })

    // Grant Runtime execution role permissions to use Memory
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AgentCoreMemoryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:DeleteEvent',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:GetMemoryRecord',
          'bedrock-agentcore:RetrieveMemoryRecords',
          'bedrock-agentcore:ListMemoryRecords',
          'bedrock-agentcore:DeleteMemoryRecord',
          'bedrock-agentcore:ListActors',
          'bedrock-agentcore:ListSessions',
        ],
        resources: [memory.attrMemoryArn],
      })
    )

    // Store the memory reference
    this.memory = memory
    this.memoryArn = memory.attrMemoryArn

    // Store memory configuration in Parameter Store for Runtime
    new ssm.StringParameter(this, 'MemoryArnParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/memory-arn`,
      stringValue: memory.attrMemoryArn,
      description: 'AgentCore Memory ARN for user preference storage',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'MemoryIdParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/memory-id`,
      stringValue: memory.attrMemoryId,
      description: 'AgentCore Memory ID for user preference storage',
      tier: ssm.ParameterTier.STANDARD,
    })

    // Secrets Manager permissions for Nova Act API key (browser automation)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${projectName}/nova-act-api-key-*`,
        ],
      })
    )

    // DynamoDB permissions for Tool Registry, Session metadata, and Stop Signal
    // Using {projectName}-users-v2 table pattern (no additional env vars needed)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DynamoDBToolRegistryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',  // Required for clearing stop signal
          'dynamodb:PutItem',
          'dynamodb:DeleteItem',
          'dynamodb:BatchGet*',
          'dynamodb:DescribeTable',
          'dynamodb:Scan',
          'dynamodb:BatchWrite*',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-users-v2`,
        ],
      })
    )

    // ============================================================
    // Step 7: Create AgentCore Runtime (after build completes)
    // ============================================================
    // Create AgentCore Runtime using L1 construct (CfnRuntime)
    // Note: Runtime name can only contain alphanumeric characters and underscores
    const runtimeName = projectName.replace(/-/g, '_') + '_runtime'
    const runtime = new agentcore.CfnRuntime(this, 'AgentCoreRuntime', {
      agentRuntimeName: runtimeName,
      description: 'Strands Agent Chatbot Runtime with MCP tool support',
      roleArn: executionRole.roleArn,

      // Container configuration
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${repository.repositoryUri}:latest`,
        },
      },

      // Network configuration - PUBLIC for internet access
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },

      // Protocol configuration - HTTP
      protocolConfiguration: 'HTTP',

      // Environment variables
      environmentVariables: {
        LOG_LEVEL: 'INFO',
        AWS_REGION: this.region,
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        MEMORY_ARN: memory.attrMemoryArn,
        MEMORY_ID: memory.attrMemoryId,
        BROWSER_ID: browser.attrBrowserId,
        BROWSER_NAME: browserCustomName,
        CODE_INTERPRETER_ID: codeInterpreter.attrCodeInterpreterId,
        DOCUMENT_BUCKET: documentBucket.bucketName,
        // T007: Knowledge Base environment variables
        KB_ID: knowledgeBase.getAtt('KnowledgeBaseId').toString(),
        KB_DOCS_BUCKET: kbDocsBucket.bucketName,
        // T005: KB Catalog table environment variable
        KB_CATALOG_TABLE: kbCatalogTable.tableName,
        // OpenTelemetry observability configuration
        AGENT_OBSERVABILITY_ENABLED: 'true',
        OTEL_PYTHON_DISTRO: 'aws_distro',
        OTEL_PYTHON_CONFIGURATOR: 'aws_configurator',
        OTEL_LOGS_EXPORTER: 'none',
      },

      tags: {
        Environment: environment,
        Application: projectName,
      },
    })

    // Ensure Runtime is created after build completes, role is ready, memory and KB are created
    runtime.node.addDependency(executionRole)
    runtime.node.addDependency(buildWaiter)
    runtime.node.addDependency(memory)
    runtime.node.addDependency(knowledgeBase)

    // Store the runtime reference
    this.runtime = runtime
    this.runtimeArn = runtime.attrAgentRuntimeArn

    // Store runtime configuration in Parameter Store for BFF
    new ssm.StringParameter(this, 'RuntimeArnParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/runtime-arn`,
      stringValue: runtime.attrAgentRuntimeArn,
      description: 'AgentCore Runtime ARN for Strands Agent',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'RuntimeIdParameter', {
      parameterName: `/${projectName}/${environment}/agentcore/runtime-id`,
      stringValue: runtime.attrAgentRuntimeId,
      description: 'AgentCore Runtime ID for Strands Agent',
      tier: ssm.ParameterTier.STANDARD,
    })

    // Outputs
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI for Agent Core container',
      exportName: `${projectName}-agent-core-repo-uri`,
    })

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: runtime.attrAgentRuntimeArn,
      description: 'AgentCore Runtime ARN',
      exportName: `${projectName}-agent-core-runtime-arn`,
    })

    new cdk.CfnOutput(this, 'AgentRuntimeId', {
      value: runtime.attrAgentRuntimeId,
      description: 'AgentCore Runtime ID',
      exportName: `${projectName}-agent-core-runtime-id`,
    })

    new cdk.CfnOutput(this, 'ExecutionRoleArn', {
      value: executionRole.roleArn,
      description: 'IAM Execution Role ARN for AgentCore Runtime',
      exportName: `${projectName}-agent-core-execution-role-arn`,
    })

    new cdk.CfnOutput(this, 'ParameterStorePrefix', {
      value: `/${projectName}/${environment}/agentcore`,
      description: 'Parameter Store prefix for AgentCore Runtime configuration',
    })

    new cdk.CfnOutput(this, 'MemoryArn', {
      value: memory.attrMemoryArn,
      description: 'AgentCore Memory ARN for user preference storage',
      exportName: `${projectName}-agent-core-memory-arn`,
    })

    new cdk.CfnOutput(this, 'MemoryId', {
      value: memory.attrMemoryId,
      description: 'AgentCore Memory ID for user preference storage',
      exportName: `${projectName}-agent-core-memory-id`,
    })

    new cdk.CfnOutput(this, 'MemoryName', {
      value: memory.name,
      description: 'AgentCore Memory Name',
    })

    new cdk.CfnOutput(this, 'CodeInterpreterId', {
      value: codeInterpreter.attrCodeInterpreterId,
      description: 'Shared Code Interpreter ID for all agents',
      exportName: `${projectName}-code-interpreter-id`,
    })

    new cdk.CfnOutput(this, 'CodeInterpreterArn', {
      value: codeInterpreter.attrCodeInterpreterArn,
      description: 'Shared Code Interpreter ARN',
      exportName: `${projectName}-code-interpreter-arn`,
    })

    new cdk.CfnOutput(this, 'DocumentBucketName', {
      value: documentBucket.bucketName,
      description: 'S3 bucket for document storage (Word, PowerPoint, Excel, PDF)',
      exportName: `${projectName}-document-bucket`,
    })

    new cdk.CfnOutput(this, 'DocumentBucketArn', {
      value: documentBucket.bucketArn,
      description: 'S3 bucket ARN for document storage',
      exportName: `${projectName}-document-bucket-arn`,
    })

    // Knowledge Base Outputs
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.getAtt('KnowledgeBaseId').toString(),
      description: 'Bedrock Knowledge Base ID for RAG queries',
      exportName: `${projectName}-kb-id`,
    })

    new cdk.CfnOutput(this, 'KnowledgeBaseArn', {
      value: knowledgeBase.getAtt('KnowledgeBaseArn').toString(),
      description: 'Bedrock Knowledge Base ARN',
      exportName: `${projectName}-kb-arn`,
    })

    new cdk.CfnOutput(this, 'KBDocsBucketName', {
      value: kbDocsBucket.bucketName,
      description: 'S3 bucket for Knowledge Base documents',
      exportName: `${projectName}-kb-docs-bucket`,
    })

    new cdk.CfnOutput(this, 'KBVectorBucketName', {
      value: kbVectorBucketName,
      description: 'S3 Vector Bucket for Knowledge Base embeddings',
      exportName: `${projectName}-kb-vector-bucket`,
    })

    // KB Catalog Table Output
    new cdk.CfnOutput(this, 'KBCatalogTableName', {
      value: kbCatalogTable.tableName,
      description: 'DynamoDB table for KB Catalog metadata',
      exportName: `${projectName}-kb-catalog-table`,
    })

    new cdk.CfnOutput(this, 'KBCatalogTableArn', {
      value: kbCatalogTable.tableArn,
      description: 'DynamoDB table ARN for KB Catalog metadata',
      exportName: `${projectName}-kb-catalog-table-arn`,
    })
  }
}
