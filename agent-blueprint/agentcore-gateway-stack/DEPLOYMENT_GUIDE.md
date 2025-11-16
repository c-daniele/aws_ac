# AgentCore Gateway - Deployment Guide

Complete step-by-step guide for deploying the AgentCore Gateway Stack.

## 📋 Prerequisites

### Required Software

```bash
# Check versions
node --version    # Should be 18+
npm --version     # Should be 9+
python --version  # Should be 3.13+
aws --version     # AWS CLI v2

# Check AWS credentials
aws sts get-caller-identity
```

### Required AWS Permissions

Your AWS user/role needs:
- Lambda: Create, update, invoke functions
- IAM: Create roles and policies
- Bedrock AgentCore: Create gateway, targets
- Secrets Manager: Create, read secrets
- CloudWatch: Create log groups
- SSM Parameter Store: Create parameters

## 🚀 Step-by-Step Deployment

### Step 1: Navigate to Project

```bash
cd /Users/kevmyung/Downloads/agent-app-testing/sample-strands-agent-chatbot/agent-blueprint/agentcore-gateway-stack
```

### Step 2: Set Environment Variables (Optional)

```bash
export PROJECT_NAME="strands-agent-chatbot"  # Default
export ENVIRONMENT="dev"                      # dev or prod
export AWS_REGION="us-west-2"                # Your region
```

### Step 3: Deploy Stack

```bash
# One-command deployment
./scripts/deploy.sh
```

This will:
1. ✅ Build 5 Lambda function packages
2. ✅ Install CDK dependencies
3. ✅ Build TypeScript code
4. ✅ Synthesize CloudFormation templates
5. ✅ Deploy 4 CDK stacks:
   - GatewayIamStack (IAM roles, secrets)
   - GatewayStack (AgentCore Gateway)
   - GatewayLambdaStack (5 Lambda functions)
   - GatewayTargetStack (12 Gateway targets)

**Expected Duration**: 5-8 minutes

### Step 4: Configure API Keys

After deployment completes, set required API keys:

#### Tavily API Key

```bash
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/tavily-api-key \
  --secret-string "YOUR_TAVILY_API_KEY" \
  --region us-west-2
```

Get your Tavily API key from: https://tavily.com/

#### Google Custom Search Credentials

```bash
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/google-credentials \
  --secret-string '{"api_key":"YOUR_API_KEY","search_engine_id":"YOUR_ENGINE_ID"}' \
  --region us-west-2
```

Setup Google Custom Search:
1. Go to: https://console.cloud.google.com/apis/credentials
2. Create API key with Custom Search API enabled
3. Create Custom Search Engine: https://programmablesearchengine.google.com/

### Step 5: Test Deployment

```bash
./scripts/test-gateway.sh
```

Expected output:
```
🧪 Testing AgentCore Gateway...

📡 Retrieving Gateway information...
   Gateway URL: https://xxxxxx.execute-api.us-west-2.amazonaws.com
   Gateway ID:  gateway-xxxxxxxx

🔍 Checking Gateway status...
   Status: AVAILABLE
   ✅ Gateway is available

🎯 Listing Gateway Targets...
   Total targets: 12

   Available tools:
   - tavily-search (AVAILABLE)
   - tavily-extract (AVAILABLE)
   - wikipedia-search (AVAILABLE)
   - wikipedia-get-article (AVAILABLE)
   - arxiv-search (AVAILABLE)
   - arxiv-get-paper (AVAILABLE)
   - google-web-search (AVAILABLE)
   - google-image-search (AVAILABLE)
   - stock-quote (AVAILABLE)
   - stock-history (AVAILABLE)
   - financial-news (AVAILABLE)
   - stock-analysis (AVAILABLE)

⚡ Checking Lambda functions...
   ✅ mcp-tavily: Active
   ✅ mcp-wikipedia: Active
   ✅ mcp-arxiv: Active
   ✅ mcp-google-search: Active
   ✅ mcp-finance: Active

🔑 Checking API key configuration...
   ✅ Tavily API Key configured
   ✅ Google Credentials configured
```

## 🔌 Integration with AgentCore Runtime

### Option 1: Update Runtime Stack

Edit `agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts`:

```typescript
// Add Gateway URL to environment variables
const runtime = new agentcore.CfnRuntime(this, 'AgentCoreRuntime', {
  // ... existing config ...

  environmentVariables: {
    LOG_LEVEL: 'INFO',
    PROJECT_NAME: projectName,
    ENVIRONMENT: environment,
    MEMORY_ARN: memory.attrMemoryArn,
    MEMORY_ID: memory.attrMemoryId,

    // 🆕 Add Gateway URL
    GATEWAY_URL: ssm.StringParameter.valueForStringParameter(
      this,
      `/${projectName}/${environment}/mcp/gateway-url`
    ),
  },
})

// 🆕 Add Gateway invoke permissions
executionRole.addToPolicy(
  new iam.PolicyStatement({
    sid: 'AgentCoreGatewayInvoke',
    effect: iam.Effect.ALLOW,
    actions: ['bedrock-agentcore:InvokeGateway'],
    resources: [
      `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`,
    ],
  })
)
```

Redeploy Runtime:
```bash
cd ../agentcore-runtime-stack/infrastructure
cdk deploy
```

