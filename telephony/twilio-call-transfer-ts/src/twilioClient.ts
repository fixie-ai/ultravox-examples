import twilio from 'twilio';
import dotenv from 'dotenv';
import type { UltravoxResponse, CallResult } from './types.js';

// Get our environment variables from .env file
dotenv.config();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const OUTBOUND_PHONE_NUMBER = process.env.OUTBOUND_PHONE_NUMBER;
const API_PORT = parseInt(process.env.API_PORT || '3000');
const NGROK_URL = process.env.NGROK_URL;
const baseUrl = NGROK_URL || `https://localhost:${API_PORT}`;

export async function initiateCallWithTwilio(ultravoxResponse: UltravoxResponse): Promise<CallResult> {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !OUTBOUND_PHONE_NUMBER) {
        throw new Error('Missing required Twilio environment variables');
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    // Create webhook URLs
    const statusCallbackUrl = `${baseUrl}/status`;
    const streamEventsUrl = `${baseUrl}/stream-events`;
    
    console.log('Using Twilio webhook URLs:');
    console.log('- Status:', statusCallbackUrl);
    console.log('- Stream Events:', streamEventsUrl);

    const call = await client.calls.create({
        twiml: `
            <Response>
                <Connect>
                    <Stream url="${ultravoxResponse.joinUrl}">
                        <Parameter name="streamEventsUrl" value="${streamEventsUrl}" />
                    </Stream>
                </Connect>
            </Response>
        `,
        to: OUTBOUND_PHONE_NUMBER,
        from: TWILIO_PHONE_NUMBER,
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST'
    });
    
    return {
        sid: call.sid,
        status: call.status
    };
}