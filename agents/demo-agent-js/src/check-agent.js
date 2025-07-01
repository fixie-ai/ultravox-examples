require('dotenv').config();
const UltravoxClient = require('./ultravox-client');
const demoAgentConfig = require('../config/demo-agent');
const { logger } = require('./utils/logger');

async function checkDemoAgent() {
  try {
    logger.info('Checking demo agent status...');
    
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
    
    // Check if demo agent exists
    logger.info(`Looking for agent: "${demoAgentConfig.name}"`);
    const agent = await client.findAgentByName(demoAgentConfig.name);
    
    if (!agent) {
      logger.warn('❌ Demo agent not found');
      logger.info('Run "npm run create-agent" to create the demo agent.');
      process.exit(1);
    }
    
    logger.info('✅ Demo agent found!');
    logger.info('\n📋 Agent Information:');
    logger.info(`- Name: ${agent.name}`);
    logger.info(`- Created: ${agent.created}`);
    logger.info(`- Agent ID: ${agent.agentId}`);

    
    // Display statistics if available
    if (agent.statistics) {
      logger.info(`- Total Calls: ${agent.statistics.calls || 0}`);
    }
    
    logger.info('\n🎯 Agent is ready for demo calls!');
    
  } catch (error) {
    logger.error('❌ Failed to check demo agent:');
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
  checkDemoAgent();
}

module.exports = checkDemoAgent;