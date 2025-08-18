import fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';

export interface LQLTemplate {
  name: string;
  description: string;
  category: string;
  query: string;
  parameters: Record<string, any>;
  author?: string;
  created?: string;
  updated?: string;
  version?: string;
  tags?: string[];
  examples?: Array<{
    description: string;
    parameters: Record<string, any>;
  }>;
}

export interface TemplateCategory {
  name: string;
  description: string;
  templates: LQLTemplate[];
}

export class TemplateManager {
  private templatesDir: string;
  private templates: Map<string, LQLTemplate> = new Map();
  private categories: Map<string, TemplateCategory> = new Map();

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir || path.join(process.cwd(), 'templates');
  }

  async initialize(): Promise<void> {
    await this.ensureTemplatesDirectory();
    await this.createDefaultTemplates();
    await this.loadTemplates();
  }

  private async ensureTemplatesDirectory(): Promise<void> {
    const categoryDirs = ['compliance', 'threats', 'inventory', 'custom', 'aws', 'containers'];
    
    for (const categoryDir of categoryDirs) {
      const fullPath = path.join(this.templatesDir, categoryDir);
      await fs.ensureDir(fullPath);
    }
  }

  private async createDefaultTemplates(): Promise<void> {
    const defaultTemplates: LQLTemplate[] = [
      // AWS Security Templates
      {
        name: 'lacework-aws-unencrypted-volumes',
        description: 'Find AWS EBS volumes that are not encrypted',
        category: 'aws',
        query: `SELECT *
FROM CloudTrailRawEvents
WHERE EVENT_NAME = 'CreateVolume'
  AND JSON_EXTRACT(REQUEST_PARAMETERS, '$.encrypted') = 'false'
ORDER BY EVENT_TIME DESC
LIMIT 100`,
        parameters: {
          cloud_provider: 'aws',
          resource_type: 'ebs',
          encrypted: false
        },
        tags: ['aws', 'encryption', 'ebs', 'compliance'],
        examples: [
          {
            description: 'Find unencrypted volumes in us-east-1',
            parameters: { region: 'us-east-1' }
          }
        ]
      },

      {
        name: 'lacework-aws-public-s3-buckets',
        description: 'Identify publicly accessible S3 buckets',
        category: 'aws',
        query: `SELECT *
FROM CloudTrailRawEvents  
WHERE EVENT_NAME IN ('PutBucketPolicy', 'PutBucketAcl')
  AND JSON_EXTRACT(REQUEST_PARAMETERS, '$.bucketPolicy') LIKE '%"Principal":"*"%'
ORDER BY EVENT_TIME DESC
LIMIT 100`,
        parameters: {
          cloud_provider: 'aws',
          resource_type: 's3',
          public_access: true
        },
        tags: ['aws', 's3', 'public-access', 'security'],
      },

      // Compliance Templates
      {
        name: 'lacework-compliance-cis-failures',
        description: 'Find all CIS benchmark compliance failures',
        category: 'compliance',
        query: `SELECT *
FROM ComplianceEvaluationDetails
WHERE STATUS = 'fail'
  AND EVAL_TYPE LIKE '%CIS%'
ORDER BY SEVERITY DESC, EVAL_TIME DESC
LIMIT 100`,
        parameters: {
          status: 'fail',
          benchmark: 'CIS',
          severity: 'high'
        },
        tags: ['compliance', 'cis', 'benchmark', 'failures'],
      },

      {
        name: 'lacework-compliance-high-severity',
        description: 'Critical and high severity compliance violations',
        category: 'compliance',
        query: `SELECT *
FROM ComplianceEvaluationDetails
WHERE STATUS = 'fail'
  AND SEVERITY IN ('critical', 'high')
ORDER BY SEVERITY DESC, EVAL_TIME DESC
LIMIT 100`,
        parameters: {
          status: 'fail',
          severity: 'critical,high'
        },
        tags: ['compliance', 'high-severity', 'critical'],
      },

      // Container Security Templates
      {
        name: 'lacework-container-critical-vulns',
        description: 'Critical vulnerabilities in container images',
        category: 'containers',
        query: `SELECT *
FROM ContainerVulnDetails
WHERE SEVERITY = 'critical'
ORDER BY CVE_SCORE DESC, EVAL_TIME DESC
LIMIT 100`,
        parameters: {
          severity: 'critical',
          resource_type: 'container'
        },
        tags: ['containers', 'vulnerabilities', 'critical', 'cve'],
      },

      {
        name: 'lacework-container-runtime-threats',
        description: 'Runtime threats detected in containers',
        category: 'threats',
        query: `SELECT *
FROM KubernetesActivity
WHERE ACTION = 'threat_detected'
  AND SEVERITY IN ('high', 'critical')
ORDER BY EVENT_TIME DESC
LIMIT 100`,
        parameters: {
          activity_type: 'threat',
          severity: 'high,critical',
          platform: 'kubernetes'
        },
        tags: ['containers', 'kubernetes', 'runtime', 'threats'],
      },

      // Network Security Templates
      {
        name: 'lacework-network-lateral-movement',
        description: 'Detect potential lateral movement activities',
        category: 'threats',
        query: `SELECT *
FROM NetworkActivity
WHERE PROTOCOL IN ('SSH', 'RDP', 'SMB')
  AND ANOMALY_SCORE > 0.8
ORDER BY ANOMALY_SCORE DESC, EVENT_TIME DESC
LIMIT 100`,
        parameters: {
          activity_type: 'network',
          anomaly_threshold: 0.8,
          protocols: 'SSH,RDP,SMB'
        },
        tags: ['network', 'lateral-movement', 'anomaly', 'threats'],
      },

      // User Activity Templates
      {
        name: 'lacework-user-suspicious-logins',
        description: 'Suspicious user login activities',
        category: 'threats',
        query: `SELECT *
FROM UserActivity
WHERE ACTION = 'login'
  AND (SOURCE_IP NOT IN (SELECT IP FROM TrustedIPs) 
       OR LOGIN_TIME NOT BETWEEN '08:00:00' AND '18:00:00')
ORDER BY EVENT_TIME DESC
LIMIT 100`,
        parameters: {
          activity_type: 'login',
          anomaly_type: 'suspicious'
        },
        tags: ['users', 'login', 'suspicious', 'authentication'],
      },

      // Inventory Templates
      {
        name: 'lacework-inventory-aws-assets',
        description: 'Complete inventory of AWS assets',
        category: 'inventory',
        query: `SELECT DISTINCT EVENT_NAME, AWS_REGION, COUNT(*) as COUNT
FROM CloudTrailRawEvents
WHERE EVENT_TIME >= NOW() - INTERVAL '7' DAY
GROUP BY EVENT_NAME, AWS_REGION
ORDER BY COUNT DESC
LIMIT 100`,
        parameters: {
          cloud_provider: 'aws',
          time_range: '7d',
          group_by: 'resource_type,region'
        },
        tags: ['inventory', 'aws', 'assets', 'summary'],
      },
    ];

    // Save default templates if they don't exist
    for (const template of defaultTemplates) {
      const filePath = path.join(this.templatesDir, template.category, `${template.name}.yaml`);
      
      if (!(await fs.pathExists(filePath))) {
        await this.saveTemplateFile(template);
      }
    }
  }

  async loadTemplates(): Promise<void> {
    this.templates.clear();
    this.categories.clear();

    const categoryDirs = await fs.readdir(this.templatesDir, { withFileTypes: true });
    
    for (const categoryDir of categoryDirs) {
      if (categoryDir.isDirectory()) {
        const categoryName = categoryDir.name;
        const categoryPath = path.join(this.templatesDir, categoryName);
        
        const category: TemplateCategory = {
          name: categoryName,
          description: this.getCategoryDescription(categoryName),
          templates: []
        };

        try {
          const templateFiles = await fs.readdir(categoryPath);
          
          for (const fileName of templateFiles) {
            if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
              const filePath = path.join(categoryPath, fileName);
              const template = await this.loadTemplateFile(filePath);
              
              if (template) {
                this.templates.set(template.name, template);
                category.templates.push(template);
              }
            }
          }
        } catch (error) {
          console.error(`Error loading templates from ${categoryPath}:`, error.message);
        }

        this.categories.set(categoryName, category);
      }
    }

    console.error(`📚 Loaded ${this.templates.size} LQL templates across ${this.categories.size} categories`);
  }

  private async loadTemplateFile(filePath: string): Promise<LQLTemplate | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const template = yaml.parse(content) as LQLTemplate;
      
      // Validate required fields
      if (!template.name || !template.query || !template.category) {
        console.error(`Invalid template in ${filePath}: missing required fields`);
        return null;
      }

      return template;
    } catch (error) {
      console.error(`Error loading template ${filePath}:`, error.message);
      return null;
    }
  }

  async saveTemplate(template: LQLTemplate): Promise<void> {
    // Add metadata
    template.created = template.created || new Date().toISOString();
    template.updated = new Date().toISOString();
    template.version = template.version || '1.0.0';

    // Save to memory
    this.templates.set(template.name, template);
    
    // Add to category
    let category = this.categories.get(template.category);
    if (!category) {
      category = {
        name: template.category,
        description: this.getCategoryDescription(template.category),
        templates: []
      };
      this.categories.set(template.category, category);
    }
    
    // Update or add template to category
    const existingIndex = category.templates.findIndex(t => t.name === template.name);
    if (existingIndex >= 0) {
      category.templates[existingIndex] = template;
    } else {
      category.templates.push(template);
    }

    // Save to file
    await this.saveTemplateFile(template);
  }

  private async saveTemplateFile(template: LQLTemplate): Promise<void> {
    const categoryPath = path.join(this.templatesDir, template.category);
    await fs.ensureDir(categoryPath);
    
    const filePath = path.join(categoryPath, `${template.name}.yaml`);
    const yamlContent = yaml.stringify(template, {
      lineWidth: 0,
      minContentWidth: 0
    });
    
    await fs.writeFile(filePath, yamlContent, 'utf-8');
  }

  getTemplate(name: string): LQLTemplate | undefined {
    return this.templates.get(name);
  }

  async getTemplates(categoryFilter?: string): Promise<TemplateCategory[]> {
    const categories = Array.from(this.categories.values());
    
    if (categoryFilter) {
      return categories.filter(cat => cat.name === categoryFilter);
    }
    
    return categories;
  }

  async searchTemplates(searchTerm: string): Promise<LQLTemplate[]> {
    const results: LQLTemplate[] = [];
    const lowerSearchTerm = searchTerm.toLowerCase();
    
    for (const template of this.templates.values()) {
      if (
        template.name.toLowerCase().includes(lowerSearchTerm) ||
        template.description.toLowerCase().includes(lowerSearchTerm) ||
        template.tags?.some(tag => tag.toLowerCase().includes(lowerSearchTerm)) ||
        template.query.toLowerCase().includes(lowerSearchTerm)
      ) {
        results.push(template);
      }
    }
    
    return results;
  }

  async generateTemplateFromQuery(
    queryResult: any,
    naturalLanguage: string,
    lqlQuery: string
  ): Promise<LQLTemplate> {
    const name = this.generateTemplateName(naturalLanguage);
    const category = this.inferCategory(naturalLanguage, lqlQuery);
    
    const template: LQLTemplate = {
      name,
      description: naturalLanguage,
      category,
      query: lqlQuery,
      parameters: this.extractParameters(lqlQuery),
      tags: this.generateTags(naturalLanguage, lqlQuery),
      created: new Date().toISOString(),
      version: '1.0.0',
      author: 'lacework-mcp-auto-generated',
    };

    return template;
  }

  private generateTemplateName(naturalLanguage: string): string {
    const words = naturalLanguage
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !['show', 'get', 'find', 'list', 'with', 'that', 'have', 'the', 'and', 'for'].includes(word));
    
    const name = 'lacework-' + words.slice(0, 4).join('-');
    
    // Ensure uniqueness
    let counter = 1;
    let uniqueName = name;
    while (this.templates.has(uniqueName)) {
      uniqueName = `${name}-${counter}`;
      counter++;
    }
    
    return uniqueName;
  }

  private inferCategory(naturalLanguage: string, lqlQuery: string): string {
    const lower = naturalLanguage.toLowerCase();
    const queryLower = lqlQuery.toLowerCase();
    
    if (lower.includes('compliance') || lower.includes('cis') || lower.includes('benchmark') || queryLower.includes('complianceevaluationdetails')) {
      return 'compliance';
    }
    
    if (lower.includes('threat') || lower.includes('attack') || lower.includes('malicious') || lower.includes('suspicious')) {
      return 'threats';
    }
    
    if (lower.includes('container') || lower.includes('docker') || lower.includes('k8s') || lower.includes('kubernetes')) {
      return 'containers';
    }
    
    if (lower.includes('aws') || lower.includes('s3') || lower.includes('ec2')) {
      return 'aws';
    }
    
    if (lower.includes('inventory') || lower.includes('assets') || lower.includes('resources')) {
      return 'inventory';
    }
    
    return 'custom';
  }

  private extractParameters(lqlQuery: string): Record<string, any> {
    const parameters: Record<string, any> = {};
    
    // Extract common parameter patterns from WHERE clauses
    const patterns = [
      { regex: /SEVERITY\s*=\s*'([^']+)'/gi, key: 'severity' },
      { regex: /STATUS\s*=\s*'([^']+)'/gi, key: 'status' },
      { regex: /AWS_REGION\s*=\s*'([^']+)'/gi, key: 'region' },
      { regex: /EVENT_NAME\s*=\s*'([^']+)'/gi, key: 'event_name' },
    ];
    
    for (const { regex, key } of patterns) {
      const matches = Array.from(lqlQuery.matchAll(regex));
      if (matches.length > 0) {
        parameters[key] = matches.map(m => m[1]).join(',');
      }
    }
    
    return parameters;
  }

  private generateTags(naturalLanguage: string, lqlQuery: string): string[] {
    const tags = new Set<string>();
    
    const keywords = [
      'aws', 'gcp', 'azure', 'kubernetes', 'k8s', 'container', 'docker',
      'compliance', 'cis', 'vulnerability', 'threat', 'security',
      'network', 'user', 'authentication', 'encryption', 'public',
      'critical', 'high', 'medium', 'low'
    ];
    
    const combined = (naturalLanguage + ' ' + lqlQuery).toLowerCase();
    
    for (const keyword of keywords) {
      if (combined.includes(keyword)) {
        tags.add(keyword);
      }
    }
    
    return Array.from(tags);
  }

  private getCategoryDescription(categoryName: string): string {
    const descriptions: Record<string, string> = {
      'compliance': 'Compliance monitoring and benchmark evaluations',
      'threats': 'Threat detection and security incident monitoring',
      'inventory': 'Asset inventory and resource management queries',
      'custom': 'User-generated and custom LQL templates',
      'aws': 'Amazon Web Services security and monitoring templates',
      'containers': 'Container and Kubernetes security monitoring',
      'network': 'Network activity and communication monitoring',
      'users': 'User activity and authentication monitoring',
    };
    
    return descriptions[categoryName] || 'Lacework monitoring templates';
  }
}