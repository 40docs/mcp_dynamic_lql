export interface MCPConfig {
  lacework: {
    cliPath: string;
    apiUrl?: string;
    apiToken?: string;
    defaultTimeRange: number; // hours
    maxQueryResults: number;
  };
  dynamicTools: {
    enableAutoGeneration: boolean;
    maxCachedTools: number;
    cacheTimeout: number; // minutes
  };
  monitoring: {
    enableDataSourceDiscovery: boolean;
    discoveryInterval: number; // minutes
    enableQueryLogging: boolean;
  };
}

export const defaultConfig: MCPConfig = {
  lacework: {
    cliPath: 'lacework',
    defaultTimeRange: 24,
    maxQueryResults: 1000,
  },
  dynamicTools: {
    enableAutoGeneration: true,
    maxCachedTools: 50,
    cacheTimeout: 30,
  },
  monitoring: {
    enableDataSourceDiscovery: true,
    discoveryInterval: 60,
    enableQueryLogging: true,
  },
};

export function loadConfig(): MCPConfig {
  // Load from environment variables or config file
  const config = { ...defaultConfig };
  
  if (process.env.LACEWORK_CLI_PATH) {
    config.lacework.cliPath = process.env.LACEWORK_CLI_PATH;
  }
  
  if (process.env.LACEWORK_API_URL) {
    config.lacework.apiUrl = process.env.LACEWORK_API_URL;
  }
  
  if (process.env.LACEWORK_API_TOKEN) {
    config.lacework.apiToken = process.env.LACEWORK_API_TOKEN;
  }
  
  if (process.env.MCP_DISABLE_AUTO_GENERATION === 'true') {
    config.dynamicTools.enableAutoGeneration = false;
  }
  
  return config;
}