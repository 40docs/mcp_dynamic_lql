# Lacework Dynamic MCP Server

🚀 **Dynamic Model Context Protocol server for Lacework** - Convert natural language to LQL queries and automatically generate reusable tools at runtime.

## Overview

This MCP server provides an intelligent middleware between Lacework and LLM prompts, enabling:

- 🧠 **Natural Language to LQL Conversion** - Convert plain English to Lacework Query Language
- 🔧 **Dynamic Tool Generation** - Automatically create new MCP tools based on query patterns
- 📚 **LQL Template System** - Pre-built templates for common security scenarios
- 🔄 **Runtime Tool Registration** - Register new tools without server restart
- 📊 **Query Result Caching** - Intelligent caching for performance

## Architecture

### Core Architecture Layers
- **LaceworkHandler**: CLI integration and query execution  
- **LQLGenerator**: Natural language to LQL conversion
- **TemplateManager**: YAML-based query template system
- **DynamicToolRegistry**: Runtime tool generation and management

### Workflow
```
User: "Show me AWS EC2 instances with high risk scores"
     ↓
🧠 Natural Language Analysis
     ↓  
🔧 LQL Query Generation: SELECT * FROM CloudTrailRawEvents WHERE...
     ↓
⚡ Lacework CLI Execution
     ↓
📝 Template Creation: "lacework-aws-high-risk-instances"  
     ↓
🔧 Dynamic Tool Registration: "get-aws-high-risk-instances"
     ↓
📊 Formatted Results + Future Tool Available
```

## Features

### 🧠 Natural Language Processing
- Converts English queries to proper LQL syntax
- Recognizes security patterns (compliance, threats, vulnerabilities)
- Extracts time ranges, filters, and conditions
- Maps cloud providers and resource types

### 🔧 Dynamic Tool Generation
- Creates new MCP tools at runtime based on query patterns
- Registers tools for future use without restart
- Generates appropriate input schemas
- Provides tool usage statistics and management

### 📚 Template System
- Pre-built templates for common security scenarios
- Organized by category (AWS, compliance, threats, containers)
- YAML-based template storage
- Auto-generation from successful queries

### ⚡ Lacework Integration
- CLI detection and authentication status
- Direct query execution via `lacework` command
- Data source discovery and validation
- Error handling and retry logic

## Quick Start

### Prerequisites

1. **Lacework CLI** installed and configured:
   ```bash
   # Install Lacework CLI
   curl https://raw.githubusercontent.com/lacework/go-sdk/main/cli/install.sh | bash
   
   # Configure authentication
   lacework configure
   
   # Test access
   lacework query list-sources
   ```

2. **Node.js 18+** and **npm**

### Installation

1. **Clone and install**:
   ```bash
   git clone https://github.com/40docs/mcp_dynamic_lql.git
   cd mcp_dynamic_lql
   npm install
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```

3. **Test Lacework connection**:
   ```bash
   node dist/server.js
   # Should show "✅ Lacework CLI detected and authenticated"
   ```

### MCP Client Configuration

Add to your MCP client (Claude Desktop, Continue, etc.):

```json
{
  "mcpServers": {
    "lacework-dynamic": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/path/to/mcp_dynamic_lql"
    }
  }
}
```

## Usage Examples

### Natural Language Queries

```
🔍 "Show me AWS EC2 instances with high risk scores"
→ Generates LQL, executes query, creates reusable tool

🔍 "Find critical vulnerabilities in containers"  
→ Queries ContainerVulnDetails, filters by severity=critical

🔍 "List compliance violations from last week"
→ Queries ComplianceEvaluationDetails with time filter

🔍 "Get suspicious user login activities"
→ Queries UserActivity with anomaly detection
```

### Static Tools

- **`lacework-status`** - Check CLI installation and auth
- **`natural-query`** - Convert natural language to LQL
- **`execute-lql`** - Run raw LQL queries
- **`list-templates`** - Browse available templates

### Dynamic Tools (Auto-Generated)

After running natural language queries, tools are automatically created:

- **`get-aws-high-risk-instances`** - AWS instances with high risk
- **`find-critical-vulnerabilities`** - Critical security issues  
- **`get-compliance-violations`** - Compliance failures
- **`find-threat-activities`** - Threat detection results

## Template Categories

### 🏛️ Compliance
- `lacework-compliance-cis-failures` - CIS benchmark failures
- `lacework-compliance-high-severity` - Critical compliance issues

### 🛡️ AWS Security
- `lacework-aws-unencrypted-volumes` - Unencrypted EBS volumes
- `lacework-aws-public-s3-buckets` - Publicly accessible S3 buckets

### 📦 Container Security
- `lacework-container-critical-vulns` - Critical container vulnerabilities
- `lacework-container-runtime-threats` - Runtime threat detection

### 🌐 Network Security
- `lacework-network-lateral-movement` - Lateral movement detection

### 👤 User Security
- `lacework-user-suspicious-logins` - Suspicious authentication events

### 📊 Inventory
- `lacework-inventory-aws-assets` - Complete AWS asset inventory

## Configuration

### Environment Variables
```bash
# Optional - CLI will be auto-detected
export LACEWORK_CLI_PATH=/usr/local/bin/lacework

# Optional - API credentials for direct access
export LACEWORK_API_URL=https://your-account.lacework.net
export LACEWORK_API_TOKEN=your-api-token

# Feature flags
export MCP_DISABLE_AUTO_GENERATION=false
```

