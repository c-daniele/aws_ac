# Report Writer MCP Server

MCP server for creating comprehensive research reports with charts and formatting. Deployed on AWS Bedrock AgentCore Runtime.

## Features

- **Markdown-based authoring**: Write reports in markdown format
- **Chart generation**: Create charts using Bedrock Code Interpreter
- **Automatic DOCX conversion**: Convert markdown to formatted Word documents
- **S3 storage**: Reports saved to S3 with automatic download
- **Stateful management**: Session-based report and chart storage

## Architecture

```
Strands Agent → Gateway → AgentCore Runtime MCP → Report Writer
                                                      ↓
                                                   S3 Bucket (Reports)
                                                      ↓
                                              Bedrock Code Interpreter (Charts)
```

## Deployment

### Prerequisites

- AWS CLI configured
- Docker installed
- Python 3.12+
- AWS CDK v2 installed

### Deploy

```bash
cd agent-blueprint/agentcore-runtime-mcp-stack/report-writer
./deploy.sh
```

This will:
1. Create ECR repository
2. Build and push Docker image
3. Deploy CDK stack with AgentCore Runtime
4. Create S3 bucket for reports
5. Store endpoint in SSM Parameter Store

### Outputs

After deployment, you'll receive:
- **Runtime Endpoint ARN**: AgentCore Runtime endpoint
- **SSM Parameter**: `/mcp/endpoints/agentcore/report-writer`
- **S3 Bucket**: Report storage bucket name
- **ECR Image URI**: Docker image location

## Integration with Gateway

Add to Gateway configuration:

```typescript
{
  "name": "report-writer",
  "transport": "agentcore_runtime",
  "endpoint_arn": "ssm:///mcp/endpoints/agentcore/report-writer",
  "description": "Create comprehensive research reports with charts"
}
```

## MCP Tools

### 1. create_report
Create a new report with title and optional outline.

```python
create_report(
    title="AI Impact on Retail Industry",
    outline=[
        {"title": "Executive Summary"},
        {"title": "Introduction", "subsections": [{"title": "Background"}]},
        {"title": "Methods"},
        {"title": "Results"},
        {"title": "Conclusion"}
    ]
)
```

### 2. write_section
Write a complete section with markdown content.

```python
write_section(
    section_title="Introduction",
    content='''Artificial Intelligence is transforming retail [https://example.com].

### Background
- Digital transformation initiatives
- Evolving customer expectations

### Research Gap
Limited research exists on in-store AI applications.'''
)
```

### 3. generate_chart
Generate charts using Python code via Bedrock Code Interpreter.

```python
generate_chart(
    python_code='''
import matplotlib.pyplot as plt
categories = ['Q1', 'Q2', 'Q3', 'Q4']
values = [15, 22, 28, 35]
plt.figure(figsize=(10, 6))
plt.bar(categories, values)
plt.title('Quarterly Growth')
plt.savefig('growth.png', dpi=300, bbox_inches='tight')
''',
    chart_filename="growth.png",
    session_id="session_123"
)
```

### 4. insert_chart
Insert a generated chart into the report.

```python
insert_chart(
    chart_filename="growth.png",
    chart_title="Quarterly Growth Trend",
    chart_description="Bar chart showing quarterly growth",
    session_id="session_123"
)
```

### 5. read_report
Read current report content for review.

```python
read_report()
```

### 6. replace_text
Find and replace text in the report.

```python
replace_text(
    find="machine learning",
    replace="ML"
)
```

### 7. get_outline
Get the report outline.

```python
get_outline()
```

### 8. finalize_report
Convert to DOCX and save to S3.

```python
finalize_report(
    filename="ai_retail_report.docx",
    session_id="session_123"
)
```

### 9. clear_report
Clear current report and start fresh.

```python
clear_report()
```

## Usage Flow

```
1. create_report("Research on AI", outline=[...])
2. write_section("Introduction", "AI is transforming...")
3. write_section("Methods", "We analyzed...")
4. generate_chart(python_code, "chart.png", session_id)
5. insert_chart("chart.png", "Results", "Shows...", session_id)
6. write_section("Conclusion", "In summary...")
7. finalize_report("report.docx", session_id)
   → Returns base64 DOCX for download
```

## Markdown Support

The report writer supports full markdown syntax:

- **Headings**: `#`, `##`, `###`, `####`
- **Bold**: `**text**`
- **Italic**: `*text*`
- **Code**: `` `code` ``
- **Lists**: `- item` or `1. item`
- **Citations**: `[https://url]` (converted to footnotes in DOCX)
- **Blockquotes**: `> quote`
- **Horizontal rules**: `---`

## DOCX Conversion

Markdown is automatically converted to DOCX with:

- Proper heading styles (H1, H2, H3, H4)
- Formatted inline text (bold, italic, code)
- Bullet and numbered lists
- URL citations as footnotes
- Embedded charts (base64 images)
- Tables (markdown table syntax)

## Charts

Charts are generated using Bedrock Code Interpreter:

**Available libraries**:
- matplotlib.pyplot
- seaborn
- pandas
- numpy

**Requirements**:
- Must save to PNG: `plt.savefig('filename.png', dpi=300, bbox_inches='tight')`
- Filename must match exactly in `generate_chart()` and `plt.savefig()`
- Charts stored in memory by session_id
- Cleared after `finalize_report()`

## Storage

- **Reports**: S3 bucket at `s3://report-writer-bucket-{account}/reports/{session_id}/{filename}`
- **Charts**: In-memory storage (session-based)
- **Metadata**: Report stats stored in S3 object metadata

## Cleanup

To remove the deployment:

```bash
cd cdk
source .venv/bin/activate
cdk destroy
```

Also delete:
- ECR repository: `aws ecr delete-repository --repository-name report-writer-mcp-repository --force`
- S3 bucket: Empty bucket first, then delete

## Logs

View logs in CloudWatch:
```bash
aws logs tail /aws/bedrockagentcore/ReportWriterAgentCoreStack --follow
```

## Troubleshooting

### Chart generation fails
- Check Code Interpreter permissions in IAM role
- Verify Python code syntax
- Ensure `plt.savefig()` filename matches `chart_filename` parameter

### DOCX conversion issues
- Check markdown syntax (especially unclosed brackets)
- Verify base64 chart data is valid
- Review CloudWatch logs for conversion errors

### S3 upload fails
- Verify S3 bucket permissions in IAM role
- Check bucket name in environment variables
- Ensure bucket exists in the same region

## Cost Estimation

- **AgentCore Runtime**: $0.10/hour when active
- **Code Interpreter**: $0.10/execution
- **S3 Storage**: $0.023/GB/month
- **ECR Storage**: $0.10/GB/month

Typical monthly cost: ~$10-30 depending on usage
