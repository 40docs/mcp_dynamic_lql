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
import { DataSourceExplorer } from './explorers/data-source-explorer.js';
import { QueryBuilder } from './builders/query-builder.js';

class LaceworkMCPServer {
  private server: Server;
  private laceworkHandler: LaceworkHandler;
  private lqlGenerator: LQLGenerator;
  private templateManager: TemplateManager;
  private toolRegistry: DynamicToolRegistry;
  private dataSourceExplorer: DataSourceExplorer;
  private queryBuilder: QueryBuilder;

  constructor() {
    console.error('🔧 MCP Server constructor starting...');
    
    this.server = new Server({
      name: 'lacework-mcp-server',
      version: '1.0.0',
    });

    this.laceworkHandler = new LaceworkHandler();
    this.dataSourceExplorer = new DataSourceExplorer(this.laceworkHandler);
    this.lqlGenerator = new LQLGenerator(this.dataSourceExplorer);
    this.templateManager = new TemplateManager();
    this.queryBuilder = new QueryBuilder(this.dataSourceExplorer);
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

        if (name === 'explore-data-sources') {
          return await this.exploreDataSources(args);
        }

        if (name === 'describe-data-source') {
          return await this.describeDataSource(args);
        }

        if (name === 'discover-fields') {
          return await this.discoverFields(args);
        }

        if (name === 'build-targeted-query') {
          return await this.buildTargetedQuery(args);
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
      {
        name: 'explore-data-sources',
        description: 'Discover and explore available Lacework data sources with filtering',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Search pattern to filter data sources (e.g., "aws", "azure", "container")',
            },
            category: {
              type: 'string',
              description: 'Filter by category (AWS, Azure, GCP, Containers, Kubernetes, etc.)',
            },
            provider: {
              type: 'string',
              description: 'Filter by cloud provider (aws, azure, gcp)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
            },
          },
        },
      },
      {
        name: 'describe-data-source',
        description: 'Get detailed information about a specific data source including available fields',
        inputSchema: {
          type: 'object',
          properties: {
            dataSource: {
              type: 'string',
              description: 'Name of the data source to explore (e.g., "LW_CFG_AWS_EC2_INSTANCES")',
            },
          },
          required: ['dataSource'],
        },
      },
      {
        name: 'discover-fields',
        description: 'Find fields containing specific patterns across data sources',
        inputSchema: {
          type: 'object',
          properties: {
            fieldPattern: {
              type: 'string',
              description: 'Pattern to search for in field names (e.g., "region", "severity", "user")',
            },
            dataSourcePattern: {
              type: 'string',
              description: 'Optional pattern to filter data sources',
            },
          },
          required: ['fieldPattern'],
        },
      },
      {
        name: 'build-targeted-query',
        description: 'Build a targeted LQL query using discovered data sources and fields',
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: 'Description of what you want to find',
            },
            dataSource: {
              type: 'string',
              description: 'Specific data source to query (optional, will auto-detect if not provided)',
            },
            filters: {
              type: 'object',
              description: 'Key-value pairs for filtering (e.g., {"region": "us-east-1", "severity": "high"})',
            },
            fields: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific fields to return (optional, will auto-select if not provided)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results',
            },
          },
          required: ['intent'],
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

  private async exploreDataSources(args: any) {
    try {
      console.error(`🔍 Exploring data sources with pattern: ${args.pattern || 'all'}`);
      
      const dataSources = await this.dataSourceExplorer.discoverDataSources({
        pattern: args.pattern,
        category: args.category,
        provider: args.provider,
        limit: args.limit
      });

      const summary = dataSources.map(ds => `• ${ds.name} (${ds.category}): ${ds.description}`).join('\n');
      
      return {
        content: [
          {
            type: 'text',
            text: `Discovered ${dataSources.length} data sources:\n\n${summary}\n\nDetailed information:\n${JSON.stringify(dataSources, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Data Source Exploration Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async describeDataSource(args: any) {
    try {
      console.error(`🔬 Describing data source: ${args.dataSource}`);
      
      const sourceInfo = await this.dataSourceExplorer.exploreDataSource(args.dataSource);
      
      if (!sourceInfo) {
        return {
          content: [
            {
              type: 'text',
              text: `Data source '${args.dataSource}' not found or not accessible.`,
            },
          ],
          isError: true,
        };
      }

      const fieldSummary = sourceInfo.fields?.map(f => 
        `• ${f.name} (${f.type}): ${f.description || 'No description'}`
      ).join('\n') || 'No field information available';

      return {
        content: [
          {
            type: 'text',
            text: `Data Source: ${sourceInfo.name}\nCategory: ${sourceInfo.category}\nDescription: ${sourceInfo.description}\n\nFields (${sourceInfo.fields?.length || 0}):\n${fieldSummary}\n\nFull details:\n${JSON.stringify(sourceInfo, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Data Source Description Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async discoverFields(args: any) {
    try {
      console.error(`🔍 Discovering fields with pattern: ${args.fieldPattern}`);
      
      const results = await this.dataSourceExplorer.findFieldsContaining(
        args.fieldPattern,
        args.dataSourcePattern
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No fields found matching pattern '${args.fieldPattern}'`,
            },
          ],
        };
      }

      const summary = results.map(r => 
        `${r.source}:\n${r.fields.map(f => `  • ${f.name} (${f.type}): ${f.description || 'No description'}`).join('\n')}`
      ).join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found fields matching '${args.fieldPattern}' across ${results.length} data sources:\n\n${summary}\n\nFull details:\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Field Discovery Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async buildTargetedQuery(args: any) {
    try {
      console.error(`🎯 Building targeted query: ${args.intent}`);
      
      const queryResult = await this.queryBuilder.buildTargetedQuery({
        intent: args.intent,
        dataSource: args.dataSource,
        filters: args.filters,
        fields: args.fields,
        limit: args.limit
      });

      // Execute the query if it was built successfully
      let executionResult = null;
      try {
        executionResult = await this.laceworkHandler.executeQuery({
          query: queryResult.query,
          startTime: queryResult.timeRange?.start,
          endTime: queryResult.timeRange?.end
        });
      } catch (execError) {
        console.error('Query execution failed:', execError.message);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Targeted Query Built:\nIntent: ${args.intent}\nGenerated LQL:\n${queryResult.query}\n\nQuery Details:\n${JSON.stringify(queryResult, null, 2)}${executionResult ? `\n\nExecution Results:\n${JSON.stringify(executionResult, null, 2)}` : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Targeted Query Building Error: ${error.message}`,
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