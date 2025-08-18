import { LaceworkHandler } from '../lacework/cli-handler.js';

export interface DataSourceInfo {
  name: string;
  category: string;
  description: string;
  fields?: FieldInfo[];
  sampleData?: any[];
}

export interface FieldInfo {
  name: string;
  type: string;
  description?: string;
  sampleValues?: string[];
  nullable?: boolean;
}

export interface DrillDownRequest {
  pattern?: string;
  category?: string;
  provider?: string;
  limit?: number;
}

export class DataSourceExplorer {
  private laceworkHandler: LaceworkHandler;
  private dataSourceCache: Map<string, DataSourceInfo> = new Map();
  private fieldCache: Map<string, FieldInfo[]> = new Map();
  private lastDiscovery: Date | null = null;
  private cacheTimeout = 30 * 60 * 1000; // 30 minutes

  constructor(laceworkHandler: LaceworkHandler) {
    this.laceworkHandler = laceworkHandler;
  }

  async discoverDataSources(request: DrillDownRequest = {}): Promise<DataSourceInfo[]> {
    try {
      console.error('🔍 Discovering Lacework data sources...');
      
      // Check cache first
      if (this.shouldUseCache()) {
        console.error('📦 Using cached data sources');
        return this.getCachedDataSources(request);
      }

      // Get base data sources from Lacework CLI
      const baseSources = await this.laceworkHandler.getDataSources();
      console.error(`📊 Found ${baseSources.length} base data sources`);

      // Categorize and enhance data sources
      const enhancedSources: DataSourceInfo[] = [];
      
      for (const sourceName of baseSources) {
        const info = this.categorizeDataSource(sourceName);
        if (this.matchesFilter(info, request)) {
          enhancedSources.push(info);
          this.dataSourceCache.set(sourceName, info);
        }
      }

      // Add known sources that might not be returned by list-sources
      const knownSources = this.getKnownDataSources();
      for (const known of knownSources) {
        if (this.matchesFilter(known, request) && !enhancedSources.find(s => s.name === known.name)) {
          enhancedSources.push(known);
          this.dataSourceCache.set(known.name, known);
        }
      }

      this.lastDiscovery = new Date();
      
      console.error(`✅ Discovered ${enhancedSources.length} categorized data sources`);
      return enhancedSources;
    } catch (error) {
      console.error('❌ Data source discovery failed:', error.message);
      return this.getKnownDataSources().filter(s => this.matchesFilter(s, request));
    }
  }

  async exploreDataSource(sourceName: string): Promise<DataSourceInfo | null> {
    try {
      console.error(`🔬 Exploring data source: ${sourceName}`);
      
      // Check cache first
      if (this.fieldCache.has(sourceName)) {
        const cached = this.dataSourceCache.get(sourceName);
        if (cached) {
          cached.fields = this.fieldCache.get(sourceName);
          return cached;
        }
      }

      // Get basic info
      let info = this.dataSourceCache.get(sourceName) || this.categorizeDataSource(sourceName);
      
      // Discover fields by running a sample query
      const fields = await this.discoverFields(sourceName);
      info.fields = fields;
      
      // Cache the results
      this.dataSourceCache.set(sourceName, info);
      this.fieldCache.set(sourceName, fields);
      
      console.error(`🔍 Discovered ${fields.length} fields for ${sourceName}`);
      return info;
    } catch (error) {
      console.error(`❌ Failed to explore data source ${sourceName}:`, error.message);
      return this.dataSourceCache.get(sourceName) || null;
    }
  }

