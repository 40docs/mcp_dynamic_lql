export interface LQLQueryResult {
  query: string;
  category: string;
  suggestedName: string;
  parameters: Record<string, any>;
  timeRange?: {
    start: string;
    end: string;
  };
  confidence: number;
}

export interface DataSourceMapping {
  keywords: string[];
  lqlSource: string;
  commonFields: string[];
  description: string;
}

export class LQLGenerator {
  private dataSources: Map<string, DataSourceMapping> = new Map();
  private queryPatterns: Array<{
    pattern: RegExp;
    generator: (match: RegExpMatchArray, query: string) => Partial<LQLQueryResult>;
  }> = [];
  private dataSourceExplorer?: any; // Will be injected for dynamic discovery

  constructor(dataSourceExplorer?: any) {
    this.dataSourceExplorer = dataSourceExplorer;
    this.initializeDataSources();
    this.initializeQueryPatterns();
  }

  private initializeDataSources() {
    // AWS Data Sources
    this.dataSources.set('aws-ec2', {
      keywords: ['ec2', 'instance', 'instances', 'virtual machine', 'vm'],
      lqlSource: 'LW_CFG_AWS_EC2_INSTANCES',
      commonFields: ['RESOURCE_ID', 'RESOURCE_REGION', 'ACCOUNT_ID', 'RESOURCE_CONFIG', 'URN'],
      description: 'AWS EC2 instances configuration'
    });

    this.dataSources.set('aws-s3', {
      keywords: ['s3', 'bucket', 'storage', 'object storage'],
      lqlSource: 'LW_CFG_AWS_S3',
      commonFields: ['RESOURCE_ID', 'RESOURCE_REGION', 'ACCOUNT_ID', 'RESOURCE_CONFIG', 'URN'],
      description: 'AWS S3 buckets configuration'
    });

    this.dataSources.set('aws-cloudtrail', {
      keywords: ['cloudtrail', 'events', 'api calls', 'audit log'],
      lqlSource: 'CloudTrailRawEvents',
      commonFields: ['INSERT_ID', 'EVENT_TIME', 'EVENT_NAME', 'EVENT_SOURCE', 'ERROR_CODE'],
      description: 'AWS CloudTrail activity events'
    });

    // Container Data Sources
    this.dataSources.set('containers', {
      keywords: ['container', 'docker', 'image', 'vulnerability', 'cve'],
      lqlSource: 'ContainerVulnDetails',
      commonFields: ['IMAGE_DIGEST', 'SEVERITY', 'CVE_ID', 'NAMESPACE'],
      description: 'Container vulnerabilities and images'
    });

    // Kubernetes Data Sources
    this.dataSources.set('kubernetes', {
      keywords: ['kubernetes', 'k8s', 'pod', 'deployment', 'service'],
      lqlSource: 'KubernetesActivity',
      commonFields: ['CLUSTER_NAME', 'NAMESPACE', 'RESOURCE_TYPE', 'ACTION'],
      description: 'Kubernetes cluster activities'
    });

    // Network Data Sources  
    this.dataSources.set('network', {
      keywords: ['network', 'connection', 'traffic', 'lateral movement', 'communication'],
      lqlSource: 'NetworkActivity',
      commonFields: ['SOURCE_IP', 'DEST_IP', 'PORT', 'PROTOCOL'],
      description: 'Network communications and activities'
    });

    // User Activity
    this.dataSources.set('users', {
      keywords: ['user', 'login', 'authentication', 'access', 'identity'],
      lqlSource: 'UserActivity',
      commonFields: ['USER_NAME', 'SOURCE_IP', 'ACTION', 'STATUS'],
      description: 'User activities and authentication events'
    });
  }

  private initializeQueryPatterns() {
    // High-level patterns for common security queries
    this.queryPatterns.push(
      // Risk-based queries
      {
        pattern: /(?:show|get|find|list).*(?:high|critical).*(?:risk|score)/i,
        generator: (match, query) => ({
          category: 'risk-assessment',
          parameters: { risk_threshold: 'high', severity: 'high' },
          suggestedName: 'high-risk-assets',
        })
      },

      // Compliance queries  
      {
        pattern: /(?:compliance|cis|benchmark).*(?:fail|violation|issue)/i,
        generator: (match, query) => ({
          category: 'compliance',
          parameters: { status: 'fail' },
          suggestedName: 'compliance-violations',
        })
      },

      // Vulnerability queries
      {
        pattern: /(?:vulnerabilit|cve|security).*(?:critical|high)/i,
        generator: (match, query) => ({
          category: 'vulnerabilities',
          parameters: { severity: 'critical,high' },
          suggestedName: 'critical-vulnerabilities',
        })
      },

      // AWS-specific queries
      {
        pattern: /aws.*(?:ec2|instance).*(?:unencrypt|public|expose)/i,
        generator: (match, query) => ({
          category: 'aws-security',
          parameters: { cloud_provider: 'aws', resource_type: 'ec2' },
          suggestedName: 'aws-insecure-ec2',
        })
      },

      // Container queries
      {
        pattern: /container.*(?:vulnerabilit|cve|insecure)/i,
        generator: (match, query) => ({
          category: 'container-security',
          parameters: { resource_type: 'container' },
          suggestedName: 'container-vulnerabilities',
        })
      },

      // Lateral movement
      {
        pattern: /lateral.movement|suspicious.*network|unusual.*connection/i,
        generator: (match, query) => ({
          category: 'threat-detection',
          parameters: { activity_type: 'network', anomaly: true },
          suggestedName: 'lateral-movement-detection',
        })
      }
    );
  }

