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
    const lines = output.split('\n');
    const sources: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines, headers, and separators
      if (
        !trimmed ||                           // Empty lines
        trimmed === 'DATASOURCE' ||          // Header
        trimmed.includes('---')              // Separator lines (dashes)
      ) {
        continue;
      }
      
      // Check if this looks like a data source name (starts with specific patterns)
      if (trimmed.startsWith('LW_') || trimmed === 'CloudTrailRawEvents') {
        sources.push(trimmed);
        continue;
      }
      
      // Skip description lines (they don't start with LW_ or CloudTrail)
      // These are the lines that describe what each data source contains
    }
    
    return sources;
  }

  async executeQuery(request: QueryRequest): Promise<QueryResult> {
    if (!this.status?.authenticated) {
      throw new Error('Lacework CLI not authenticated. Run "lacework configure" first.');
    }

    const startTime = Date.now();
    
    try {
      // Create a temporary YAML file for the query
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      
      const tempDir = os.tmpdir();
      const queryId = `temp_query_${Date.now()}`;
      const tempFile = path.join(tempDir, `${queryId}.yaml`);
      
      // Create YAML content for the query
      const yamlContent = `queryId: ${queryId}\nqueryText: |-\n  ${request.query.split('\n').join('\n  ')}`;
      
      // Write the temporary file
      await fs.writeFile(tempFile, yamlContent);
      
      try {
        // Build the query command
        let cmd = `${this.cliPath} query run -f "${tempFile}" --json`;
        
        // Add time range if specified
        if (request.startTime) {
          cmd += ` --start "${request.startTime}"`;
        }
        
        if (request.endTime) {
          cmd += ` --end "${request.endTime}"`;
        }

        console.error(`Executing: ${cmd}`);
        console.error(`Query YAML content:\n${yamlContent}`);
        
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
      } finally {
        // Clean up the temporary file
        try {
          await fs.unlink(tempFile);
        } catch (unlinkError) {
          console.error('Failed to delete temp file:', unlinkError);
        }
      }
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
      const { stdout } = await execAsync(`${this.cliPath} integration list --json`);
      return JSON.parse(stdout) || [];
    } catch (error) {
      console.error('Failed to get integrations:', error.message);
      return [];
    }
  }

  async getComplianceReports(): Promise<any[]> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} compliance aws list-accounts --json`);
      return JSON.parse(stdout) || [];
    } catch (error) {
      console.error('Failed to get compliance reports:', error.message);
      return [];
    }
  }
}