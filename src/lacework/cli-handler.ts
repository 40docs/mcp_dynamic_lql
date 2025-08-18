import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface LaceworkStatus {
  cliAvailable: boolean;
  version?: string;
  authenticated: boolean;
  account?: string;
  profile?: string;
  apiUrl?: string;
  dataSources?: string[];
}

export interface QueryRequest {
  query: string;
  startTime?: string;
  endTime?: string;
}

export interface QueryResult {
  data: any[];
  metadata?: {
    executionTime: number;
    rowCount: number;
    query: string;
  };
}

export class LaceworkHandler {
  private cliPath: string = 'lacework';
  private status: LaceworkStatus | null = null;

  async initialize(): Promise<void> {
    this.status = await this.checkLaceworkStatus();
  }

  async getStatus(): Promise<LaceworkStatus> {
    if (!this.status) {
      this.status = await this.checkLaceworkStatus();
    }
    return this.status;
  }

  private async checkLaceworkStatus(): Promise<LaceworkStatus> {
    const status: LaceworkStatus = {
      cliAvailable: false,
      authenticated: false,
    };

    try {
      // Check if CLI is installed
      const { stdout: versionOut } = await execAsync(`${this.cliPath} version`);
      status.cliAvailable = true;
      status.version = this.extractVersion(versionOut);

      // Check authentication and configuration
      try {
        const { stdout: configOut } = await execAsync(`${this.cliPath} configure list`);
        const config = this.parseConfig(configOut);
        
        status.authenticated = !!config.account;
        status.account = config.account;
        status.profile = config.profile;
        status.apiUrl = config.apiUrl;

        // Test authentication with a simple query
        if (status.authenticated) {
          try {
            await execAsync(`${this.cliPath} query list-sources`);
            status.authenticated = true;
            status.dataSources = await this.getDataSources();
          } catch (authError) {
            status.authenticated = false;
          }
        }
      } catch (configError) {
        console.error('Configuration check failed:', configError.message);
      }
    } catch (error) {
      console.error('Lacework CLI not found or not working:', error.message);
    }

    return status;
  }

  private extractVersion(versionOutput: string): string {
    const match = versionOutput.match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : 'unknown';
  }

  private parseConfig(configOutput: string): any {
    const config: any = {};
    const lines = configOutput.split('\n');
    
    // Look for the table format output from "lacework configure list"
    for (const line of lines) {
      // Skip header lines and separator lines
      if (line.includes('PROFILE') || line.includes('---') || line.trim() === '') {
        continue;
      }
      
      // Parse the table row - look for active profile (marked with >)
      if (line.includes('>')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          // Format: > default   partner-demo   ...
          config.profile = parts[1]; // "default"
          config.account = parts[2]; // "partner-demo"
          if (config.account && config.account !== '') {
            config.apiUrl = `https://${config.account}.lacework.net`;
          }
        }
      }
    }
    
    return config;
  }

  async getDataSources(): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} query list-sources`);
      return this.parseDataSources(stdout);
    } catch (error) {
      console.error('Failed to get data sources:', error.message);
      return [];
    }
  }

  private parseDataSources(output: string): string[] {
    const lines = output.split('\n').filter(line => line.trim());
    const sources: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.includes('Available') && !trimmed.includes('Sources:')) {
        sources.push(trimmed);
      }
    }
    
    return sources;
  }

  async executeQuery(request: QueryRequest): Promise<QueryResult> {
    if (!this.status?.authenticated) {
      throw new Error('Lacework CLI not authenticated. Run "lacework configure" first.');
    }

    const startTime = Date.now();
    
    try {
      // Build the query command
      let cmd = `${this.cliPath} query run --output json`;
      
      // Add query
      cmd += ` --query "${request.query.replace(/"/g, '\\"')}"`;
      
      // Add time range if specified
      if (request.startTime) {
        cmd += ` --start "${request.startTime}"`;
      }
      
      if (request.endTime) {
        cmd += ` --end "${request.endTime}"`;
      }

      console.error(`Executing: ${cmd}`);
      
      const { stdout, stderr } = await execAsync(cmd, { timeout: 60000 });
      
      if (stderr) {
        console.error('Query stderr:', stderr);
      }
      
      const executionTime = Date.now() - startTime;
      
      let data: any[] = [];
      
      try {
        const parsed = JSON.parse(stdout);
        data = Array.isArray(parsed) ? parsed : [parsed];
      } catch (parseError) {
        // If JSON parsing fails, try to extract meaningful data
        if (stdout.trim()) {
          data = [{ raw_output: stdout.trim() }];
        }
      }
      
      return {
        data,
        metadata: {
          executionTime,
          rowCount: data.length,
          query: request.query,
        },
      };
    } catch (error) {
      throw new Error(`Query execution failed: ${error.message}`);
    }
  }

  async validateQuery(query: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // Try to explain the query first to validate syntax
      const { stdout } = await execAsync(`${this.cliPath} query validate --query "${query.replace(/"/g, '\\"')}"`);
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: error.message.includes('Invalid') ? error.message : 'Query validation failed'
      };
    }
  }

  async getIntegrations(): Promise<any[]> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} integration list --output json`);
      return JSON.parse(stdout) || [];
    } catch (error) {
      console.error('Failed to get integrations:', error.message);
      return [];
    }
  }

  async getComplianceReports(): Promise<any[]> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} compliance aws list-accounts --output json`);
      return JSON.parse(stdout) || [];
    } catch (error) {
      console.error('Failed to get compliance reports:', error.message);
      return [];
    }
  }
}