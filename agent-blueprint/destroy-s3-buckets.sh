#!/bin/bash
set -e


# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo -e "${BLUE}▶${NC} $1"
}


PROJECT_NAME="advanced-chatbot"
BUCKETS=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, '$PROJECT_NAME')].Name" --output text) 

if [ -z "$BUCKETS" ]; then
    log_info "No buckets found with prefix '$PROJECT_NAME'."

else
        
    # ask confirm before deleting buckets
    log_step "The following buckets will be deleted:"
    for bucket in $BUCKETS; do
        echo "- $bucket"
    done
    read -p "Are you sure you want to delete these buckets? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warn "Aborting."
        exit 1
    fi

    for bucket in $BUCKETS; do
        log_step "Deleting bucket: $bucket"
        # Empty the bucket (including all versions and delete markers)
        aws s3api list-object-versions --bucket "$bucket" --output json \
        | jq -r '.Versions[]?, .DeleteMarkers[]? | [.Key, .VersionId] | @tsv' \
        | while IFS=$'\t' read -r key versionId; do
            aws s3api delete-object --bucket "$bucket" --key "$key" --version-id "$versionId"
        done
        aws s3 rb "s3://$bucket" --force
    done

    log_info "All buckets with prefix '$PROJECT_NAME' have been deleted."

fi



log_step "------------------------------"
log_step "Cleaning up vector buckets..."

VECTOR_BUCKETS=$(aws s3vectors list-vector-buckets \
    --query "vectorBuckets[?starts_with(vectorBucketName, \`${PROJECT_NAME}\`)].vectorBucketName" \
    --output text 2>/dev/null || echo "")

if [ -z "$VECTOR_BUCKETS" ] || [ "$VECTOR_BUCKETS" = "None" ]; then
    log_info "No vector buckets found with prefix '$PROJECT_NAME'."
    exit 0
fi

log_step "The following vector buckets will be deleted:"
for bucket in $VECTOR_BUCKETS; do
    echo "- $bucket"
done
read -p "Are you sure you want to delete these vector buckets? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warn "Aborting."
    exit 1
fi

log_warn "Starting deletion of vector buckets. This may take a while..."


for BUCKET_NAME in $VECTOR_BUCKETS; do
    log_step "Deleting vector bucket: $BUCKET_NAME"

    # First, list and delete all indexes in the vector bucket
    INDEXES=$(aws s3vectors list-indexes \
        --vector-bucket-name "$BUCKET_NAME" \
        --query "indexes[].indexName" \
        --output text 2>/dev/null || echo "")

    if [ -n "$INDEXES" ] && [ "$INDEXES" != "None" ]; then
        for INDEX_NAME in $INDEXES; do
            log_step "  Deleting index: $INDEX_NAME"
            aws s3vectors delete-index \
                --vector-bucket-name "$BUCKET_NAME" \
                --index-name "$INDEX_NAME"
            log_info "  Index '$INDEX_NAME' deleted."
        done
    else
        log_info "  No indexes found in vector bucket."
    fi

    # Now delete the vector bucket itself
    aws s3vectors delete-vector-bucket \
        --vector-bucket-name "$BUCKET_NAME"
    log_info "Vector bucket '$BUCKET_NAME' deleted."
done

log_info "All vector buckets with prefix '$PROJECT_NAME' have been deleted."