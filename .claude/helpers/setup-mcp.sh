#!/bin/bash
# Setup Claude Flow MCP Server

echo "Setting up Claude Flow MCP server..."
npx claude-flow@alpha mcp start

echo ""
echo "MCP server started. You can now use memory and swarm operations."
