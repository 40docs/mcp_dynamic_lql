import { DataSourceExplorer, DataSourceInfo, FieldInfo } from '../explorers/data-source-explorer.js';
import { LQLQueryResult } from '../generators/lql-generator.js';

export interface QueryBuildRequest {
  intent: string;
  dataSource?: string;
  filters?: Record<string, any>;
  fields?: string[];
  limit?: number;
  timeRange?: {
    start?: string;
    end?: string;
  };
}

export interface DrillDownQuery {
  target: 'datasources' | 'fields' | 'values';
  pattern?: string;
  source?: string;
  field?: string;
  filters?: Record<string, any>;
}

export class QueryBuilder {
  private dataSourceExplorer: DataSourceExplorer;

  constructor(dataSourceExplorer: DataSourceExplorer) {
    this.dataSourceExplorer = dataSourceExplorer;
  }

  async buildDrillDownQuery(request: DrillDownQuery): Promise<LQLQueryResult> {
    console.error(`🔍 Building drill-down query for: ${request.target}`);
    
    switch (request.target) {
      case 'datasources':
        return await this.buildDataSourceListQuery(request);
      case 'fields':
        return await this.buildFieldDiscoveryQuery(request);
      case 'values':
        return await this.buildValueExplorationQuery(request);
      default:
        throw new Error(`Unknown drill-down target: ${request.target}`);
    }
  }

  async buildTargetedQuery(request: QueryBuildRequest): Promise<LQLQueryResult> {
    console.error(`🎯 Building targeted query: ${request.intent}`);
    
    // If no data source specified, try to infer from intent
    let dataSource = request.dataSource;
    if (!dataSource) {
      const sources = await this.dataSourceExplorer.searchDataSources(request.intent);
      if (sources.length > 0) {
        dataSource = sources[0].name;
        console.error(`🤖 Auto-selected data source: ${dataSource}`);
      }
    }

    if (!dataSource) {
      throw new Error('Unable to determine appropriate data source for query');
    }

    // Explore the data source to get field information
    const sourceInfo = await this.dataSourceExplorer.exploreDataSource(dataSource);
    if (!sourceInfo) {
      throw new Error(`Unable to explore data source: ${dataSource}`);
    }

    // Build the query
    const query = this.constructLQLQuery({
      dataSource,
      sourceInfo,
      request
    });

    return {
      query,
      category: this.categorizeQuery(request.intent, sourceInfo.category),
      suggestedName: this.generateQueryName(request.intent, dataSource),
      parameters: request.filters || {},
      timeRange: request.timeRange && request.timeRange.start && request.timeRange.end ? {
        start: request.timeRange.start,
        end: request.timeRange.end
      } : undefined,
      confidence: 0.9
    };
  }

  private async buildDataSourceListQuery(request: DrillDownQuery): Promise<LQLQueryResult> {
    // This isn't actually an LQL query - it's a meta query to list data sources
    const query = `-- Data Source Discovery Query
-- Pattern: ${request.pattern || 'all'}
-- This will be handled by the explorer, not executed as LQL`;

    return {
      query,
      category: 'discovery',
      suggestedName: 'list-data-sources',
      parameters: { pattern: request.pattern },
      confidence: 1.0
    };
  }

