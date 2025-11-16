#!/bin/bash
# ============================================================================
# Lambda Function Build Script
# Builds ARM64 Lambda deployment packages for all functions
# ============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LAMBDA_DIR="$SCRIPT_DIR/../lambda-functions"

echo "🔨 Building Lambda function packages..."
echo ""

# Lambda function list
FUNCTIONS=(
    "tavily"
    "wikipedia"
    "arxiv"
    "google-search"
    "finance"
)

# Build each function
for FUNC in "${FUNCTIONS[@]}"; do
    echo "📦 Building $FUNC..."

    FUNC_DIR="$LAMBDA_DIR/$FUNC"
    BUILD_DIR="$FUNC_DIR/build"

    # Clean previous build
    rm -rf "$BUILD_DIR"
    rm -f "$FUNC_DIR/build.zip"
    mkdir -p "$BUILD_DIR"

    # Install dependencies if requirements.txt exists
    if [ -f "$FUNC_DIR/requirements.txt" ]; then
        echo "   Installing dependencies..."

        # Check if Docker is available
        if command -v docker &> /dev/null && docker ps &> /dev/null; then
            echo "   Using Docker for Lambda ARM64 compatible build..."
            # Use Amazon Linux 2023 ARM64 image (matches Lambda runtime)
            if docker run --rm \
                --platform linux/arm64 \
                --entrypoint /bin/bash \
                -v "$FUNC_DIR:/src:ro" \
                -v "$BUILD_DIR:/build" \
                public.ecr.aws/lambda/python:3.13-arm64 \
                -c "pip3 install -r /src/requirements.txt -t /build --upgrade --no-cache-dir && chown -R $(id -u):$(id -g) /build" 2>&1 | grep -v "pip's dependency resolver" | grep -v "opentelemetry" || true; then
                echo "   ✓ Docker build successful"
            else
                echo "   ✗ Docker build failed"
                exit 1
            fi
        else
            echo "   ⚠️  Docker not available, using local pip install"
            echo "   (This may cause compatibility issues on Lambda ARM64)"
            pip install -r "$FUNC_DIR/requirements.txt" \
                -t "$BUILD_DIR" \
                --platform manylinux2014_aarch64 \
                --implementation cp \
                --python-version 3.13 \
                --only-binary=:all: \
                --upgrade \
                --no-warn-conflicts \
                --quiet 2>&1 | grep -v "pip's dependency resolver" | grep -v "opentelemetry" || true
        fi
    fi

    # Copy source code
    echo "   Copying source code..."
    cp "$FUNC_DIR"/*.py "$BUILD_DIR/" 2>/dev/null || true

    # Create ZIP package
    echo "   Creating deployment package..."
    cd "$BUILD_DIR"
    zip -r "../build.zip" . -q
    cd - > /dev/null

    # Show package size
    SIZE=$(du -h "$FUNC_DIR/build.zip" | cut -f1)
    echo "   ✅ $FUNC built successfully ($SIZE)"
    echo ""
done

echo "🎉 All Lambda functions built successfully!"
echo ""
echo "📊 Package sizes:"
for FUNC in "${FUNCTIONS[@]}"; do
    if [ -f "$LAMBDA_DIR/$FUNC/build.zip" ]; then
        SIZE=$(du -h "$LAMBDA_DIR/$FUNC/build.zip" | cut -f1)
        echo "   $FUNC: $SIZE"
    fi
done
