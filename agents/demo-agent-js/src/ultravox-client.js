/**
 * Ultravox API Client
 * Handles all interactions with the Ultravox API using native fetch
 */
class UltravoxClient {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('Ultravox API key is required');
    }
    
    this.apiKey = apiKey;
    this.timeout = 30000;
  }
  
  /**
   * Make an HTTP request with common settings
   */
  async request(endpoint, options = {}) {
    const url = `https://api.ultravox.ai${endpoint}`;
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      // Handle non-OK responses
      if (!response.ok) {
        let errorMessage;
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.detail || 'Unknown error';
        } catch {
          errorMessage = response.statusText || 'Unknown error';
        }
        throw new Error(`Ultravox API Error (${response.status}): ${errorMessage}`);
      }
      
      // Parse JSON response
      const data = await response.json();
      return data;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      } else if (error.message.includes('fetch')) {
        throw new Error('Network error: Could not reach Ultravox API');
      }
      throw error;
    }
  }
  
  /**
   * Generic GET request
   */
  async get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    return this.request(url);
  }
  
  /**
   * Generic POST request
   */
  async post(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
  

  /**
   * Get all agents
   */
  async getAgents(pageSize = 100) {
    try {
      return await this.get('/api/agents', { pageSize });
    } catch (error) {
      throw new Error(`Failed to get agents: ${error.message}`);
    }
  }
  
  /**
   * Find agent by name
   */
  async findAgentByName(name) {
    try {
      const agents = await this.getAgents();
      return agents.results?.find(agent => agent.name === name) || null;
    } catch (error) {
      throw new Error(`Failed to find agent by name: ${error.message}`);
    }
  }
  
  /**
   * Create a new agent
   */
  async createAgent(agentData) {
    try {
      return await this.post('/api/agents', agentData);
    } catch (error) {
      throw new Error(`Failed to create agent: ${error.message}`);
    }
  }

  
  /**
   * Get account information
   */
  async getAccount() {
    try {
      return await this.get('/api/accounts/me');
    } catch (error) {
      throw new Error(`Failed to get account: ${error.message}`);
    }
  }
  
  /**
   * Test API connection
   */
  async testConnection() {
    try {
      await this.getAccount();
      return true;
    } catch (error) {
      throw new Error(`API connection test failed: ${error.message}`);
    }
  }
}

module.exports = UltravoxClient;