#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { LaceworkHandler } from './lacework/cli-handler.js';
import { LQLGenerator } from './generators/lql-generator.js';
import { TemplateManager } from './templates/template-manager.js';
import { DynamicToolRegistry } from './tools/dynamic-registry.js';

class LaceworkMCPServer {
  private server: Server;
  private laceworkHandler: LaceworkHandler;
  private lqlGenerator: LQLGenerator;
  private templateManager: TemplateManager;
  private toolRegistry: DynamicToolRegistry;

  constructor() {
    console.error('🔧 MCP Server constructor starting...');
    
    this.server = new Server({
      name: 'lacework-mcp-server',
      version: '1.0.0',
    });

    this.laceworkHandler = new LaceworkHandler();
    this.lqlGenerator = new LQLGenerator();
    this.templateManager = new TemplateManager();
    this.toolRegistry = new DynamicToolRegistry(
      this.laceworkHandler,
      this.lqlGenerator,
      this.templateManager
    );
    
    this.setupErrorHandlers();
    this.setupHandlers();
    console.error('✅ MCP Server constructor completed');
  }

  private setupErrorHandlers() {
    console.error('🛡️  Setting up error handlers...');
    
    // Global error handlers
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error.message);
      console.error('Stack:', error.stack);
      console.error('Process will exit...');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection at:', promise);
      console.error('Reason:', reason);
    });

    process.on('SIGINT', () => {
      console.error('🛑 Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.error('🛑 Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });
  }

  private setupHandlers() {
    console.error('📡 Setting up MCP request handlers...');

    // Initialize handler - CRITICAL for MCP handshake
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      console.error('🤝 Received initialize request from client');
      console.error('Initialize request details:', JSON.stringify({
        protocolVersion: request.params.protocolVersion,
        capabilities: request.params.capabilities,
        clientInfo: request.params.clientInfo
      }, null, 2));
      
      try {
          const clientVersion = request.params.protocolVersion;
          const response = {
            protocolVersion: clientVersion,
            capabilities: {
              tools: {},
              logging: {}
            },
            serverInfo: {
              name: "lacework-mcp-server",
              version: "1.0.0"
            }
          };
        
        console.error('📤 Sending initialize response:', JSON.stringify(response, null, 2));
        console.error('✅ Initialize handshake completed successfully');
        return response;
      } catch (error) {
        console.error('❌ Error in initialize handler:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
      }
    });

    // List available tools (static + dynamic)
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      console.error('📋 Received list tools request');
      try {
        const staticTools = this.getStaticTools();
        const dynamicTools = await this.toolRegistry.getDynamicTools();
        
        console.error(`🔧 Returning ${staticTools.length} static + ${dynamicTools.length} dynamic tools`);
        return {
          tools: [...staticTools, ...dynamicTools]
        };
      } catch (error) {
        console.error('❌ Error in list tools handler:', error.message);
        throw error;
      }
    });

    // Handle tool calls with dynamic generation
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.error(`🔧 Received tool call: ${name}`);
      console.error('Tool arguments:', JSON.stringify(args, null, 2));

      try {
        // Handle static tools
        if (name === 'lacework-status') {
          return await this.checkLaceworkStatus();
        }

        if (name === 'natural-query') {
          return await this.handleNaturalLanguageQuery(args);
        }

        if (name === 'list-templates') {
          return await this.listTemplates();
        }

        if (name === 'execute-lql') {
          return await this.executeLQL(args);
        }

        // Try dynamic tools first
        const dynamicResult = await this.toolRegistry.executeTool(name, args);
        if (dynamicResult) {
          return dynamicResult;
        }

        // If tool doesn't exist, try to generate it dynamically
        const generatedTool = await this.toolRegistry.generateToolFromQuery(name, args);
        if (generatedTool) {
          console.error(`✅ Generated dynamic tool: ${name}`);
          return await this.toolRegistry.executeTool(name, args);
        }

        throw new Error(`Unknown tool: ${name}. Try using 'natural-query' with your request.`);
      } catch (error) {
        console.error(`❌ Tool call error for ${name}:`, error.message);
        console.error('Error stack:', error.stack);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private getStaticTools(): Tool[] {
    return [
      {
        name: 'lacework-status',
        description: 'Check Lacework CLI installation and authentication status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'natural-query',
        description: 'Convert natural language to Lacework LQL query and execute it',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language description of what you want to find in Lacework (e.g., "show me AWS EC2 instances with high risk scores")',
            },
            startTime: {
              type: 'string',
              description: 'Start time for the query (ISO 8601 format, optional)',
            },
            endTime: {
              type: 'string',
              description: 'End time for the query (ISO 8601 format, optional)',
            },
            saveAsTemplate: {
              type: 'boolean',
              description: 'Save successful query as a reusable template',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'execute-lql',
        description: 'Execute a raw LQL query directly',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Raw LQL query to execute',
            },
            startTime: {
              type: 'string',
              description: 'Start time for the query (ISO 8601 format)',
            },
            endTime: {
              type: 'string',
              description: 'End time for the query (ISO 8601 format)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'list-templates',
        description: 'List all available LQL templates organized by category',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter templates by category (compliance, threats, inventory, custom)',
            },
          },
        },
      },
    ];
  }

  private async checkLaceworkStatus() {
    try {
      const status = await this.laceworkHandler.getStatus();
      return {
        content: [
          {
            type: 'text',
            text: `Lacework Status:\n${JSON.stringify(status, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Lacework Status Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleNaturalLanguageQuery(args: any) {
    try {
      console.error(`🧠 Processing natural language query: "${args.query}"`);
      
      // Step 1: Convert natural language to LQL
      const lqlQuery = await this.lqlGenerator.generateFromNaturalLanguage(args.query);
      console.error(`🔧 Generated LQL: ${lqlQuery.query}`);
      
      // Step 2: Execute the query
      const result = await this.laceworkHandler.executeQuery({
        query: lqlQuery.query,
        startTime: args.startTime || lqlQuery.timeRange?.start,
        endTime: args.endTime || lqlQuery.timeRange?.end,
      });

      // Step 3: Save as template if requested and successful
      if (args.saveAsTemplate && result.data && result.data.length > 0) {
        await this.templateManager.saveTemplate({
          name: lqlQuery.suggestedName,
          description: args.query,
          query: lqlQuery.query,
          category: lqlQuery.category,
          parameters: lqlQuery.parameters,
        });
        console.error(`📝 Saved query as template: ${lqlQuery.suggestedName}`);
      }

      // Step 4: Dynamically register tool for future use
      if (result.data && result.data.length > 0) {
        await this.toolRegistry.registerToolFromQuery(lqlQuery, args.query);
        console.error(`🔧 Registered dynamic tool for future use`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Natural Language Query: "${args.query}"\n\nGenerated LQL: ${lqlQuery.query}\n\nResults:\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Natural Language Query Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async executeLQL(args: any) {
    try {
      const result = await this.laceworkHandler.executeQuery({
        query: args.query,
        startTime: args.startTime,
        endTime: args.endTime,
      });

      return {
        content: [
          {
            type: 'text',
            text: `LQL Query: ${args.query}\n\nResults:\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `LQL Execution Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async listTemplates(args?: any) {
    try {
      const templates = await this.templateManager.getTemplates(args?.category);
      return {
        content: [
          {
            type: 'text',
            text: `Available LQL Templates:\n${JSON.stringify(templates, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Template Listing Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async start() {
    console.error('🚀 Lacework MCP Server starting...');
    console.error('📊 Environment:', {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      pid: process.pid
    });
    
    try {
      // Initialize components BEFORE MCP connection
      console.error('🔧 Initializing server components...');
      try {
        await this.laceworkHandler.initialize();
        console.error('✅ Lacework handler initialized');
      } catch (error) {
        console.error('⚠️  Lacework handler initialization failed:', error.message);
        console.error('Lacework init error stack:', error.stack);
      }
      
      try {
        await this.templateManager.initialize();
        console.error('✅ Template manager initialized');
      } catch (error) {
        console.error('⚠️  Template manager initialization failed:', error.message);
        console.error('Template manager init error stack:', error.stack);
      }
      
      // Check Lacework availability (non-blocking)
      console.error('🔍 Checking Lacework CLI availability...');
      try {
        const status = await this.laceworkHandler.getStatus();
        console.error('Lacework status:', JSON.stringify(status, null, 2));
        if (status.cliAvailable && status.authenticated) {
          console.error('✅ Lacework CLI detected and authenticated');
        } else {
          console.error('⚠️  Lacework CLI not fully configured - server will still function with limited capabilities');
        }
      } catch (error) {
        console.error('⚠️  Lacework status check failed:', error.message);
        console.error('Lacework status error stack:', error.stack);
      }

      // Start MCP server AFTER initialization is complete
      console.error('🔌 About to connect to MCP transport...');
      console.error('📡 Creating StdioServerTransport...');
      const transport = new StdioServerTransport();
      console.error('🤝 Attempting server.connect...');
      
      await this.server.connect(transport);
      
      console.error('🎯 Lacework MCP Server ready for natural language queries!');
      console.error('📞 Server is now listening for client connections via stdio');
      
    } catch (error) {
      console.error('❌ Server startup failed:', error.message);
      console.error('💥 Full error object:', error);
      console.error('📚 Stack trace:', error.stack);
      console.error('🔍 Additional error details:', {
        name: error.name,
        code: error.code,
        cause: error.cause
      });
      process.exit(1);
    }
  }
}

// Start the server
const server = new LaceworkMCPServer();
server.start().catch(console.error);