#!/bin/bash
# ============================================================================
# Gateway Stack Destroy Script
# Removes all AgentCore Gateway resources
# ============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INFRA_DIR="$SCRIPT_DIR/../infrastructure"

export PROJECT_NAME="${PROJECT_NAME:-strands-agent-chatbot}"
export ENVIRONMENT="${ENVIRONMENT:-dev}"
export AWS_REGION="${AWS_REGION:-us-west-2}"

echo "🗑️  Destroying AgentCore Gateway Stack..."
echo ""
echo "⚠️  WARNING: This will delete all Gateway resources!"
echo "   Project: $PROJECT_NAME"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $AWS_REGION"
echo ""

read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Destruction cancelled"
    exit 0
fi

echo ""
echo "🔥 Destroying stacks..."
cd "$INFRA_DIR"

npx cdk destroy --all --force

echo ""
echo "✅ All stacks destroyed successfully!"
