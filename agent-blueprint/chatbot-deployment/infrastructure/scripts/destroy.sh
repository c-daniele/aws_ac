#!/bin/bash

set -e

echo "Starting Chatbot destruction..."

# Set region - use environment variable or default
export AWS_REGION=${AWS_REGION:-us-west-2}
export AWS_DEFAULT_REGION=$AWS_REGION

echo "🌍 Destruction region: $AWS_REGION"

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Destroying from AWS Account: $ACCOUNT_ID in region: $AWS_REGION"

# Get the absolute path to the infrastructure directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRASTRUCTURE_DIR="$(dirname "$SCRIPT_DIR")"

# Change to the CDK infrastructure directory
cd "$INFRASTRUCTURE_DIR"

# Debug: Show current directory
echo "📂 Current directory: $(pwd)"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing CDK dependencies..."
    npm install
fi

# Set CDK environment variables
export CDK_DEFAULT_ACCOUNT=$ACCOUNT_ID
export CDK_DEFAULT_REGION=$AWS_REGION

echo "🗑️  Destroying Chatbot stacks..."

# Function to ensure stack deletion starts
ensure_stack_deletion() {
    local stack_name=$1
    local display_name=$2

    echo "$display_name Destroying $stack_name..."

    # Try CDK destroy first
    npx cdk destroy $stack_name --force --require-approval never 2>&1 || true

    # Wait a moment for deletion to start
    sleep 3

    # Check if deletion actually started
    if aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION &>/dev/null; then
        stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

        if [[ "$stack_status" != "DELETE_IN_PROGRESS" && "$stack_status" != "DELETE_COMPLETE" && "$stack_status" != "DELETED" ]]; then
            echo "⚠️  CDK destroy did not start deletion (status: $stack_status), using CloudFormation directly..."

            # Execute delete-stack command with error handling
            if aws cloudformation delete-stack --stack-name "$stack_name" --region $AWS_REGION 2>&1; then
                echo "✅ CloudFormation delete-stack command executed for $stack_name"

                # Wait for the delete operation to be recognized by AWS
                echo "   Waiting for deletion to start..."
                local retries=0
                local max_retries=10
                while [ $retries -lt $max_retries ]; do
                    sleep 2
                    new_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

                    if [[ "$new_status" == "DELETE_IN_PROGRESS" || "$new_status" == "DELETE_COMPLETE" || "$new_status" == "DELETED" ]]; then
                        echo "✅ Stack deletion started (status: $new_status)"
                        break
                    fi

                    retries=$((retries + 1))
                    if [ $retries -ge $max_retries ]; then
                        echo "⚠️  Deletion may not have started properly. Current status: $new_status"
                    fi
                done
            else
                echo "❌ Failed to execute delete-stack command for $stack_name"
            fi
        else
            echo "✅ Stack deletion in progress for $stack_name"
        fi
    else
        echo "✅ $stack_name already deleted or not found"
    fi
}

# Destroy main Chatbot stack FIRST (due to dependencies on CognitoAuthStack exports)
if aws cloudformation describe-stacks --stack-name "ChatbotStack" --region $AWS_REGION &>/dev/null; then
    ensure_stack_deletion "ChatbotStack" "🚀"
else
    echo "ℹ️  ChatbotStack not found or already destroyed"
fi

# Wait for ChatbotStack to be fully deleted before destroying CognitoAuthStack
echo "⏳ Waiting for ChatbotStack to be fully deleted before destroying CognitoAuthStack..."
if aws cloudformation describe-stacks --stack-name "ChatbotStack" --region $AWS_REGION &>/dev/null; then
    wait_for_stack_deletion "ChatbotStack"
fi

# Now destroy Cognito stack
if aws cloudformation describe-stacks --stack-name "CognitoAuthStack" --region $AWS_REGION &>/dev/null; then
    echo "🔐 Destroying CognitoAuthStack..."

    # Use CloudFormation CLI directly for more reliable deletion
    aws cloudformation delete-stack --stack-name "CognitoAuthStack" --region $AWS_REGION
    echo "✅ CognitoAuthStack deletion initiated"
else
    echo "ℹ️  CognitoAuthStack not found or already destroyed"
fi

# Function to wait for stack deletion with progress
wait_for_stack_deletion() {
    local stack_name=$1
    local max_wait=600  # 10 minutes
    local elapsed=0
    local interval=10

    echo "⏳ Waiting for $stack_name deletion..."

    while [ $elapsed -lt $max_wait ]; do
        # Check stack status
        stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

        if [ "$stack_status" == "DELETED" ] || [ "$stack_status" == "DELETE_COMPLETE" ]; then
            echo "✅ $stack_name deleted successfully"
            return 0
        elif [ "$stack_status" == "DELETE_FAILED" ]; then
            echo "❌ $stack_name deletion failed"
            return 1
        else
            echo "   ⏳ Status: $stack_status (${elapsed}s elapsed)"
            sleep $interval
            elapsed=$((elapsed + interval))
        fi
    done

    echo "⚠️  Timeout waiting for $stack_name deletion (waited ${max_wait}s)"
    return 1
}

# Wait for CognitoAuthStack deletion
echo "⏳ Waiting for CognitoAuthStack deletion to complete..."
if aws cloudformation describe-stacks --stack-name "CognitoAuthStack" --region $AWS_REGION &>/dev/null; then
    wait_for_stack_deletion "CognitoAuthStack"
fi

echo "✅ Chatbot stacks destroyed successfully!"
echo ""

# ============================================================
# Destroy Gateway Stacks (AgentCore Gateway + Lambda Tools)
# ============================================================

echo "🔧 Destroying Gateway stacks..."

# Get project name from environment or use default
PROJECT_NAME=${PROJECT_NAME:-strands-agent-chatbot}

# Gateway stacks in reverse dependency order
GATEWAY_STACKS=(
    "${PROJECT_NAME}-gateway-targets"
    "${PROJECT_NAME}-gateway-lambdas"
    "${PROJECT_NAME}-gateway"
    "${PROJECT_NAME}-gateway-iam"
)

# Function to delete gateway stack
delete_gateway_stack() {
    local stack_name=$1

    if aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION &>/dev/null; then
        echo "🗑️  Deleting $stack_name..."
        aws cloudformation delete-stack --stack-name "$stack_name" --region $AWS_REGION
        echo "✅ $stack_name deletion initiated"
    else
        echo "ℹ️  $stack_name not found or already deleted"
    fi
}

# Delete each gateway stack
for stack in "${GATEWAY_STACKS[@]}"; do
    delete_gateway_stack "$stack"
done

# Wait for all gateway stacks to be deleted
echo "⏳ Waiting for Gateway stacks deletion..."
for stack in "${GATEWAY_STACKS[@]}"; do
    if aws cloudformation describe-stacks --stack-name "$stack" --region $AWS_REGION &>/dev/null; then
        wait_for_stack_deletion "$stack"
    fi
done

echo "✅ All destruction completed successfully!"
echo ""
echo "🧹 Optional cleanup:"
echo "  - ECR repositories: chatbot-backend, chatbot-frontend"
echo "  - CloudWatch log groups: /aws/ecs/chatbot-*"
echo "  - Parameter Store entries: /mcp/endpoints/*"
echo ""
echo "Run the following commands to clean up ECR repositories:"
echo "  aws ecr delete-repository --repository-name chatbot-backend --force --region $AWS_REGION"
echo "  aws ecr delete-repository --repository-name chatbot-frontend --force --region $AWS_REGION"