### Option 2: Manual Environment Update

Get Gateway URL:
```bash
GATEWAY_URL=$(aws ssm get-parameter \
  --name "/strands-agent-chatbot/dev/mcp/gateway-url" \
  --query 'Parameter.Value' \
  --output text \
  --region us-west-2)

echo $GATEWAY_URL
```

Update Runtime manually through AWS Console or CLI.

## 🧪 Testing Tools

### Test Tavily Search

```bash
aws lambda invoke \
  --function-name mcp-tavily \
  --payload '{"query":"AWS Lambda best practices","search_depth":"basic","topic":"general"}' \
  --region us-west-2 \
  response.json

cat response.json | jq
```

### Test Wikipedia Search

```bash
aws lambda invoke \
  --function-name mcp-wikipedia \
  --payload '{"query":"Amazon Web Services"}' \
  --region us-west-2 \
  response.json

cat response.json | jq
```

### Test Stock Quote

```bash
aws lambda invoke \
  --function-name mcp-finance \
  --payload '{"symbol":"AAPL"}' \
  --region us-west-2 \
  response.json

cat response.json | jq
```

## 📊 Monitoring

### View Lambda Logs

```bash
# Tavily logs
aws logs tail /aws/lambda/mcp-tavily --follow

# Finance logs
aws logs tail /aws/lambda/mcp-finance --follow
```

### View Gateway Metrics

```bash
# Gateway status
aws bedrock-agentcore get-gateway \
  --gateway-identifier <GATEWAY_ID> \
  --region us-west-2

# List targets
aws bedrock-agentcore list-gateway-targets \
  --gateway-identifier <GATEWAY_ID> \
  --region us-west-2
```

### CloudWatch Dashboard

Go to: https://console.aws.amazon.com/cloudwatch/

Filter by:
- `/aws/lambda/mcp-*` for Lambda logs
- `/aws/bedrock-agentcore/gateways/*` for Gateway logs

## 🔧 Troubleshooting

### Issue: Lambda build fails

**Error**: `pip install failed`

**Solution**:
```bash
# Make sure you have Python 3.13+
python --version

# Install pip if missing
python -m ensurepip --upgrade

# Try manual build
cd lambda-functions/tavily
pip install -r requirements.txt -t build/ --platform manylinux2014_aarch64
```

### Issue: CDK deploy fails with "IAM role not found"

**Error**: `Role not found: arn:aws:iam::...`

**Solution**:
```bash
# Deploy IAM stack first
cd infrastructure
npx cdk deploy strands-agent-chatbot-GatewayIamStack
```

### Issue: Gateway status is "FAILED"

**Error**: Gateway shows FAILED status

**Solution**:
```bash
# Check Gateway details
aws bedrock-agentcore get-gateway \
  --gateway-identifier <GATEWAY_ID> \
  --query 'gateway.statusReasons' \
  --region us-west-2

# Common causes:
# 1. IAM role lacks permissions
# 2. Lambda function not accessible
# 3. Invalid protocol configuration
```

### Issue: API key error in Lambda

**Error**: `Failed to get API key from Secrets Manager`

**Solution**:
```bash
# Verify secret exists
aws secretsmanager describe-secret \
  --secret-id strands-agent-chatbot/mcp/tavily-api-key \
  --region us-west-2

# Check Lambda role has GetSecretValue permission
aws iam get-role-policy \
  --role-name strands-agent-chatbot-gateway-lambda-role \
  --policy-name SecretsManagerAccess \
  --region us-west-2
```

### Issue: Gateway URL not found in Parameter Store

**Error**: `Parameter not found`

**Solution**:
```bash
# List all parameters
aws ssm describe-parameters \
  --filters "Key=Name,Values=/strands-agent-chatbot/" \
  --region us-west-2

# If missing, Gateway stack didn't complete successfully
# Redeploy Gateway stack
cd infrastructure
npx cdk deploy strands-agent-chatbot-GatewayStack
```

## 🗑️ Cleanup

To remove all resources:

```bash
./scripts/destroy.sh
```

This will prompt for confirmation, then delete:
- 12 Gateway Targets
- 5 Lambda functions
- AgentCore Gateway
- IAM roles and policies
- Secrets Manager secrets
- CloudWatch log groups
- SSM parameters

**Note**: This is irreversible! Make sure you want to delete everything.

## 📈 Next Steps

1. **Integrate with Runtime**: Follow integration steps above
2. **Test in Application**: Use tools in your agent conversations
3. **Monitor Usage**: Check CloudWatch metrics and logs
4. **Optimize**: Adjust Lambda memory/timeout based on usage
5. **Add More Tools**: Extend with additional Lambda functions

## 🔗 Resources

- [AgentCore Gateway Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore-gateway.html)
- [Lambda Python Runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html)
- [MCP Protocol Spec](https://modelcontextprotocol.io/)
- [Project README](./README.md)

## 🆘 Support

For issues:
1. Check [Troubleshooting](#troubleshooting) section
2. Review CloudWatch logs
3. Verify AWS credentials and permissions
4. Check main project documentation

---

**Deployment Complete!** 🎉

You now have a fully functional AgentCore Gateway with 12 research tools ready to use!