  async discoverFields(sourceName: string): Promise<FieldInfo[]> {
    try {
      // Build a sample query to discover schema
      const sampleQuery = `{
  source {
    ${sourceName}
  }
  return distinct {
    *
  }
}`;

      console.error(`📋 Running schema discovery query for ${sourceName}`);
      
      const result = await this.laceworkHandler.executeQuery({
        query: sampleQuery,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
        endTime: new Date().toISOString()
      });

      const fields: FieldInfo[] = [];
      
      if (result.data && result.data.length > 0) {
        const sample = result.data[0];
        
        for (const [fieldName, value] of Object.entries(sample)) {
          const fieldInfo: FieldInfo = {
            name: fieldName,
            type: this.inferFieldType(value),
            nullable: value === null || value === undefined,
            sampleValues: this.extractSampleValues(fieldName, result.data.slice(0, 5))
          };
          
          // Add description based on field name patterns
          fieldInfo.description = this.generateFieldDescription(fieldName, sourceName);
          
          fields.push(fieldInfo);
        }
      } else {
        // Fall back to known field mappings
        fields.push(...this.getKnownFields(sourceName));
      }

      return fields.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error(`❌ Field discovery failed for ${sourceName}:`, error.message);
      return this.getKnownFields(sourceName);
    }
  }

