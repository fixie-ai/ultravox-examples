require('dotenv').config();
const UltravoxClient = require('./ultravox-client');
const demoAgentConfig = require('../config/demo-agent');
const { logger } = require('./utils/logger');

/**
 * Create Demo Agent Script
 * Creates the official Ultravox demo agent if it doesn't exist
 */
async function createDemoAgent() {
  try {
    logger.info('Starting demo agent creation process...');
    
    // Validate environment variables
    const apiKey = process.env.ULTRAVOX_API_KEY;
    if (!apiKey) {
      throw new Error('ULTRAVOX_API_KEY environment variable is required');
    }
    
    // Initialize Ultravox client
    const client = new UltravoxClient(apiKey);
    
    // Test API connection
    logger.info('Testing API connection...');
    await client.testConnection();
    logger.info('✅ API connection successful');
    
    // Check if demo agent already exists
    logger.info(`Checking if agent "${demoAgentConfig.name}" already exists...`);
    const existingAgent = await client.findAgentByName(demoAgentConfig.name);
    
    if (existingAgent) {
      logger.warn(`❌ Agent "${demoAgentConfig.name}" already exists`);
      logger.info(`Agent ID: ${existingAgent.agentId}`);
      logger.info(`Created: ${existingAgent.created}`);
      process.exit(1);
    }
    
    // Create the demo agent
    logger.info('Creating demo agent...');
    const newAgent = await client.createAgent(demoAgentConfig);
    
    logger.info('✅ Demo agent created successfully!');
    logger.info(`Agent ID: ${newAgent.agentId}`);
    logger.info(`Agent Name: ${newAgent.name}`);
    logger.info(`Created: ${newAgent.created}`);
    
    logger.info('\n🎉 Demo agent is ready for use in your documentation!');
    
  } catch (error) {
    logger.error('❌ Failed to create demo agent:');
    logger.error(error.message);
    
    if (error.message.includes('401') || error.message.includes('unauthorized')) {
      logger.error('\nPlease check that your ULTRAVOX_API_KEY is correct and valid.');
    } else if (error.message.includes('Network error')) {
      logger.error('\nPlease check your internet connection and API base URL.');
    }
    
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  createDemoAgent();
}

module.exports = createDemoAgent;