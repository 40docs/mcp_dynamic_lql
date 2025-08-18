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

  constructor() {
    this.initializeDataSources();
    this.initializeQueryPatterns();
  }

  private initializeDataSources() {
    // AWS Data Sources
    this.dataSources.set('aws-ec2', {
      keywords: ['ec2', 'instance', 'instances', 'virtual machine', 'vm'],
      lqlSource: 'CloudTrailRawEvents',
      commonFields: ['EVENT_NAME', 'AWS_REGION', 'SOURCE_IP_ADDRESS', 'USER_NAME'],
      description: 'AWS EC2 instances and events'
    });

    this.dataSources.set('aws-s3', {
      keywords: ['s3', 'bucket', 'storage', 'object storage'],
      lqlSource: 'CloudTrailRawEvents',
      commonFields: ['EVENT_NAME', 'AWS_REGION', 'BUCKET_NAME', 'OBJECT_KEY'],
      description: 'AWS S3 buckets and objects'
    });

    this.dataSources.set('aws-compliance', {
      keywords: ['compliance', 'cis', 'benchmark', 'policy', 'violation'],
      lqlSource: 'ComplianceEvaluationDetails',
      commonFields: ['EVAL_TYPE', 'STATUS', 'SEVERITY', 'RESOURCE_ID'],
      description: 'AWS compliance evaluations'
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
    const dataSource = this.identifyDataSource(lowerQuery);
    console.error(`📊 Identified data source: ${dataSource?.lqlSource || 'CloudTrailRawEvents'}`);

    // Step 2: Match against query patterns
    const pattern = this.matchQueryPattern(naturalQuery);
    console.error(`🎯 Matched pattern category: ${pattern?.category || 'general'}`);

    // Step 3: Extract filters and conditions
    const filters = this.extractFilters(lowerQuery);
    console.error(`🔧 Extracted filters:`, filters);

    // Step 4: Build the LQL query
    const lqlQuery = this.buildLQLQuery(dataSource, pattern, filters, naturalQuery);
    
    return {
      query: lqlQuery,
      category: pattern?.category || 'general',
      suggestedName: pattern?.suggestedName || this.generateName(naturalQuery),
      parameters: { ...pattern?.parameters, ...filters },
      timeRange: this.extractTimeRange(lowerQuery),
      confidence: this.calculateConfidence(dataSource, pattern, filters),
    };
  }

  private identifyDataSource(query: string): DataSourceMapping | null {
    for (const [key, mapping] of this.dataSources.entries()) {
      for (const keyword of mapping.keywords) {
        if (query.includes(keyword)) {
          return mapping;
        }
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

    // Cloud provider filters
    if (query.includes('aws')) {
      filters.cloud_provider = 'aws';
    }
    if (query.includes('gcp') || query.includes('google cloud')) {
      filters.cloud_provider = 'gcp';
    }
    if (query.includes('azure')) {
      filters.cloud_provider = 'azure';
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

  private buildLQLQuery(
    dataSource: DataSourceMapping | null,
    pattern: Partial<LQLQueryResult> | null,
    filters: Record<string, any>,
    originalQuery: string
  ): string {
    // Choose the data source
    const source = dataSource?.lqlSource || this.inferDataSourceFromQuery(originalQuery);
    
    // Start building the query
    let query = `SELECT *\nFROM ${source}`;
    
    // Build WHERE clause
    const whereConditions: string[] = [];
    
    // Add filter conditions
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (typeof value === 'string' && (value.startsWith('>=') || value.startsWith('<='))) {
          // Handle comparison operators
          const operator = value.substring(0, 2);
          const numValue = value.substring(2).trim();
          whereConditions.push(`${this.mapFieldName(key, source)} ${operator} ${numValue}`);
        } else if (value === 'true' || value === 'false') {
          // Handle boolean values
          whereConditions.push(`${this.mapFieldName(key, source)} = ${value}`);
        } else if (value.includes(',')) {
          // Handle multiple values
          const values = value.split(',').map((v: string) => `'${v.trim()}'`).join(', ');
          whereConditions.push(`${this.mapFieldName(key, source)} IN (${values})`);
        } else {
          // Handle single string values
          whereConditions.push(`${this.mapFieldName(key, source)} = '${value}'`);
        }
      }
    });

    // Add query-specific conditions based on keywords
    if (originalQuery.toLowerCase().includes('fail') && source === 'ComplianceEvaluationDetails') {
      whereConditions.push("STATUS = 'fail'");
    }
    
    if (originalQuery.toLowerCase().includes('critical') && source.includes('Vuln')) {
      whereConditions.push("SEVERITY = 'critical'");
    }

    // Add WHERE clause if we have conditions
    if (whereConditions.length > 0) {
      query += `\nWHERE ${whereConditions.join('\n  AND ')}`;
    }

    // Add ORDER BY for better results
    if (source.includes('Vuln') || source.includes('Compliance')) {
      query += `\nORDER BY SEVERITY DESC`;
    } else if (source === 'CloudTrailRawEvents') {
      query += `\nORDER BY EVENT_TIME DESC`;
    }

    // Add LIMIT
    query += `\nLIMIT 100`;

    return query;
  }

  private inferDataSourceFromQuery(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('compliance') || lowerQuery.includes('cis') || lowerQuery.includes('benchmark')) {
      return 'ComplianceEvaluationDetails';
    }
    
    if (lowerQuery.includes('vulnerabilit') || lowerQuery.includes('cve')) {
      if (lowerQuery.includes('container')) {
        return 'ContainerVulnDetails';
      }
      return 'VulnDetails';
    }
    
    if (lowerQuery.includes('kubernetes') || lowerQuery.includes('k8s')) {
      return 'KubernetesActivity';
    }
    
    if (lowerQuery.includes('network') || lowerQuery.includes('connection')) {
      return 'NetworkActivity';
    }
    
    if (lowerQuery.includes('user') || lowerQuery.includes('login') || lowerQuery.includes('auth')) {
      return 'UserActivity';
    }
    
    // Default to CloudTrail for AWS-related queries
    return 'CloudTrailRawEvents';
  }

  private mapFieldName(filterKey: string, dataSource: string): string {
    // Map common filter keys to actual LQL field names based on data source
    const fieldMappings: Record<string, Record<string, string>> = {
      CloudTrailRawEvents: {
        cloud_provider: 'AWS_REGION',
        resource_type: 'EVENT_NAME',
        severity: 'ERROR_CODE',
        risk_score: 'RISK_SCORE',
        status: 'STATUS',
        user_name: 'USER_NAME',
      },
      ComplianceEvaluationDetails: {
        severity: 'SEVERITY',
        status: 'STATUS',
        resource_type: 'EVAL_TYPE',
        risk_score: 'RISK_SCORE',
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