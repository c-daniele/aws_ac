#!/bin/bash
# Report Writer A2A Agent - Deployment Script
# Deploys Report Writer as AgentCore Runtime A2A Agent

set -e

echo "=========================================="
echo "Report Writer A2A Agent Deployment"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get AWS account and region
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-west-2}

echo -e "${BLUE}AWS Account:${NC} $AWS_ACCOUNT"
echo -e "${BLUE}AWS Region:${NC} $AWS_REGION"
echo ""

# Repository name
REPO_NAME="report-writer-a2a-repository"
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"

echo -e "${YELLOW}Step 1: Creating ECR Repository${NC}"
echo "Repository: $REPO_NAME"

# Create ECR repository if it doesn't exist
if aws ecr describe-repositories --repository-names $REPO_NAME --region $AWS_REGION > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} ECR repository already exists"
else
    echo "Creating ECR repository..."
    aws ecr create-repository \
        --repository-name $REPO_NAME \
        --region $AWS_REGION \
        --image-scanning-configuration scanOnPush=true \
        > /dev/null
    echo -e "${GREEN}✓${NC} ECR repository created"
fi
echo ""

echo -e "${YELLOW}Step 2: Building Docker Image${NC}"
cd src

# Build Docker image
echo "Building Docker image..."
docker build --platform linux/amd64 -t $REPO_NAME:latest -f Dockerfile .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Docker image built successfully"
else
    echo -e "${RED}✗${NC} Docker build failed"
    exit 1
fi
echo ""

echo -e "${YELLOW}Step 3: Pushing to ECR${NC}"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Tag and push image
echo "Tagging image..."
docker tag $REPO_NAME:latest $ECR_URI:latest

echo "Pushing to ECR..."
docker push $ECR_URI:latest

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Image pushed to ECR: $ECR_URI:latest"
else
    echo -e "${RED}✗${NC} Failed to push image to ECR"
    exit 1
fi
echo ""

cd ..

echo -e "${YELLOW}Step 4: Deploying CDK Stack${NC}"
cd cdk

# Install CDK dependencies if needed
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
fi

source .venv/bin/activate

# Install/upgrade dependencies
echo "Installing CDK dependencies..."
pip install -q -r requirements.txt

# Bootstrap CDK if needed
echo "Checking CDK bootstrap..."
cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION > /dev/null 2>&1 || true

# Deploy CDK stack
echo "Deploying CDK stack..."
cdk deploy --require-approval never

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} CDK stack deployed successfully"
else
    echo -e "${RED}✗${NC} CDK deployment failed"
    exit 1
fi
echo ""

# Get outputs
echo -e "${YELLOW}Step 5: Retrieving Deployment Information${NC}"

RUNTIME_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name ReportWriterAgentCoreStack \
    --region $AWS_REGION \
    --query "Stacks[0].Outputs[?OutputKey=='RuntimeEndpoint'].OutputValue" \
    --output text)

SSM_PARAM=$(aws cloudformation describe-stacks \
    --stack-name ReportWriterAgentCoreStack \
    --region $AWS_REGION \
    --query "Stacks[0].Outputs[?OutputKey=='SsmParameterName'].OutputValue" \
    --output text)

BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name ReportWriterAgentCoreStack \
    --region $AWS_REGION \
    --query "Stacks[0].Outputs[?OutputKey=='ReportBucketName'].OutputValue" \
    --output text)

echo ""
echo "=========================================="
echo -e "${GREEN}Deployment Complete!${NC}"
echo "=========================================="
echo ""
echo -e "${BLUE}Runtime Endpoint ARN:${NC}"
echo "  $RUNTIME_ENDPOINT"
echo ""
echo -e "${BLUE}SSM Parameter:${NC}"
echo "  $SSM_PARAM"
echo ""
echo -e "${BLUE}Report Storage Bucket:${NC}"
echo "  $BUCKET_NAME"
echo ""
echo -e "${BLUE}ECR Image URI:${NC}"
echo "  $ECR_URI:latest"
echo ""
echo "=========================================="
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. The A2A agent is now deployed and ready to use"
echo "2. Endpoint ARN stored in SSM: $SSM_PARAM"
echo "3. Access via A2A protocol with SigV4 (IAM) authentication"
echo "4. Agent Card available at: /.well-known/agent-card.json"
echo "=========================================="
echo ""

deactivate
cd ..