  async generateFromNaturalLanguage(naturalQuery: string): Promise<LQLQueryResult> {
    const lowerQuery = naturalQuery.toLowerCase();
    
    console.error(`🔍 Analyzing query: "${naturalQuery}"`);

    // Step 1: Determine data source
    const dataSource = await this.identifyDataSource(lowerQuery);
    console.error(`📊 Identified data source: ${dataSource?.lqlSource || 'CloudTrailRawEvents'}`);

    // Step 2: Match against query patterns
    const pattern = this.matchQueryPattern(naturalQuery);
    console.error(`🎯 Matched pattern category: ${pattern?.category || 'general'}`);

    // Step 3: Extract filters and conditions
    const filters = this.extractFilters(lowerQuery);
    console.error(`🔧 Extracted filters:`, filters);

    // Step 4: Build the LQL query
    const lqlQuery = await this.buildLQLQuery(dataSource, pattern, filters, naturalQuery);
    
    return {
      query: lqlQuery,
      category: pattern?.category || 'general',
      suggestedName: pattern?.suggestedName || this.generateName(naturalQuery),
      parameters: { ...pattern?.parameters, ...filters },
      timeRange: this.extractTimeRange(lowerQuery),
      confidence: this.calculateConfidence(dataSource, pattern, filters),
    };
  }

  private async identifyDataSource(query: string): Promise<DataSourceMapping | null> {
    // First try static mappings for fast lookup
    for (const [key, mapping] of this.dataSources.entries()) {
      for (const keyword of mapping.keywords) {
        if (query.includes(keyword)) {
          return mapping;
        }
      }
    }

    // If no static match and explorer available, try dynamic discovery
    if (this.dataSourceExplorer) {
      try {
        const discoveredSources = await this.dataSourceExplorer.searchDataSources(query);
        if (discoveredSources.length > 0) {
          const source = discoveredSources[0];
          return {
            keywords: [source.name.toLowerCase()],
            lqlSource: source.name,
            commonFields: source.fields?.map(f => f.name) || [],
            description: source.description
          };
        }
      } catch (error) {
        console.error('Dynamic data source discovery failed:', error.message);
      }
    }
    
    return null;
  }

  private matchQueryPattern(query: string): Partial<LQLQueryResult> | null {
    for (const { pattern, generator } of this.queryPatterns) {
      const match = query.match(pattern);
      if (match) {
        return generator(match, query);
      }
    }
    return null;
  }

  private extractFilters(query: string): Record<string, any> {
    const filters: Record<string, any> = {};

    // Risk/severity filters
    if (query.includes('high risk') || query.includes('high score')) {
      filters.risk_score = '>= 7';
    }
    if (query.includes('critical')) {
      filters.severity = 'critical';
    }
    if (query.includes('high') && (query.includes('severity') || query.includes('priority'))) {
      filters.severity = 'high';
    }

    // Region filters
    const regionMatch = query.match(/(?:region|in)\s+([a-z]{2}-[a-z]+-\d)/);
    if (regionMatch) {
      filters.region = regionMatch[1];
    }

    // Resource type filters
    if (query.includes('ec2')) {
      filters.resource_type = 'ec2';
    }
    if (query.includes('s3') || query.includes('bucket')) {
      filters.resource_type = 's3';
    }
    if (query.includes('container')) {
      filters.resource_type = 'container';
    }

    // Status filters
    if (query.includes('fail') || query.includes('violation')) {
      filters.status = 'fail';
    }
    if (query.includes('active') || query.includes('running')) {
      filters.status = 'active';
    }

    // Security-specific filters
    if (query.includes('unencrypt')) {
      filters.encrypted = 'false';
    }
    if (query.includes('public') || query.includes('expose')) {
      filters.public_access = 'true';
    }

    return filters;
  }

