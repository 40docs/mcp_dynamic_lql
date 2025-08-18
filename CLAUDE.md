# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a **Lacework Dynamic MCP Server** - a Model Context Protocol server that converts natural language security queries into Lacework Query Language (LQL) and dynamically generates reusable tools at runtime. The server provides an intelligent middleware between Lacework and LLMs for security analysis.

## Core Architecture

The system has four main components:

- **LQL Generator** (`src/generators/lql-generator.ts`): Converts natural language to structured LQL queries using pattern matching and data source identification
- **Lacework Handler** (`src/lacework/cli-handler.ts`): Executes queries via Lacework CLI and handles authentication
- **Template Manager** (`src/templates/template-manager.ts`): Manages YAML-based query templates organized by security categories
- **Dynamic Tool Registry** (`src/tools/dynamic-registry.ts`): Creates and registers new MCP tools at runtime based on successful queries

## Development Commands

### Build and Development
```bash
# Install dependencies
npm install

# Development mode with auto-reload
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Clean build artifacts
npm run clean

# Run tests
npm test
```

### Testing MCP Server
```bash
# Test server directly
node dist/server.js

# With debug logging
DEBUG=lacework-mcp:* node dist/server.js

# Test Lacework CLI integration
lacework configure show
lacework query list-sources
```

## Prerequisites and Setup

### Required Dependencies
1. **Lacework CLI** must be installed and authenticated:
   ```bash
   curl https://raw.githubusercontent.com/lacework/go-sdk/main/cli/install.sh | bash
   lacework configure
   lacework query list-sources  # Test authentication
   ```

2. **Node.js 18+** (specified in package.json engines)

### MCP Client Configuration
Add to your MCP client configuration (Claude Desktop, Continue, etc.):
```json
{
  "mcpServers": {
    "lacework-dynamic": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/path/to/lacework-mcp-server"
    }
  }
}
```

## Key Technical Patterns

### Natural Language Processing Pipeline
The system processes queries through a 4-step pipeline:
1. **Data Source Identification**: Maps keywords to Lacework data sources (CloudTrailRawEvents, ComplianceEvaluationDetails, etc.)
2. **Pattern Matching**: Uses regex patterns to identify query intent (risk assessment, compliance, vulnerabilities)
3. **Filter Extraction**: Extracts security filters (severity, risk scores, time ranges, cloud providers)
4. **LQL Generation**: Builds structured LQL queries with WHERE clauses, ORDER BY, and LIMIT

### Dynamic Tool Generation
Successful queries automatically create new MCP tools:
- Generates appropriate input schemas
- Registers tools for future use without server restart
- Maintains tool usage statistics
- Creates templates for common patterns

### Template System Structure
Templates are organized in categories under `templates/`:
- `compliance/` - CIS benchmarks, policy violations
- `aws/` - AWS-specific security queries  
- `containers/` - Container vulnerabilities and threats
- `threats/` - Threat detection and lateral movement
- `inventory/` - Asset discovery and inventory

## Static vs Dynamic Tools

### Static Tools (always available)
- `lacework-status` - Check CLI installation and authentication
- `natural-query` - Convert natural language to LQL and execute
- `execute-lql` - Run raw LQL queries directly
- `list-templates` - Browse available query templates

### Dynamic Tools (auto-generated)
Created at runtime based on successful natural language queries:
- `get-aws-high-risk-instances`
- `find-critical-vulnerabilities`
- `get-compliance-violations`

## Data Source Mappings

The LQL generator maintains mappings between keywords and Lacework data sources:
- **AWS Security**: `CloudTrailRawEvents` for EC2, S3, IAM events
- **Compliance**: `ComplianceEvaluationDetails` for CIS benchmarks, policy violations
- **Vulnerabilities**: `ContainerVulnDetails`, `VulnDetails` for CVEs and security issues
- **Network**: `NetworkActivity` for lateral movement and suspicious connections
- **Users**: `UserActivity` for authentication and access events
- **Kubernetes**: `KubernetesActivity` for K8s cluster activities

## Error Handling Patterns

The server implements comprehensive error handling:
- Global uncaught exception handlers with graceful shutdown
- MCP handshake validation with detailed logging
- Lacework CLI detection and authentication status checks
- Query execution retry logic with fallback strategies
- Non-blocking initialization for degraded operation modes

## Testing and Validation

### Local Development Testing
- Server can run without Lacework CLI for development
- Component initialization is non-blocking
- Extensive console.error logging for debugging
- Tool generation and registration can be tested independently

### Common Troubleshooting
- **"Lacework CLI not authenticated"** → Run `lacework configure`
- **"Query execution failed"** → Verify LQL syntax and data source availability
- **"Tool generation failed"** → Check natural language pattern recognition
- **MCP connection issues** → Verify stdio transport and client configuration

## Performance Considerations

- Query execution: 1-5 seconds typical
- Tool generation: <500ms per tool  
- Template loading: <100ms for 50 templates
- Memory usage: ~50MB base + query results
- Uses ES modules with strict TypeScript configuration