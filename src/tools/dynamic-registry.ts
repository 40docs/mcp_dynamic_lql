import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { LaceworkHandler } from '../lacework/cli-handler.js';
import { LQLGenerator, LQLQueryResult } from '../generators/lql-generator.js';
import { TemplateManager, LQLTemplate } from '../templates/template-manager.js';

export interface DynamicTool extends Tool {
  generator: (args: any) => Promise<any>;
  template?: LQLTemplate;
  queryPattern?: LQLQueryResult;
  created: string;
  lastUsed?: string;
  usageCount: number;
}

export interface ToolGenerationRequest {
  naturalLanguage: string;
  suggestedName?: string;
  category?: string;
}

export class DynamicToolRegistry {
  private tools: Map<string, DynamicTool> = new Map();
  private laceworkHandler: LaceworkHandler;
  private lqlGenerator: LQLGenerator;
  private templateManager: TemplateManager;

  constructor(
    laceworkHandler: LaceworkHandler,
    lqlGenerator: LQLGenerator,
    templateManager: TemplateManager
  ) {
    this.laceworkHandler = laceworkHandler;
    this.lqlGenerator = lqlGenerator;
    this.templateManager = templateManager;
  }

  async getDynamicTools(): Promise<Tool[]> {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async generateToolFromQuery(toolName: string, args: any): Promise<boolean> {
    try {
      console.error(`🔧 Attempting to generate dynamic tool: ${toolName}`);
      
      // Try to infer the natural language intent from the tool name and args
      const naturalLanguage = this.inferNaturalLanguage(toolName, args);
      
      if (!naturalLanguage) {
        console.error(`❌ Could not infer natural language intent for: ${toolName}`);
        return false;
      }

      console.error(`🧠 Inferred intent: "${naturalLanguage}"`);
      
      // Generate LQL query from natural language
      const lqlQuery = await this.lqlGenerator.generateFromNaturalLanguage(naturalLanguage);
      
      // Create the dynamic tool
      const tool = await this.createDynamicTool({
        name: toolName,
        naturalLanguage,
        lqlQuery,
      });

      if (tool) {
        this.tools.set(toolName, tool);
        console.error(`✅ Generated and registered dynamic tool: ${toolName}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`❌ Failed to generate tool ${toolName}:`, error.message);
      return false;
    }
  }

  async registerToolFromQuery(lqlQuery: LQLQueryResult, originalQuery: string): Promise<void> {
    // Generate a tool name based on the query
    const toolName = this.generateToolName(originalQuery, lqlQuery.category);
    
    // Check if tool already exists
    if (this.tools.has(toolName)) {
      console.error(`🔧 Tool ${toolName} already exists, updating usage stats`);
      const existingTool = this.tools.get(toolName)!;
      existingTool.lastUsed = new Date().toISOString();
      existingTool.usageCount++;
      return;
    }

    // Create the dynamic tool
    const tool = await this.createDynamicTool({
      name: toolName,
      naturalLanguage: originalQuery,
      lqlQuery,
    });

    if (tool) {
      this.tools.set(toolName, tool);
      console.error(`🔧 Auto-registered tool: ${toolName} for future use`);
    }
  }

  private async createDynamicTool(request: {
    name: string;
    naturalLanguage: string;
    lqlQuery: LQLQueryResult;
  }): Promise<DynamicTool | null> {
    try {
      const { name, naturalLanguage, lqlQuery } = request;

      const tool: DynamicTool = {
        name,
        description: `Dynamically generated tool: ${naturalLanguage}`,
        inputSchema: this.generateInputSchema(lqlQuery),
        generator: async (args: any) => {
          return await this.executeDynamicQuery(lqlQuery, args, naturalLanguage);
        },
        queryPattern: lqlQuery,
        created: new Date().toISOString(),
        usageCount: 0,
      };

      return tool;
    } catch (error) {
      console.error(`Failed to create dynamic tool:`, error.message);
      return null;
    }
  }

  private generateInputSchema(lqlQuery: LQLQueryResult): any {
    const properties: Record<string, any> = {
      startTime: {
        type: 'string',
        description: 'Start time for the query (ISO 8601 format, optional)',
      },
      endTime: {
        type: 'string',
        description: 'End time for the query (ISO 8601 format, optional)',
      },
    };

    // Add parameter-specific properties based on the query
    Object.entries(lqlQuery.parameters).forEach(([key, value]) => {
      switch (key) {
        case 'severity':
          properties.severity = {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Filter by severity level',
          };
          break;
        case 'cloud_provider':
          properties.cloudProvider = {
            type: 'string',
            enum: ['aws', 'gcp', 'azure'],
            description: 'Filter by cloud provider',
          };
          break;
        case 'region':
          properties.region = {
            type: 'string',
            description: 'Filter by cloud region',
          };
          break;
        case 'status':
          properties.status = {
            type: 'string',
            enum: ['active', 'inactive', 'fail', 'pass'],
            description: 'Filter by status',
          };
          break;
        case 'resource_type':
          properties.resourceType = {
            type: 'string',
            description: 'Filter by resource type',
          };
          break;
        default:
          properties[key] = {
            type: 'string',
            description: `Filter by ${key}`,
          };
      }
    });

    return {
      type: 'object',
      properties,
      required: [],
    };
  }

  private async executeDynamicQuery(
    lqlQuery: LQLQueryResult,
    args: any,
    originalDescription: string
  ): Promise<any> {
    try {
      // Update usage stats
      const toolName = this.generateToolName(originalDescription, lqlQuery.category);
      const tool = this.tools.get(toolName);
      if (tool) {
        tool.lastUsed = new Date().toISOString();
        tool.usageCount++;
      }

      // Build the final query with runtime parameters
      let finalQuery = lqlQuery.query;
      
      // Replace parameter placeholders or add additional WHERE conditions
      if (args.severity && !finalQuery.includes('SEVERITY')) {
        finalQuery = this.addWhereCondition(finalQuery, `SEVERITY = '${args.severity}'`);
      }
      
      if (args.cloudProvider && !finalQuery.includes('cloud_provider')) {
        // This would need to be mapped to actual field names
        console.error(`Note: cloudProvider filter not implemented in query`);
      }
      
      if (args.region && !finalQuery.includes('AWS_REGION')) {
        finalQuery = this.addWhereCondition(finalQuery, `AWS_REGION = '${args.region}'`);
      }

      // Execute the query
      const result = await this.laceworkHandler.executeQuery({
        query: finalQuery,
        startTime: args.startTime || lqlQuery.timeRange?.start,
        endTime: args.endTime || lqlQuery.timeRange?.end,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Dynamic Tool Execution: "${originalDescription}"\n\nGenerated LQL: ${finalQuery}\n\nResults:\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Dynamic Tool Execution Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private addWhereCondition(query: string, condition: string): string {
    if (query.includes('WHERE')) {
      // Add AND condition
      return query.replace(/ORDER BY/, `  AND ${condition}\nORDER BY`);
    } else {
      // Add WHERE clause
      return query.replace(/ORDER BY/, `WHERE ${condition}\nORDER BY`);
    }
  }

  async executeTool(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (tool) {
      return await tool.generator(args);
    }
    return null;
  }

  private inferNaturalLanguage(toolName: string, args: any): string | null {
    // Convert tool names back to natural language
    const patterns = [
      // AWS patterns
      { regex: /get[-_]?aws[-_]?(.*?)[-_]?(?:with|having)[-_]?(.*)/, template: 'show me AWS $1 with $2' },
      { regex: /list[-_]?aws[-_]?(.*)/, template: 'list all AWS $1' },
      { regex: /find[-_]?aws[-_]?(.*)/, template: 'find AWS $1' },
      { regex: /get[-_]?aws[-_]?(.*)/, template: 'show me AWS $1' },
      
      // Generic security patterns
      { regex: /get[-_]?(high|critical)[-_]?(.*?)[-_]?(vulnerabilit|risk|threat)/, template: 'show me $1 $2 $3' },
      { regex: /list[-_]?(.*?)[-_]?(fail|violation)s?/, template: 'list all $1 $2' },
      { regex: /find[-_]?(.*?)[-_]?(compliance|security)/, template: 'find $1 $2 issues' },
      
      // Container patterns
      { regex: /get[-_]?container[-_]?(.*)/, template: 'show me container $1' },
      { regex: /list[-_]?k8s[-_]?(.*)/, template: 'list kubernetes $1' },
      
      // Generic patterns
      { regex: /get[-_]?(.*)[-_]?with[-_]?(.*)/, template: 'show me $1 with $2' },
      { regex: /list[-_]?(.*)/, template: 'list all $1' },
      { regex: /find[-_]?(.*)/, template: 'find $1' },
    ];

    for (const { regex, template } of patterns) {
      const match = toolName.match(regex);
      if (match) {
        let result = template;
        for (let i = 1; i < match.length; i++) {
          const replacement = match[i].replace(/[-_]/g, ' ').trim();
          result = result.replace(`$${i}`, replacement);
        }
        return result;
      }
    }

    // If no pattern matches, try to construct from args
    if (args && args.query) {
      return args.query;
    }

    // Last resort: convert tool name to readable form
    return toolName
      .replace(/[-_]/g, ' ')
      .replace(/^(get|list|find|show)\s+/, 'show me ')
      .trim();
  }

  private generateToolName(description: string, category: string): string {
    // Generate a consistent tool name from natural language
    const words = description
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !['show', 'get', 'find', 'list', 'with', 'that', 'have', 'the', 'and', 'for', 'me', 'all'].includes(word));
    
    const prefix = category === 'aws' ? 'get-aws' :
                  category === 'containers' ? 'get-container' :
                  category === 'compliance' ? 'get-compliance' :
                  category === 'threats' ? 'find-threat' :
                  'get';
    
    const suffix = words.slice(0, 3).join('-');
    return `${prefix}-${suffix}`;
  }

  // Tool management methods
  async getToolUsageStats(): Promise<Array<{ name: string; usageCount: number; lastUsed?: string }>> {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      usageCount: tool.usageCount,
      lastUsed: tool.lastUsed,
    }));
  }

  async pruneUnusedTools(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let prunedCount = 0;

    for (const [name, tool] of this.tools.entries()) {
      const lastUsed = tool.lastUsed ? new Date(tool.lastUsed).getTime() : new Date(tool.created).getTime();
      
      if (now - lastUsed > maxAge && tool.usageCount === 0) {
        this.tools.delete(name);
        prunedCount++;
      }
    }

    console.error(`🧹 Pruned ${prunedCount} unused dynamic tools`);
    return prunedCount;
  }

  async exportTools(): Promise<DynamicTool[]> {
    return Array.from(this.tools.values());
  }

  async importTools(tools: DynamicTool[]): Promise<void> {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
    console.error(`📥 Imported ${tools.length} dynamic tools`);
  }
}