  private extractTimeRange(query: string): { start: string; end: string } | undefined {
    const now = new Date();
    const ranges = [
      { pattern: /last hour|past hour/i, hours: 1 },
      { pattern: /last 24 hours?|past 24 hours?|today/i, hours: 24 },
      { pattern: /last week|past week/i, hours: 24 * 7 },
      { pattern: /last month|past month/i, hours: 24 * 30 },
      { pattern: /last 7 days?|past 7 days?/i, hours: 24 * 7 },
      { pattern: /last 30 days?|past 30 days?/i, hours: 24 * 30 },
    ];

    for (const { pattern, hours } of ranges) {
      if (pattern.test(query)) {
        const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
        return {
          start: start.toISOString(),
          end: now.toISOString(),
        };
      }
    }

    // Default to last 24 hours for most security queries
    const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return {
      start: defaultStart.toISOString(),
      end: now.toISOString(),
    };
  }

  private async buildLQLQuery(
    dataSource: DataSourceMapping | null,
    pattern: Partial<LQLQueryResult> | null,
    filters: Record<string, any>,
    originalQuery: string
  ): Promise<string> {
    // Choose the data source
    const source = dataSource?.lqlSource || this.inferDataSourceFromQuery(originalQuery);
    
    // Start building LQL format query
    let query = `{\n  source {\n    ${source} r\n  }`;
    
    // Build filter conditions
    const filterConditions: string[] = [];
    
    // Add filter conditions
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        const fieldName = await this.mapFieldName(key, source);
        
        if (typeof value === 'string' && (value.startsWith('>=') || value.startsWith('<='))) {
          // Handle comparison operators
          const operator = value.substring(0, 2);
          const numValue = value.substring(2).trim();
          filterConditions.push(`r.${fieldName} ${operator} ${numValue}`);
        } else if (value === 'true' || value === 'false') {
          // Handle boolean values
          filterConditions.push(`r.${fieldName} = ${value}`);
        } else if (value.includes(',')) {
          // Handle multiple values - LQL uses OR syntax
          const values = value.split(',').map((v: string) => `r.${fieldName} = '${v.trim()}'`).join(' or ');
          filterConditions.push(`(${values})`);
        } else {
          // Handle single string values
          filterConditions.push(`r.${fieldName} = '${value}'`);
        }
      }
    }

    // Add query-specific conditions based on keywords
    if (originalQuery.toLowerCase().includes('fail') || originalQuery.toLowerCase().includes('failed')) {
      // For CloudTrail, look for failed events
      if (source === 'CloudTrailRawEvents') {
        filterConditions.push("r.ERROR_CODE is not null");
      }
    }
    
    if (originalQuery.toLowerCase().includes('critical')) {
      // Add critical event filters where applicable
      if (source === 'CloudTrailRawEvents') {
        filterConditions.push("(r.ERROR_CODE is not null or r.EVENT_NAME like '%Delete%' or r.EVENT_NAME like '%Terminate%')");
      }
    }

    // Add filter block if we have conditions
    if (filterConditions.length > 0) {
      query += `\n  filter {\n    ${filterConditions.join('\n    and ')}\n  }`;
    }

    // Add return block - LQL requires explicit field names
    const returnFields = this.getReturnFields(source, dataSource);
    query += `\n  return distinct {\n    ${returnFields.join(',\n    ')}\n  }\n}`;

    return query;
  }

  private getReturnFields(source: string, dataSource: DataSourceMapping | null): string[] {
    // Return common fields for the data source, or default fields based on source type
    if (dataSource && dataSource.commonFields.length > 0) {
      return dataSource.commonFields;
    }

    // Default fields based on data source type
    switch (source) {
      case 'CloudTrailRawEvents':
        return [
          'INSERT_ID',
          'INSERT_TIME', 
          'EVENT_TIME',
          'EVENT_NAME',
          'EVENT_SOURCE',
          'ERROR_CODE',
          'EVENT'
        ];
      case 'LW_CFG_AWS_EC2_INSTANCES':
        return [
          'RESOURCE_ID',
          'RESOURCE_REGION',
          'ACCOUNT_ID',
          'RESOURCE_TYPE',
          'RESOURCE_CONFIG',
          'URN',
          'API_KEY'
        ];
      case 'LW_CFG_AWS_S3':
        return [
          'RESOURCE_ID',
          'RESOURCE_REGION',
          'ACCOUNT_ID',
          'RESOURCE_TYPE',
          'RESOURCE_CONFIG',
          'URN',
          'API_KEY'
        ];
      case 'ContainerVulnDetails':
        return [
          'IMAGE_DIGEST',
          'SEVERITY',
          'CVE_ID', 
          'NAMESPACE',
          'VULNERABILITY_ID',
          'ASSESSMENT_RUN_ID'
        ];
      case 'LW_ACT_K8S_AUDIT':
        return [
          'CLUSTER_NAME',
          'NAMESPACE',
          'RESOURCE_TYPE',
          'ACTION',
          'EVENT_TIME'
        ];
      default:
        // Generic fallback for CloudTrail
        return [
          'INSERT_ID',
          'INSERT_TIME',
          'EVENT_TIME',
          'EVENT_NAME',
          'EVENT_SOURCE'
        ];
    }
  }

  private inferDataSourceFromQuery(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('compliance') || lowerQuery.includes('cis') || lowerQuery.includes('benchmark')) {
      // Use CloudTrail as fallback since ComplianceEvaluationDetails may not be available
      return 'CloudTrailRawEvents';
    }
    
    if (lowerQuery.includes('vulnerabilit') || lowerQuery.includes('cve')) {
      if (lowerQuery.includes('container')) {
        return 'ContainerVulnDetails';
      }
      return 'CloudTrailRawEvents'; // Fallback to CloudTrail if VulnDetails not available
    }
    
    if (lowerQuery.includes('kubernetes') || lowerQuery.includes('k8s')) {
      return 'LW_ACT_K8S_AUDIT'; // Use actual K8s audit data source
    }
    
    if (lowerQuery.includes('network') || lowerQuery.includes('connection')) {
      return 'CloudTrailRawEvents'; // Fallback to CloudTrail
    }
    
    if (lowerQuery.includes('user') || lowerQuery.includes('login') || lowerQuery.includes('auth')) {
      return 'CloudTrailRawEvents'; // Use CloudTrail for authentication events
    }
    
    // Default to CloudTrail for AWS-related queries
    return 'CloudTrailRawEvents';
  }

  private async mapFieldName(filterKey: string, dataSource: string): Promise<string> {
    // First try dynamic field discovery if explorer is available
    if (this.dataSourceExplorer) {
      try {
        const sourceInfo = await this.dataSourceExplorer.exploreDataSource(dataSource);
        if (sourceInfo?.fields) {
          // Look for exact match first
          const exactMatch = sourceInfo.fields.find(f => 
            f.name.toLowerCase() === filterKey.toLowerCase()
          );
          if (exactMatch) return exactMatch.name;

          // Look for partial match
          const partialMatch = sourceInfo.fields.find(f => 
            f.name.toLowerCase().includes(filterKey.toLowerCase()) ||
            (f.description && f.description.toLowerCase().includes(filterKey.toLowerCase()))
          );
          if (partialMatch) return partialMatch.name;
        }
      } catch (error) {
        console.error('Dynamic field mapping failed:', error.message);
      }
    }

    // Fall back to static mappings
    const fieldMappings: Record<string, Record<string, string>> = {
      CloudTrailRawEvents: {
        resource_type: 'EVENT_NAME',
        status: 'ERROR_CODE',
        event_source: 'EVENT_SOURCE',
        user_name: 'EVENT', // User info is in the EVENT JSON field
      },
      LW_CFG_AWS_EC2_INSTANCES: {
        region: 'RESOURCE_REGION',
        account: 'ACCOUNT_ID',
        resource_type: 'RESOURCE_TYPE',
        status: 'RESOURCE_CONFIG',
      },
      LW_CFG_AWS_S3: {
        region: 'RESOURCE_REGION',
        account: 'ACCOUNT_ID',
        resource_type: 'RESOURCE_TYPE',
        status: 'RESOURCE_CONFIG',
      },
      ContainerVulnDetails: {
        severity: 'SEVERITY',
        cve_id: 'CVE_ID',
        risk_score: 'CVE_SCORE',
        image_digest: 'IMAGE_DIGEST',
      },
      VulnDetails: {
        severity: 'SEVERITY',
        cve_id: 'CVE_ID',
        risk_score: 'CVE_SCORE',
      },
    };

    const mapping = fieldMappings[dataSource];
    return mapping?.[filterKey] || filterKey.toUpperCase();
  }

  private generateName(query: string): string {
    // Generate a suggested name based on the query
    const words = query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !['show', 'get', 'find', 'list', 'with', 'that', 'have'].includes(word));
    
    return 'lacework-' + words.slice(0, 4).join('-');
  }

  private calculateConfidence(
    dataSource: DataSourceMapping | null,
    pattern: Partial<LQLQueryResult> | null,
    filters: Record<string, any>
  ): number {
    let confidence = 0.5; // Base confidence
    
    if (dataSource) confidence += 0.2;
    if (pattern) confidence += 0.2;
    if (Object.keys(filters).length > 0) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }
}