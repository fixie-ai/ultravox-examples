import { config } from 'dotenv';
import twilio from 'twilio';
import https from 'https';

// Load environment variables
config();

// Configuration from environment variables
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const DESTINATION_PHONE_NUMBER = process.env.DESTINATION_PHONE_NUMBER;

// Default system prompt if not provided
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 
  'Your name is Steve and you are calling a person on the phone. Ask them their name and see how they are doing.';

// Ultravox API configuration
const ULTRAVOX_API_URL = 'https://api.ultravox.ai/api/calls';

interface UltravoxCallConfig {
  systemPrompt: string;
  model: string;
  voice: string;
  temperature: number;
  firstSpeaker: 'FIRST_SPEAKER_USER' | 'FIRST_SPEAKER_AGENT';
  medium: { twilio: {} };
}

interface UltravoxResponse {
  joinUrl: string;
}

// Validate required environment variables
function validateConfig(): void {
  const required = [
    'ULTRAVOX_API_KEY',
    'TWILIO_ACCOUNT_SID', 
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'DESTINATION_PHONE_NUMBER'
  ];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`❌ Missing required environment variable: ${envVar}`);
    }
  }

  // Basic phone number validation
  if (!TWILIO_PHONE_NUMBER?.startsWith('+')) {
    throw new Error('❌ TWILIO_PHONE_NUMBER must be in E.164 format (e.g., +1234567890)');
  }
  if (!DESTINATION_PHONE_NUMBER?.startsWith('+')) {
    throw new Error('❌ DESTINATION_PHONE_NUMBER must be in E.164 format (e.g., +1234567890)');
  }
}

// Create Ultravox call configuration
const ULTRAVOX_CALL_CONFIG: UltravoxCallConfig = {
  systemPrompt: SYSTEM_PROMPT,
  model: 'fixie-ai/ultravox',
  voice: 'Mark',
  temperature: 0.3,
  firstSpeaker: 'FIRST_SPEAKER_USER',
  medium: { twilio: {} }
};

// Create Ultravox call and get join URL
async function createUltravoxCall(): Promise<UltravoxResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(ULTRAVOX_CALL_CONFIG);
    
    const request = https.request(ULTRAVOX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ULTRAVOX_API_KEY!
      }
    });

    let responseData = '';

    request.on('response', (response) => {
      response.on('data', chunk => responseData += chunk);
      response.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Ultravox API error ${response.statusCode}: ${responseData}`));
          } else {
            resolve(result);
          }
        } catch (error) {
          reject(new Error(`Failed to parse Ultravox response: ${error}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(new Error(`Ultravox request failed: ${error.message}`));
    });

    request.write(data);
    request.end();
  });
}

// Main application function
async function main(): Promise<void> {
  try {
    console.log('🚀 Ultravox + Twilio Quickstart');
    console.log('================================');
    
    // Validate configuration
    validateConfig();
    console.log('✅ Configuration validated');

    // Step 1: Create Ultravox call
    console.log('🤖 Creating Ultravox call...');
    const { joinUrl } = await createUltravoxCall();
    console.log('✅ Got joinUrl:', joinUrl);

    // Step 2: Initiate Twilio call
    console.log('📞 Initiating call...');
    const client = twilio(TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN!);
    
    const call = await client.calls.create({
      twiml: `<Response><Connect><Stream url="${joinUrl}"/></Connect></Response>`,
      to: DESTINATION_PHONE_NUMBER!,
      from: TWILIO_PHONE_NUMBER!
    });

    console.log('✅ Call initiated:', call.sid);
    console.log('🎉 Success! Ultravox voice AI call in progress');
    console.log(`📱 Calling ${DESTINATION_PHONE_NUMBER}`);
    console.log('🤖 Steve will introduce himself when answered');
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    
    if (error instanceof Error && error.message.includes('Missing required')) {
      console.log('\n💡 Make sure to:');
      console.log('   1. Copy .env.example to .env');
      console.log('   2. Add your API keys and phone numbers');
      console.log('   3. Use E.164 format for phone numbers (+1234567890)');
    }
    
    return
  }
}

// Run the application
main();