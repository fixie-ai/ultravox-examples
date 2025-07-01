const logger = {
  error(message, ...args) {
    console.error('❌', message, ...args);
  },
  
  warn(message, ...args) {
    console.warn('⚠️ ', message, ...args);
  },
  
  info(message, ...args) {
    console.log(message, ...args);
  },
  
  debug(message, ...args) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('🐛', message, ...args);
    }
  }
};

module.exports = { logger };