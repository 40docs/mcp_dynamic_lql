#!/bin/bash
echo "Starting MCP server..." >&2
echo "Current directory: $(pwd)" >&2
cd /home/housekeeping/Desktop/mcp/lql
echo "Changed to directory: $(pwd)" >&2
echo "Listing files:" >&2
ls -la dist/ >&2
echo "Starting node server..." >&2
exec node dist/server.js 2>&1