  private async buildFieldDiscoveryQuery(request: DrillDownQuery): Promise<LQLQueryResult> {
    if (!request.source) {
      throw new Error('Data source required for field discovery');
    }

    // Build a sample query to discover fields
    const query = `{
  source {
    ${request.source} r
  }
  return distinct {
    r.RESOURCE_REGION
  }
}`;

    return {
      query,
      category: 'discovery',
      suggestedName: `explore-${request.source.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      parameters: { source: request.source, field_pattern: request.pattern },
      confidence: 0.95
    };
  }

  private async buildValueExplorationQuery(request: DrillDownQuery): Promise<LQLQueryResult> {
    if (!request.source || !request.field) {
      throw new Error('Both data source and field required for value exploration');
    }

    // Build a query to explore distinct values in a field
    const query = `{
  source {
    ${request.source} r
  }
  return distinct {
    r.${request.field}
  }
}`;

    return {
      query,
      category: 'discovery',
      suggestedName: `values-${request.field.toLowerCase()}`,
      parameters: { 
        source: request.source, 
        field: request.field,
        ...request.filters 
      },
      confidence: 0.95
    };
  }

  private constructLQLQuery(params: {
    dataSource: string;
    sourceInfo: DataSourceInfo;
    request: QueryBuildRequest;
  }): string {
    const { dataSource, sourceInfo, request } = params;

    // Start building the query in the correct LQL format with source block and alias
    let query = `{\n  source {\n    ${dataSource} r\n  }`;

    // Add filters if provided
    if (request.filters && Object.keys(request.filters).length > 0) {
      const filterConditions = this.buildFilterConditions(request.filters, sourceInfo);
      if (filterConditions.length > 0) {
        query += `\n  filter {\n    ${filterConditions.join('\n    and ')}\n  }`;
      }
    }

    // Add return fields
    const returnFields = this.determineReturnFields(request.fields, sourceInfo);
    query += `\n  return distinct {\n    ${returnFields.join(',\n    ')}\n  }`;

    query += '\n}';

    return query;
  }

  private buildFilterConditions(filters: Record<string, any>, sourceInfo: DataSourceInfo): string[] {
    const conditions: string[] = [];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;

      // Map filter key to actual field name
      const fieldName = this.mapFilterToField(key, sourceInfo);
      
      // Handle special "not" filters
      if (key.endsWith('_not')) {
        const baseFieldName = this.mapFilterToField(key.replace('_not', ''), sourceInfo);
        if (Array.isArray(value)) {
          // Handle array values with AND NOT - each value needs its own NOT condition
          const notConditions = value.map(v => `not r.${baseFieldName} = '${v}'`).join('\n    and ');
          conditions.push(notConditions);
        } else {
          conditions.push(`not r.${baseFieldName} = '${value}'`);
        }
      } else if (Array.isArray(value)) {
        // Handle array values with OR
        const orConditions = value.map(v => `r.${fieldName} = '${v}'`).join(' or ');
        conditions.push(`(${orConditions})`);
      } else if (typeof value === 'string' && value.includes('*')) {
        // Handle wildcards
        conditions.push(`r.${fieldName} like '${value.replace(/\*/g, '%')}'`);
      } else if (typeof value === 'string' && (value.startsWith('>=') || value.startsWith('<='))) {
        // Handle comparison operators
        conditions.push(`r.${fieldName} ${value}`);
      } else {
        // Handle exact match
        conditions.push(`r.${fieldName} = '${value}'`);
      }
    }

    return conditions;
  }

  private mapFilterToField(filterKey: string, sourceInfo: DataSourceInfo): string {
    // Direct field name mapping
    if (sourceInfo.fields) {
      const directMatch = sourceInfo.fields.find(f => 
        f.name.toLowerCase() === filterKey.toLowerCase()
      );
      if (directMatch) return directMatch.name;

      // Partial match
      const partialMatch = sourceInfo.fields.find(f => 
        f.name.toLowerCase().includes(filterKey.toLowerCase()) ||
        (f.description && f.description.toLowerCase().includes(filterKey.toLowerCase()))
      );
      if (partialMatch) return partialMatch.name;
    }

    // Common field mappings
    const commonMappings: Record<string, string> = {
      'region': 'RESOURCE_REGION',
      'account': 'ACCOUNT_ID',
      'subscription': 'SUBSCRIPTION_ID',
      'time': 'EVENT_TIME',
      'user': 'USER_NAME',
      'error': 'ERROR_CODE',
      'severity': 'SEVERITY',
      'status': 'STATUS',
      'id': 'RESOURCE_ID',
      'name': 'RESOURCE_NAME',
      'type': 'RESOURCE_TYPE',
      'resource_group': 'RESOURCE_GROUP_NAME'
    };

    return commonMappings[filterKey.toLowerCase()] || filterKey.toUpperCase();
  }

  private determineReturnFields(requestedFields?: string[], sourceInfo?: DataSourceInfo): string[] {
    // If specific fields requested, use those
    if (requestedFields && requestedFields.length > 0) {
      return requestedFields;
    }

    // If we have field info from exploration, use key fields
    if (sourceInfo?.fields && sourceInfo.fields.length > 0) {
      // Return top 5-7 most important fields
      const priorityFields = sourceInfo.fields
        .sort((a, b) => this.getFieldPriority(b.name) - this.getFieldPriority(a.name))
        .slice(0, 7)
        .map(f => f.name);
      
      return priorityFields.length > 0 ? priorityFields : ['*'];
    }

    // Default fallback
    return ['*'];
  }

  private getFieldPriority(fieldName: string): number {
    const name = fieldName.toUpperCase();
    
    // High priority fields
    if (name.includes('ID') && !name.includes('DIGEST')) return 100;
    if (name.includes('TIME')) return 95;
    if (name.includes('NAME')) return 90;
    if (name.includes('TYPE')) return 85;
    if (name.includes('STATUS')) return 80;
    if (name.includes('REGION')) return 75;
    if (name.includes('ACCOUNT')) return 70;
    if (name.includes('USER')) return 65;
    if (name.includes('ERROR')) return 60;
    if (name.includes('SEVERITY')) return 55;
    if (name.includes('SCORE')) return 50;
    
    // Medium priority
    if (name.includes('SOURCE')) return 40;
    if (name.includes('EVENT')) return 35;
    if (name.includes('RESOURCE')) return 30;
    
    // Low priority - configuration and large objects
    if (name.includes('CONFIG')) return 10;
    if (name.includes('DIGEST')) return 5;
    
    return 20; // Default priority
  }

  private categorizeQuery(intent: string, sourceCategory: string): string {
    const intentLower = intent.toLowerCase();
    
    if (intentLower.includes('security') || intentLower.includes('vuln')) {
      return 'security';
    }
    if (intentLower.includes('compliance') || intentLower.includes('policy')) {
      return 'compliance';
    }
    if (intentLower.includes('performance') || intentLower.includes('resource')) {
      return 'performance';
    }
    if (intentLower.includes('discover') || intentLower.includes('explore')) {
      return 'discovery';
    }
    
    return sourceCategory.toLowerCase();
  }

  private generateQueryName(intent: string, dataSource: string): string {
    const words = intent.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !['show', 'get', 'find', 'list', 'with', 'that', 'have', 'the', 'and', 'for'].includes(word))
      .slice(0, 3);
    
    const sourceShort = dataSource.toLowerCase()
      .replace(/^lw_cfg_/, '')
      .replace(/^lw_/, '')
      .replace(/_/g, '-');
    
    return `query-${sourceShort}-${words.join('-')}`;
  }
}