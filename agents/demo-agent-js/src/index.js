require('dotenv').config();
const { logger } = require('./utils/logger');
const createDemoAgent = require('./create-agent');
const checkDemoAgent = require('./check-agent');

/**
 * Main CLI Interface for Ultravox Demo Agent Management
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  logger.info('🎙️  Ultravox Demo Agent Manager');
  logger.info('================================');
  
  switch (command) {
    case 'create':
      await createDemoAgent();
      break;
      
    case 'check':
    case 'status':
      await checkDemoAgent();
      break;
      
    case 'help':
    case '--help':
    case '-h':
      displayHelp();
      break;
      
    default:
      if (command) {
        logger.error(`Unknown command: ${command}`);
      }
      displayHelp();
      process.exit(1);
  }
}

function displayHelp() {
  console.log(`
Usage: pnpm run <command>

Commands:
  create-agent    Create the demo agent (if it doesn't exist)
  check-agent     Check if the demo agent exists and show its details
  
Environment Setup:
  1. Copy .env.example to .env
  2. Set your ULTRAVOX_API_KEY in the .env file
  3. Optionally configure other settings

Examples:
  pnpm run create-agent    # Create the demo agent
  pnpm run check-agent     # Check agent status
  
Configuration:
  Edit config/demo-agent.js to customize the agent's properties
  
Environment Variables:
  ULTRAVOX_API_KEY         Required: Your Ultravox API key
  LOG_LEVEL                Optional: Logging level (default: info)
`);
}

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Application error:', error.message);
    process.exit(1);
  });
}

module.exports = { main };