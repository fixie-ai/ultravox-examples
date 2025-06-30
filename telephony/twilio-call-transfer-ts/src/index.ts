import dotenv from 'dotenv';
import { registerCall } from './callManager.js';
import { startApiServer } from './apiServer.js';
import { createUltravoxCall } from './ultravox.js';
import { initiateCallWithTwilio } from './twilioClient.js';

// Get our environment variables from .env file
dotenv.config();
const OUTBOUND_PHONE_NUMBER = process.env.OUTBOUND_PHONE_NUMBER;
const API_PORT = parseInt(process.env.API_PORT || '3000');
const NGROK_URL = process.env.NGROK_URL;
const baseUrl = NGROK_URL || `https://localhost:${API_PORT}`;

async function main(): Promise<void> {
    try {
        // Start the API server
        const { server } = await startApiServer(API_PORT, NGROK_URL);

        // Validate required environment variables
        if (!OUTBOUND_PHONE_NUMBER) {
            throw new Error('OUTBOUND_PHONE_NUMBER must be set');
        }

        // Create Ultravox call with Twilio provider        
        const ultravoxResponse = await createUltravoxCall(baseUrl);
        if (ultravoxResponse.joinUrl) {
            console.log('Ultravox call created:', ultravoxResponse.callId);
            console.log('Got joinUrl:', ultravoxResponse.joinUrl);

            try {
                // Initiate call with Twilio
                const callResult = await initiateCallWithTwilio(ultravoxResponse);
                console.log(`Call initiated with Twilio:`, callResult.sid);
                
                // Register the call
                registerCall(
                    ultravoxResponse.callId, 
                    callResult.sid, 
                    OUTBOUND_PHONE_NUMBER,
                    ultravoxResponse.joinUrl
                );
                
                console.log('Call registered in the system.');
                
            } catch (providerError) {
                console.error(`Error with Twilio integration:`, (providerError as Error).message);
            }
        }
    } catch (error) {
        console.error('Error:', (error as Error).message);
    }
}

main();