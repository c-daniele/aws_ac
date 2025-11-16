#!/bin/bash

# Sample Strands Agent Chatbot - Complete Destruction Script
# Run this script from the agent-blueprint directory
# This script destroys all components in the correct dependency order

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to setup shared virtual environment
setup_shared_venv() {
    print_status "Setting up shared Python virtual environment..."

    # Create shared venv in agent-blueprint if it doesn't exist
    if [ ! -d "venv" ]; then
        python3 -m venv venv
    fi

    source venv/bin/activate

    # Install/upgrade requirements if needed
    if [ -f "requirements.txt" ]; then
        pip install --upgrade pip
        pip install -r requirements.txt
        print_success "Shared virtual environment ready"
    else
        print_warning "No requirements.txt found in agent-blueprint directory"
    fi
}

# Function to activate shared environment
activate_shared_venv() {
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    else
        print_error "Shared virtual environment not found. Run setup first."
        exit 1
    fi
}

# Function to check if stack exists
stack_exists() {
    local stack_name="$1"
    aws cloudformation describe-stacks --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} &>/dev/null
}

# Function to destroy using CDK or fallback to CloudFormation
destroy_stack() {
    local stack_name="$1"
    local cdk_dir="$2"
    local use_python_cdk="$3"

    # Check if stack exists first
    if ! stack_exists "$stack_name"; then
        print_warning "Stack $stack_name does not exist or already deleted. Skipping."
        return 0
    fi

    print_status "Found stack $stack_name. Proceeding with destruction..."

    if [ -n "$cdk_dir" ] && [ -d "$cdk_dir" ]; then
        print_status "Destroying $stack_name using CDK..."

        if [ "$use_python_cdk" = "true" ]; then
            activate_shared_venv
            cd "$cdk_dir"
        else
            cd "$cdk_dir"
        fi

        # Try CDK destroy first
        if npx cdk destroy --all --force --require-approval never 2>/dev/null; then
            print_success "$stack_name destroyed via CDK"
        else
            print_warning "CDK destroy failed, falling back to CloudFormation..."
            aws cloudformation delete-stack --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} 2>/dev/null || {
                print_warning "CloudFormation delete also failed for $stack_name"
            }
        fi

        cd - > /dev/null
    else
        # Direct CloudFormation deletion
        print_status "Destroying $stack_name via CloudFormation..."
        aws cloudformation delete-stack --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} 2>/dev/null || {
            print_warning "Failed to delete $stack_name via CloudFormation"
        }
    fi
}