  async searchDataSources(query: string): Promise<DataSourceInfo[]> {
    const allSources = await this.discoverDataSources();
    const searchTerms = query.toLowerCase().split(/\s+/);
    
    return allSources.filter(source => {
      const searchableText = `${source.name} ${source.category} ${source.description}`.toLowerCase();
      return searchTerms.some(term => searchableText.includes(term));
    }).sort((a, b) => {
      // Sort by relevance - exact matches first, then partial matches
      const aExact = a.name.toLowerCase().includes(query.toLowerCase());
      const bExact = b.name.toLowerCase().includes(query.toLowerCase());
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async findFieldsContaining(fieldPattern: string, dataSourcePattern?: string): Promise<Array<{source: string, fields: FieldInfo[]}>> {
    const sources = await this.discoverDataSources();
    const results: Array<{source: string, fields: FieldInfo[]}> = [];
    
    for (const source of sources) {
      if (dataSourcePattern && !source.name.toLowerCase().includes(dataSourcePattern.toLowerCase())) {
        continue;
      }
      
      const sourceInfo = await this.exploreDataSource(source.name);
      if (sourceInfo?.fields) {
        const matchingFields = sourceInfo.fields.filter(field => 
          field.name.toLowerCase().includes(fieldPattern.toLowerCase()) ||
          (field.description && field.description.toLowerCase().includes(fieldPattern.toLowerCase()))
        );
        
        if (matchingFields.length > 0) {
          results.push({
            source: source.name,
            fields: matchingFields
          });
        }
      }
    }
    
    return results;
  }

  private shouldUseCache(): boolean {
    if (!this.lastDiscovery) return false;
    return (Date.now() - this.lastDiscovery.getTime()) < this.cacheTimeout;
  }

  private getCachedDataSources(request: DrillDownRequest): DataSourceInfo[] {
    return Array.from(this.dataSourceCache.values()).filter(s => this.matchesFilter(s, request));
  }

  private matchesFilter(source: DataSourceInfo, request: DrillDownRequest): boolean {
    if (request.pattern && !source.name.toLowerCase().includes(request.pattern.toLowerCase())) {
      return false;
    }
    
    if (request.category && !source.category.toLowerCase().includes(request.category.toLowerCase())) {
      return false;
    }
    
    if (request.provider) {
      const providerLower = request.provider.toLowerCase();
      if (!source.name.toLowerCase().includes(providerLower) && 
          !source.category.toLowerCase().includes(providerLower)) {
        return false;
      }
    }
    
    return true;
  }

  private categorizeDataSource(sourceName: string): DataSourceInfo {
    const name = sourceName.toUpperCase();
    
    // AWS Sources
    if (name.includes('AWS') || name.includes('LW_CFG_AWS')) {
      return {
        name: sourceName,
        category: 'AWS',
        description: this.generateDescription(sourceName, 'AWS')
      };
    }
    
    // Azure Sources  
    if (name.includes('AZURE') || name.includes('LW_CFG_AZURE')) {
      return {
        name: sourceName,
        category: 'Azure', 
        description: this.generateDescription(sourceName, 'Azure')
      };
    }
    
    // GCP Sources
    if (name.includes('GCP') || name.includes('GOOGLE') || name.includes('LW_CFG_GCP')) {
      return {
        name: sourceName,
        category: 'GCP',
        description: this.generateDescription(sourceName, 'GCP')
      };
    }
    
    // Container Sources
    if (name.includes('CONTAINER') || name.includes('VULN') || name.includes('IMAGE')) {
      return {
        name: sourceName,
        category: 'Containers',
        description: this.generateDescription(sourceName, 'Container')
      };
    }
    
    // Kubernetes Sources
    if (name.includes('K8S') || name.includes('KUBERNETES')) {
      return {
        name: sourceName,
        category: 'Kubernetes',
        description: this.generateDescription(sourceName, 'Kubernetes')
      };
    }
    
    // Compliance Sources
    if (name.includes('COMPLIANCE') || name.includes('CIS')) {
      return {
        name: sourceName,
        category: 'Compliance',
        description: this.generateDescription(sourceName, 'Compliance')
      };
    }
    
    // Network Sources
    if (name.includes('NETWORK') || name.includes('CONNECTION')) {
      return {
        name: sourceName,
        category: 'Network',
        description: this.generateDescription(sourceName, 'Network')
      };
    }
    
    // Activity/Audit Sources
    if (name.includes('ACTIVITY') || name.includes('AUDIT') || name.includes('CLOUDTRAIL')) {
      return {
        name: sourceName,
        category: 'Activity',
        description: this.generateDescription(sourceName, 'Activity')
      };
    }
    
    // Default
    return {
      name: sourceName,
      category: 'General',
      description: `Lacework data source: ${sourceName}`
    };
  }

  private generateDescription(sourceName: string, category: string): string {
    const name = sourceName.toUpperCase();
    
    // AWS specific descriptions
    if (category === 'AWS') {
      if (name.includes('EC2')) return 'AWS EC2 instances configuration and state';
      if (name.includes('S3')) return 'AWS S3 buckets configuration and access policies';
      if (name.includes('IAM')) return 'AWS IAM users, roles, and policies';
      if (name.includes('LAMBDA')) return 'AWS Lambda functions configuration';
      if (name.includes('RDS')) return 'AWS RDS database instances';
      if (name.includes('CLOUDTRAIL')) return 'AWS CloudTrail API activity logs';
      if (name.includes('VPC')) return 'AWS VPC networking configuration';
      if (name.includes('SECURITY')) return 'AWS security groups and NACLs';
    }
    
    // Azure specific descriptions
    if (category === 'Azure') {
      if (name.includes('COMPUTE')) return 'Azure compute resources and virtual machines';
      if (name.includes('STORAGE')) return 'Azure storage accounts and blob containers';
      if (name.includes('NETWORK')) return 'Azure virtual networks and security groups';
      if (name.includes('DATABASE')) return 'Azure database services';
    }
    
    // Container specific descriptions
    if (category === 'Container') {
      if (name.includes('VULN')) return 'Container vulnerability scan results';
      if (name.includes('IMAGE')) return 'Container image metadata and layers';
    }
    
    return `${category} data source: ${sourceName}`;
  }

  private generateFieldDescription(fieldName: string, sourceName: string): string {
    const field = fieldName.toUpperCase();
    
    // Common field patterns
    if (field.includes('ID')) return 'Unique identifier';
    if (field.includes('TIME')) return 'Timestamp field';
    if (field.includes('REGION')) return 'Cloud region location';
    if (field.includes('ACCOUNT')) return 'Cloud account identifier';
    if (field.includes('USER')) return 'User or principal name';
    if (field.includes('RESOURCE')) return 'Resource identifier or configuration';
    if (field.includes('ERROR')) return 'Error code or message';
    if (field.includes('STATUS')) return 'Status or state field';
    if (field.includes('SEVERITY')) return 'Severity level';
    if (field.includes('SCORE')) return 'Risk or priority score';
    if (field.includes('CONFIG')) return 'Configuration data';
    if (field.includes('EVENT')) return 'Event data or name';
    if (field.includes('SOURCE')) return 'Event or data source';
    if (field.includes('IP')) return 'IP address';
    if (field.includes('PORT')) return 'Network port';
    if (field.includes('PROTOCOL')) return 'Network protocol';
    
    return `Field from ${sourceName}`;
  }

  private inferFieldType(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
    if (typeof value === 'string') {
      // Check for common patterns
      if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) return 'timestamp';
      if (value.match(/^\d+\.\d+\.\d+\.\d+$/)) return 'ip_address';
      if (value.match(/^arn:aws:/)) return 'aws_arn';
      return 'string';
    }
    if (typeof value === 'object') return 'object';
    return 'unknown';
  }

  private extractSampleValues(fieldName: string, data: any[]): string[] {
    const values = data
      .map(item => item[fieldName])
      .filter(val => val !== null && val !== undefined)
      .map(val => String(val).substring(0, 50)) // Truncate long values
      .slice(0, 3); // Max 3 samples
    
    return [...new Set(values)]; // Remove duplicates
  }

  private getKnownDataSources(): DataSourceInfo[] {
    return [
      {
        name: 'LW_CFG_AWS_EC2_INSTANCES',
        category: 'AWS',
        description: 'AWS EC2 instances configuration and state'
      },
      {
        name: 'LW_CFG_AWS_S3',
        category: 'AWS', 
        description: 'AWS S3 buckets configuration and policies'
      },
      {
        name: 'LW_CFG_AZURE_COMPUTE_VIRTUALMACHINES',
        category: 'Azure',
        description: 'Azure virtual machines configuration'
      },
      {
        name: 'CloudTrailRawEvents',
        category: 'Activity',
        description: 'AWS CloudTrail API activity events'
      },
      {
        name: 'ContainerVulnDetails',
        category: 'Containers',
        description: 'Container vulnerability scan results'
      },
      {
        name: 'ComplianceEvaluationDetails',
        category: 'Compliance', 
        description: 'Compliance policy evaluation results'
      }
    ];
  }

  private getKnownFields(sourceName: string): FieldInfo[] {
    const knownFields: Record<string, FieldInfo[]> = {
      'LW_CFG_AWS_EC2_INSTANCES': [
        { name: 'RESOURCE_ID', type: 'string', description: 'EC2 instance ID' },
        { name: 'RESOURCE_REGION', type: 'string', description: 'AWS region' },
        { name: 'ACCOUNT_ID', type: 'string', description: 'AWS account ID' },
        { name: 'RESOURCE_CONFIG', type: 'object', description: 'Instance configuration' },
        { name: 'URN', type: 'string', description: 'Unique resource identifier' }
      ],
      'LW_CFG_AZURE_COMPUTE_VIRTUALMACHINES': [
        { name: 'RESOURCE_ID', type: 'string', description: 'Azure VM resource ID' },
        { name: 'RESOURCE_REGION', type: 'string', description: 'Azure region' },
        { name: 'SUBSCRIPTION_ID', type: 'string', description: 'Azure subscription ID' },
        { name: 'RESOURCE_CONFIG', type: 'object', description: 'VM configuration' },
        { name: 'RESOURCE_GROUP', type: 'string', description: 'Azure resource group' }
      ],
      'CloudTrailRawEvents': [
        { name: 'EVENT_TIME', type: 'timestamp', description: 'Event timestamp' },
        { name: 'EVENT_NAME', type: 'string', description: 'API call name' },
        { name: 'EVENT_SOURCE', type: 'string', description: 'AWS service' },
        { name: 'ERROR_CODE', type: 'string', description: 'Error code if failed' },
        { name: 'USER_NAME', type: 'string', description: 'User or role name' }
      ]
    };
    
    return knownFields[sourceName] || [];
  }
}