#!/bin/bash
set -e

# Fast Deploy Script for AgentCore Runtime
# Uploads source code to S3 and triggers CodeBuild without CDK deployment

PROJECT_NAME="${PROJECT_NAME:-advanced-chatbot}"
AWS_REGION="${AWS_REGION:-us-west-2}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}✓${NC} $1"; }
log_step() { echo -e "${BLUE}▶${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "========================================"
echo "  AgentCore Runtime - Fast Deploy"
echo "========================================"
echo ""

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# S3 bucket name (from CDK stack pattern)
SOURCE_BUCKET="${PROJECT_NAME}-agentcore-sources-${ACCOUNT_ID}-${AWS_REGION}"

# ECR repository URI
REPO_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${PROJECT_NAME}-agent-core"

# CodeBuild project name (from CDK stack pattern)
BUILD_PROJECT="${PROJECT_NAME}-agent-builder"

log_info "Fast deploying AgentCore Runtime..."
log_info "Region: $AWS_REGION"
log_info "Account: $ACCOUNT_ID"
echo ""


# Upload source code to S3
log_step "Uploading source code to S3..."
aws s3 sync ../chatbot-app/agentcore \
    "s3://${SOURCE_BUCKET}/agent-source/" \
    --exclude "venv/**" \
    --exclude ".venv/**" \
    --exclude "__pycache__/**" \
    --exclude "*.pyc" \
    --exclude ".git/**" \
    --exclude "node_modules/**" \
    --exclude ".DS_Store" \
    --exclude "*.log" \
    --exclude "cdk/**" \
    --exclude "cdk.out/**" \
    --region $AWS_REGION \
    --quiet

log_info "Source code uploaded to S3"
echo ""

# Trigger CodeBuild
log_step "Triggering CodeBuild..."
BUILD_ID=$(aws codebuild start-build \
    --project-name "$BUILD_PROJECT" \
    --region $AWS_REGION \
    --query 'build.id' \
    --output text)

log_info "Build started: $BUILD_ID"
echo ""

# Monitor build progress
log_step "Monitoring build progress..."
echo ""

while true; do
    BUILD_STATUS=$(aws codebuild batch-get-builds \
        --ids "$BUILD_ID" \
        --region $AWS_REGION \
        --query 'builds[0].buildStatus' \
        --output text)

    case $BUILD_STATUS in
        "IN_PROGRESS")
            echo -n "."
            sleep 10
            ;;
        "SUCCEEDED")
            echo ""
            log_info "Build completed successfully!"
            break
            ;;
        "FAILED"|"FAULT"|"TIMED_OUT"|"STOPPED")
            echo ""
            log_warn "Build failed with status: $BUILD_STATUS"
            
            # Get build logs URL
            LOG_GROUP=$(aws codebuild batch-get-builds \
                --ids "$BUILD_ID" \
                --region $AWS_REGION \
                --query 'builds[0].logs.groupName' \
                --output text)
            
            LOG_STREAM=$(aws codebuild batch-get-builds \
                --ids "$BUILD_ID" \
                --region $AWS_REGION \
                --query 'builds[0].logs.streamName' \
                --output text)
            
            echo ""
            echo "Check logs at:"
            echo "https://console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logEventViewer:group=${LOG_GROUP};stream=${LOG_STREAM}"
            exit 1
            ;;
    esac
done

echo ""
echo "========================================"
log_info "Fast deployment complete!"
echo "========================================"
echo ""
log_info "New container image pushed to: $REPO_URI:latest"
echo ""
log_warn "Note: AgentCore Runtime will use the new image on next restart"
log_warn "The Runtime is serverless and will auto-update on next invocation"
echo ""