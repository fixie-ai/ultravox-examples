import { createRequire } from 'module';
import twilio from 'twilio';
import type { CallData, TransferResult } from './types.js';

const require = createRequire(import.meta.url);

// Store Ultravox callId and Twilio CallSid mapping when a call starts
// In prod replace the map with a database
const activeCalls = new Map<string, CallData>();

/**
 * Register a new call in the system
 */
function registerCall(ultravoxCallId: string, providerCallSid: string, callerNumber: string, joinUrl?: string): void {
  const callData: CallData = {
    callerNumber,
    startTime: new Date(),
    providerCallSid,
    joinUrl
  };
  
  activeCalls.set(ultravoxCallId, callData);
  console.log(`Call registered: ${ultravoxCallId} -> ${providerCallSid} (Twilio)`);
}

/**
 * Get details about an active call
 */
function getCallDetails(ultravoxCallId: string): CallData | null {
  return activeCalls.get(ultravoxCallId) || null;
}

/**
 * Transfer an active call to a destination number.
 * 
 * Optionally pass in a message that will be whispered to the human agent prior to transferring the call.
 */
async function transferActiveCall(ultravoxCallId: string, destinationNumber: string, transferReason?: string): Promise<TransferResult> {
  const callData = activeCalls.get(ultravoxCallId);
  
  if (!callData) {
    throw new Error(`Call not found: ${ultravoxCallId}`);
  }

  try {
    if (!callData.providerCallSid) {
      throw new Error('Call not found or invalid Call SID');
    }

    // Initialize Twilio client
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const twiml = new twilio.twiml.VoiceResponse();

    // Do a whisper transfer
    if (transferReason && transferReason != '') {
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        const baseUrl = process.env.NGROK_URL || `http://localhost:${process.env.API_PORT}`;

        if (!fromNumber) {
            throw new Error('Required parameter "from" missing. No valid phone number found.');
        }
      
        // Put call on hold so we can start a conference call
        const holdTwiml = new twilio.twiml.VoiceResponse();
        holdTwiml.play('http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3');

        await client.calls(callData.providerCallSid)
            .update({
                twiml: holdTwiml.toString()
            });

        // Call human agent and deliver whisper message -- they need to press a key to connect
        const conferenceName = `conf_${ultravoxCallId}_${Date.now()}`;

        console.log('Starting whisper transfer for call:', callData.providerCallSid);
        console.log('Conference name:', conferenceName);
        console.log('Agent phone number:', destinationNumber);
        console.log('Creating agent call...');
        const agentCall = await client.calls.create({
          to: destinationNumber,
          from: fromNumber,
          twiml: `
              <Response>
                  <Say voice="alice">
                      ${transferReason}
                  </Say>
                  <Say voice="alice">Press any key to connect the caller.</Say>
                  <Gather numDigits="1" action="${baseUrl}/connect-conference/${conferenceName}/${callData.providerCallSid}">
                      <Say voice="alice">Press any key to connect.</Say>
                  </Gather>
              </Response>
          `
        });

        console.log('Agent call created successfully:', {
          agentCallSid: agentCall.sid,
          to: destinationNumber,
          from: fromNumber,
          status: agentCall.status
        });

      return {
        status: 'success',
        message: 'Call transfer with text whisper initiated',
        callDetails: {
            ultravoxCallId: ultravoxCallId,
            destinationNumber: destinationNumber,
            transferInitiated: new Date()
        }
      }
    }
    // Do a regular transfer
    else {
        twiml.dial().number(destinationNumber);

        // Update the active call with the new TwiML
        await client.calls(callData.providerCallSid)
        .update({
            twiml: twiml.toString()
        });

        return {
        status: 'success',
        message: 'Call transfer initiated',
        callDetails: {
            ultravoxCallId,
            providerCallSid: callData.providerCallSid,
            destinationNumber,
            transferInitiated: new Date()
        }
        };
    }

  } catch (error) {
    console.error('Error transferring Twilio call:', error);
    throw error;
  }
}

export {
  registerCall,
  getCallDetails,
  transferActiveCall,
  activeCalls
};