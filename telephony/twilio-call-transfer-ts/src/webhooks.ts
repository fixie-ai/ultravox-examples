import twilio from 'twilio';
import dotenv from 'dotenv';
import express, { Request, Response, Router } from 'express';
import type { TwilioStatusWebhook, TwilioStreamEvent } from './types.js';

const router: Router = express.Router();
dotenv.config();
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Middleware to parse Twilio's form-encoded webhook data
router.use(express.urlencoded({ extended: true }));

/**
 * Handle Twilio call status webhooks
 * This endpoint receives events like: initiated, ringing, answered, completed, etc.
 */
router.post('/status', (req: Request, res: Response) => {
  console.log('Twilio Status Webhook received:', req.body);
  
  const {
    CallSid,
    CallStatus,
    From,
    To,
    Duration,
    RecordingUrl,
    ErrorCode,
    ErrorMessage
  }: TwilioStatusWebhook = req.body;
  
  console.log(`Twilio Call ${CallSid}: ${CallStatus}`);
  
  // Log important status changes
  switch (CallStatus) {
    case 'initiated':
      console.log(`Call initiated from ${From} to ${To}`);
      break;
    case 'ringing':
      console.log(`Call ringing - ${To}`);
      break;
    case 'answered':
      console.log(`Call answered by ${To}`);
      break;
    case 'completed':
      console.log(`Call completed - Duration: ${Duration} seconds`);
      if (RecordingUrl) {
        console.log(`Recording available: ${RecordingUrl}`);
      }
      break;
    case 'busy':
    case 'no-answer':
    case 'canceled':
    case 'failed':
      console.log(`Call ended with status: ${CallStatus}`);
      if (ErrorCode) {
        console.error(`Twilio Error ${ErrorCode}: ${ErrorMessage}`);
      }
      break;
  }
  
  res.status(200).send('OK');
});

/**
 * Handle Twilio Stream events
 * Events: start, media, stop
 */
router.post('/stream-events', (req: Request, res: Response) => {
  try {
    const event: TwilioStreamEvent = JSON.parse(req.body);
    console.log('Twilio Stream Event:', event.event);
    
    switch (event.event) {
      case 'start':
        console.log('Stream started:', {
          streamSid: event.start?.streamSid,
          callSid: event.start?.callSid,
          tracks: event.start?.tracks
        });
        break;
        
      case 'media':
        // This fires very frequently - only log occasionally
        if (Math.random() < 0.01) { // Log ~1% of media events
          console.log('Media packet received:', {
            timestamp: event.media?.timestamp,
            track: event.media?.track
          });
        }
        break;
        
      case 'stop':
        console.log('Stream stopped:', {
          streamSid: event.stop?.streamSid,
          callSid: event.stop?.callSid
        });
        break;
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error parsing Twilio stream event:', error);
    res.status(400).send('Bad Request');
  }
});

/**
 * Handle Twilio conference call connection for whisper
 */
router.post('/connect-conference/:conferenceName/:customerCallSid', (req: Request, res: Response) => {
    const { conferenceName, customerCallSid } = req.params;

    console.log('Conference connection requested:', {
        conferenceName,
        customerCallSid,
        agentNumber: req.body.From,
        digits: req.body.Digits
    });

    if (!conferenceName) {
      throw new Error("conferenceName is required");
    }

    if (!customerCallSid) {
      throw new Error("customerCallSid is required");
    }
    
    // Connect the agent to conference
    const agentTwiml = new twilio.twiml.VoiceResponse();
    agentTwiml.say({ voice: 'alice' }, 'Connecting you to the caller now.');
    agentTwiml.dial().conference({
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical'
    }, conferenceName);
    
    res.type('text/xml');
    res.send(agentTwiml.toString());
    
    // Add a small delay and then connect the customer
    setTimeout(() => {
        const customerTwiml = new twilio.twiml.VoiceResponse();
        customerTwiml.dial().conference({
            startConferenceOnEnter: false,
            endConferenceOnExit: true,
            waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical'
        }, conferenceName);
        
        client.calls(customerCallSid)
            .update({
                twiml: customerTwiml.toString()
            })
            .then(call => {
                console.log('Customer connected to conference:', call.sid);
            })
            .catch(error => {
                console.error('Error connecting customer to conference:', error);
            });
    }, 1000);
});

export { router };