### Project Structure
```
src/
├── server.ts                 # Main MCP server
├── lacework/
│   └── cli-handler.ts        # Lacework CLI integration
├── generators/
│   └── lql-generator.ts      # Natural language → LQL conversion
├── templates/
│   └── template-manager.ts   # LQL template system
└── tools/
    └── dynamic-registry.ts   # Dynamic tool registration

templates/
├── compliance/               # Compliance templates
├── threats/                  # Threat detection templates
├── aws/                     # AWS-specific templates
├── containers/              # Container security templates
└── custom/                  # User-generated templates
```

## Development

### TypeScript Configuration
- ES2022 target with ESNext modules
- Source maps and declarations enabled  
- Node.js 18+ required

### Development Scripts
```bash
npm run build       # Production build
npm run start       # Start production server
npm run dev         # Development mode with auto-reload
npm run test        # Run tests
npm run clean       # Clean build artifacts
```

### Adding Custom Templates

Create YAML files in the appropriate category directory:

```yaml
# templates/custom/my-query.yaml
name: lacework-my-custom-query
description: "Find my specific security pattern"
category: custom
query: |
  SELECT *
  FROM CloudTrailRawEvents
  WHERE EVENT_NAME = 'MySpecificEvent'
  ORDER BY EVENT_TIME DESC
  LIMIT 100
parameters:
  event_type: MySpecificEvent
tags: [custom, aws, events]
```

### Extending Natural Language Patterns

Edit `src/generators/lql-generator.ts`:

```typescript
// Add new query patterns
this.queryPatterns.push({
  pattern: /my.*custom.*pattern/i,
  generator: (match, query) => ({
    category: 'custom',
    parameters: { custom_field: 'value' },
    suggestedName: 'my-custom-query',
  })
});
```

### Custom Data Source Mappings

Add new data sources in `initializeDataSources()`:

```typescript
this.dataSources.set('my-source', {
  keywords: ['myservice', 'mycustom'],
  lqlSource: 'MyCustomDataSource',
  commonFields: ['FIELD1', 'FIELD2'],
  description: 'My custom data source'
});
```

## Troubleshooting

### Lacework CLI Issues
```bash
# Check CLI installation
which lacework
lacework version

# Verify authentication
lacework configure show
lacework query list-sources

# Test basic query
lacework query run --query "SELECT * FROM CloudTrailRawEvents LIMIT 1"
```

### MCP Server Issues
```bash
# Enable debug logging
export DEBUG=lacework-mcp:*

# Test server directly
node dist/server.js

# Check tool generation
# Server logs will show: "🔧 Generated dynamic tool: <name>"
```

### Common Error Messages

- **"Lacework CLI not authenticated"** → Run `lacework configure`
- **"Query execution failed"** → Check LQL syntax and data source availability  
- **"Tool generation failed"** → Check natural language pattern recognition
- **"Template not found"** → Verify template files in correct directory

## Performance

- **Query Execution**: 1-5 seconds typical
- **Tool Generation**: <500ms per tool
- **Template Loading**: <100ms for 50 templates
- **Memory Usage**: ~50MB base + query results

## Security

### Security Features
- ✅ Uses existing Lacework CLI authentication
- ✅ No credential storage in MCP server
- ✅ Query validation before execution
- ✅ Command injection protection with proper escaping
- ✅ Input sanitization and validation
- ✅ Timeout protection for subprocess execution
- ✅ Error message sanitization

### Security Considerations  
- ⚠️  Generated queries should be reviewed in production
- ⚠️  Consider rate limiting for high-volume usage
- ⚠️  Monitor resource usage in production environments

## GitHub Actions Integration

This repository includes automated Claude Code integration through GitHub Actions:

### 🤖 Claude Code Action
- **Trigger**: `@claude` mentions in issues, PRs, or comments
- **Capabilities**: Code assistance, debugging, feature implementation
- **Permissions**: Read repository contents, PR details, and CI results
- **Model**: Claude Sonnet 4 (configurable to Claude Opus 4.1)

### 🔍 Claude Code Review Action  
- **Trigger**: Automatically on pull request creation and updates
- **Focus Areas**:
  - Code quality and best practices
  - Potential bugs and security concerns
  - Performance considerations
  - Test coverage assessment
- **Output**: Constructive feedback as PR comments

### Usage Examples

**Interactive assistance in issues/PRs:**
```
@claude help me implement natural language query caching
@claude review this LQL generator implementation
@claude fix the authentication error in the CLI handler
```

**Automatic PR reviews:**
- Reviews run automatically on every PR
- Provides detailed feedback on code changes
- Focuses on TypeScript best practices and security
- Includes performance and maintainability suggestions

### Configuration

Both actions use the `CLAUDE_CODE_OAUTH_TOKEN` secret for authentication. The workflows are configured with:
- Read access to repository contents and pull requests
- Optional CI results reading for enhanced context
- Customizable model selection and permissions
- File-type specific review guidelines

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Add tests for new functionality
4. Update documentation
5. Submit pull request (automatic Claude review will be triggered)

### Development Setup
```bash
npm install
npm run dev     # Development mode with auto-reload
npm run build   # Production build
npm run test    # Run tests
npm run clean   # Clean build artifacts
```

## License

MIT License - see LICENSE file for details.

---

**🎯 Ready to make Lacework data more accessible through natural language!**

For issues and feature requests, please use the GitHub issue tracker.