# Main destruction process
main() {
    print_status "🗑️  Starting complete destruction of Sample Strands Agent Chatbot..."

    # Ensure we're in the agent-blueprint directory
    if [[ ! -d "chatbot-deployment" ]] || [[ ! -d "fargate-mcp-farm" ]] || [[ ! -d "serverless-mcp-farm" ]]; then
        print_error "This script must be run from the agent-blueprint directory!"
        print_error "Current directory: $(pwd)"
        print_error "Please cd to agent-blueprint and run the script again."
        exit 1
    fi

    # Load AWS region from .env file if available
    if [ -f ".env" ]; then
        source .env 2>/dev/null || true
    fi

    # Set AWS region - use from .env or default
    export AWS_REGION=${AWS_REGION:-${NEXT_PUBLIC_AWS_REGION:-us-west-2}}
    export AWS_DEFAULT_REGION=$AWS_REGION

    # Get AWS account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    print_status "🌍 Deployment region: $AWS_REGION"
    print_status "🏗️  AWS Account: $ACCOUNT_ID"

    # Setup shared virtual environment
    setup_shared_venv

    print_warning "Destroying ALL components including:"
    echo "  - AgentCore Gateway Stack (Gateway + Lambda functions)"
    echo "  - Web Application (Chatbot)"
    echo "  - Cognito User Pools and Authentication"
    echo "  - ECR repositories and Docker images"
    echo "  - All associated AWS resources"
    echo ""

    print_status "Starting destruction in dependency order..."

    # Step 1: Destroy AgentCore Gateway Stack
    print_status "🗑️  Step 1: Destroying AgentCore Gateway Stack..."

    if [ -f "agentcore-gateway-stack/scripts/destroy.sh" ]; then
        cd agentcore-gateway-stack/scripts
        chmod +x destroy.sh

        # Export environment variables
        export AWS_REGION
        export AWS_DEFAULT_REGION

        ./destroy.sh || {
            print_warning "Dedicated destroy script failed, trying manual CDK destruction..."

            # Try manual CDK destroy
            cd ../infrastructure
            if [ -d "node_modules" ]; then
                npx cdk destroy --all --force --require-approval never 2>/dev/null || {
                    print_warning "CDK destroy failed, trying CloudFormation..."

                    # Destroy in reverse dependency order
                    for stack in strands-agent-chatbot-GatewayTargetStack \
                                strands-agent-chatbot-GatewayLambdaStack \
                                strands-agent-chatbot-GatewayStack \
                                strands-agent-chatbot-GatewayIamStack; do
                        destroy_stack "$stack" "" ""
                    done
                }
            fi
        }
        cd - > /dev/null
    else
        # Direct stack deletion
        print_status "No destroy script found, using direct stack deletion..."
        for stack in strands-agent-chatbot-GatewayTargetStack \
                    strands-agent-chatbot-GatewayLambdaStack \
                    strands-agent-chatbot-GatewayStack \
                    strands-agent-chatbot-GatewayIamStack; do
            destroy_stack "$stack" "" ""
        done
    fi

    # Step 2: Destroy Web Application (base VPC - destroy last)
    print_status "🗑️  Step 2: Destroying Web Application (Chatbot)..."

    if [ -f "chatbot-deployment/infrastructure/scripts/destroy.sh" ]; then
        cd chatbot-deployment/infrastructure
        chmod +x scripts/destroy.sh
        ./scripts/destroy.sh || {
            print_warning "Dedicated destroy script failed, trying manual CDK destruction..."

            # Set CDK environment variables for fallback
            export CDK_DEFAULT_ACCOUNT=$ACCOUNT_ID
            export CDK_DEFAULT_REGION=$AWS_REGION

            # Function to ensure stack deletion starts
            ensure_stack_deletion_fallback() {
                local stack_name=$1

                print_status "Destroying $stack_name..."

                # Try CDK destroy first
                npx cdk destroy $stack_name --force --require-approval never 2>&1 || true

                # Wait a moment for deletion to start
                sleep 3

                # Check if deletion actually started
                if stack_exists "$stack_name"; then
                    stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

                    if [[ "$stack_status" != "DELETE_IN_PROGRESS" && "$stack_status" != "DELETE_COMPLETE" && "$stack_status" != "DELETED" ]]; then
                        print_warning "CDK destroy did not start deletion (status: $stack_status), using CloudFormation directly..."

                        # Execute delete-stack command with error handling
                        if aws cloudformation delete-stack --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} 2>&1; then
                            print_success "CloudFormation delete-stack command executed for $stack_name"

                            # Wait for the delete operation to be recognized by AWS
                            print_status "Waiting for deletion to start..."
                            local retries=0
                            local max_retries=10
                            while [ $retries -lt $max_retries ]; do
                                sleep 2
                                new_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

                                if [[ "$new_status" == "DELETE_IN_PROGRESS" || "$new_status" == "DELETE_COMPLETE" || "$new_status" == "DELETED" ]]; then
                                    print_success "Stack deletion started (status: $new_status)"
                                    break
                                fi

                                retries=$((retries + 1))
                                if [ $retries -ge $max_retries ]; then
                                    print_warning "Deletion may not have started properly. Current status: $new_status"
                                fi
                            done
                        else
                            print_error "Failed to execute delete-stack command for $stack_name"
                        fi
                    else
                        print_success "Stack deletion in progress for $stack_name"
                    fi
                fi
            }

            # Manual CDK destruction from the correct directory
            if stack_exists "CognitoAuthStack"; then
                ensure_stack_deletion_fallback "CognitoAuthStack"
            fi

            if stack_exists "ChatbotStack"; then
                ensure_stack_deletion_fallback "ChatbotStack"
            fi
        }
        cd - > /dev/null
    else
        print_warning "No dedicated destroy script found, using manual CDK destruction..."
        
        # Change to the CDK directory for proper context
        cd chatbot-deployment/infrastructure
        
        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            print_status "Installing CDK dependencies..."
            npm install
        fi
        
        # Set CDK environment variables
        export CDK_DEFAULT_ACCOUNT=$ACCOUNT_ID
        export CDK_DEFAULT_REGION=$AWS_REGION
        
        # Function to ensure stack deletion starts
        ensure_stack_deletion() {
            local stack_name=$1

            print_status "Destroying $stack_name..."

            # Try CDK destroy first
            npx cdk destroy $stack_name --force --require-approval never 2>&1 || true

            # Wait a moment for deletion to start
            sleep 3

            # Check if deletion actually started
            if stack_exists "$stack_name"; then
                stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

                if [[ "$stack_status" != "DELETE_IN_PROGRESS" && "$stack_status" != "DELETE_COMPLETE" && "$stack_status" != "DELETED" ]]; then
                    print_warning "CDK destroy did not start deletion (status: $stack_status), using CloudFormation directly..."

                    # Execute delete-stack command with error handling
                    if aws cloudformation delete-stack --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} 2>&1; then
                        print_success "CloudFormation delete-stack command executed for $stack_name"

                        # Wait for the delete operation to be recognized by AWS
                        print_status "Waiting for deletion to start..."
                        local retries=0
                        local max_retries=10
                        while [ $retries -lt $max_retries ]; do
                            sleep 2
                            new_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

                            if [[ "$new_status" == "DELETE_IN_PROGRESS" || "$new_status" == "DELETE_COMPLETE" || "$new_status" == "DELETED" ]]; then
                                print_success "Stack deletion started (status: $new_status)"
                                break
                            fi

                            retries=$((retries + 1))
                            if [ $retries -ge $max_retries ]; then
                                print_warning "Deletion may not have started properly. Current status: $new_status"
                            fi
                        done
                    else
                        print_error "Failed to execute delete-stack command for $stack_name"
                    fi
                else
                    print_success "Stack deletion in progress for $stack_name"
                fi
            else
                print_status "$stack_name already deleted or not found"
            fi
        }

        # Destroy both stacks manually with proper CDK context
        if stack_exists "CognitoAuthStack"; then
            ensure_stack_deletion "CognitoAuthStack"
        fi

        if stack_exists "ChatbotStack"; then
            ensure_stack_deletion "ChatbotStack"
        fi
        
        cd - > /dev/null
    fi

    # Step 5: Clean up ECR repositories
    print_status "🗑️  Step 5: Cleaning up ECR repositories..."
    print_status "Deleting ECR repositories..."

    # List of ECR repositories to delete
    repos=("chatbot-backend" "chatbot-frontend" "python-mcp-fargate-python-mcp" "nova-act-mcp-fargate-nova-act-mcp")

    for repo in "${repos[@]}"; do
        print_status "Deleting ECR repository: $repo"
        aws ecr delete-repository --repository-name "$repo" --force --region ${AWS_REGION:-us-west-2} 2>/dev/null || {
            print_warning "Repository $repo not found or already deleted"
        }
    done

    # Step 6: Clean up SSM Parameters
    print_status "🗑️  Step 6: Cleaning up SSM Parameter Store..."

    # Delete all MCP endpoint parameters
    print_status "Deleting MCP endpoint parameters..."
    mcp_params=$(aws ssm get-parameters-by-path --path "/mcp/endpoints" --recursive --region ${AWS_REGION:-us-west-2} --query 'Parameters[*].Name' --output text 2>/dev/null || echo "")

    if [ -n "$mcp_params" ]; then
        for param in $mcp_params; do
            print_status "Deleting parameter: $param"
            aws ssm delete-parameter --name "$param" --region ${AWS_REGION:-us-west-2} 2>/dev/null || {
                print_warning "Failed to delete parameter $param"
            }
        done
        print_success "SSM parameters cleaned up"
    else
        print_status "No MCP endpoint parameters found"
    fi

    # Function to wait for stack deletion with progress
    wait_for_stack_deletion() {
        local stack_name=$1
        local max_wait=600  # 10 minutes
        local elapsed=0
        local interval=10

        print_status "Waiting for $stack_name deletion..."

        while [ $elapsed -lt $max_wait ]; do
            # Check stack status
            stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

            if [ "$stack_status" == "DELETED" ] || [ "$stack_status" == "DELETE_COMPLETE" ]; then
                print_success "$stack_name deleted successfully"
                return 0
            elif [ "$stack_status" == "DELETE_FAILED" ]; then
                print_error "$stack_name deletion failed"
                return 1
            else
                echo "   ⏳ Status: $stack_status (${elapsed}s elapsed)"
                sleep $interval
                elapsed=$((elapsed + interval))
            fi
        done

        print_warning "Timeout waiting for $stack_name deletion (waited ${max_wait}s)"
        return 1
    }

    # Step 7: Wait for all deletions to complete
    print_status "🗑️  Step 7: Waiting for all stacks to be deleted..."

    stacks_to_check=("python-mcp-fargate" "nova-act-mcp-fargate" "McpFarmAlbStack" "ChatbotStack" "CognitoAuthStack")

    for stack in "${stacks_to_check[@]}"; do
        # Check if stack exists before waiting
        if aws cloudformation describe-stacks --stack-name "$stack" --region ${AWS_REGION:-us-west-2} &>/dev/null; then
            wait_for_stack_deletion "$stack"
        else
            print_status "$stack not found or already deleted"
        fi
    done

    print_success "✅ All components have been successfully destroyed!"
    print_status "🎉 Sample Strands Agent Chatbot completely removed from AWS account"

    # Cleanup local Python virtual environments
    print_status "Cleaning up local Python virtual environments..."
    find . -name ".venv" -type d -exec rm -rf {} + 2>/dev/null || true

    print_success "🧹 Local cleanup completed!"
}

# Run main function
main "$@"