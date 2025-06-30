import express, { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { Server } from 'http';
import { transferActiveCall, getCallDetails, activeCalls } from './callManager.js';
import type { TransferRequest, ApiResponse, HealthResponse } from './types.js';
import { router as webhookRoutes } from './webhooks.js';

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(morgan('dev'));

let publicUrl: string | undefined;
let baseUrl: string;

// Enhanced logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.url}`);
  
  // Enhanced logging for webhook requests
  if (req.url.includes('webhook') || req.url.includes('status') || req.url.includes('stream-events')) {
    console.log(`🔔 Webhook detected: ${req.method} ${req.url}`);
    console.log('Headers:', {
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type'],
      'x-twilio-signature': req.headers['x-twilio-signature'] ? 'Present' : 'Missing'
    });
  }
  
  next();
});

// Simple API key validation middleware
const validateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey || apiKey !== process.env.SERVICE_API_KEY) {
    res.status(401).json({ 
      status: 'error', 
      message: 'Unauthorized: Invalid or missing API key' 
    } as ApiResponse);
    return;
  }
  
  next();
};

// Routes
app.get('/api/health', (req: Request, res: Response) => {
  const healthResponse: HealthResponse = { 
    status: 'ok', 
    timestamp: new Date(),
    server: {
      local: `http://localhost:${process.env.API_PORT || 3000}`,
      public: publicUrl || 'Not available yet'
    },
    webhookEndpoints: {
      status: `${baseUrl}/status`,
      streamEvents: `${baseUrl}/stream-events`,
      recording: `${baseUrl}/recording`
    }
  };
  
  res.json(healthResponse);
});

// Get call details
app.get('/api/calls/:callId', validateApiKey, (req: Request, res: Response) => {
  const { callId } = req.params;

  if (!callId) {
    res.status(404).json({ 
      status: 'error',
      message: `CallId is required.`
    } as ApiResponse);
    return;
  }

  const callDetails = getCallDetails(callId);
  
  if (!callDetails) {
    res.status(404).json({ 
      status: 'error',
      message: `Call not found: ${callId}`
    } as ApiResponse);
    return;
  }
  
  // Prepare a sanitized version of call details
  const sanitizedDetails = {
    ultravoxCallId: callId,
    provider: 'twilio',
    providerCallSid: callDetails.providerCallSid.substring(0, 5) + '...',
    callerNumber: callDetails.callerNumber,
    startTime: callDetails.startTime
  };
  
  res.json({
    status: 'success',
    data: sanitizedDetails
  } as ApiResponse<typeof sanitizedDetails>);
});

app.get('/api/debug/calls', validateApiKey, (req: Request, res: Response) => {
  try {
    // Convert Map to array of objects for JSON response
    const callsArray = Array.from(activeCalls.entries()).map(([ultravoxCallId, callData]) => {
      return {
        ultravoxCallId,
        ...callData
      };
    });
    
    res.json({
      status: 'success',
      timestamp: new Date(),
      activeCalls: callsArray,
      count: callsArray.length
    } as ApiResponse<{ activeCalls: typeof callsArray; count: number; timestamp: Date }>);
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({
      status: 'error',
      message: (error as Error).message || 'Unknown error occurred'
    } as ApiResponse);
  }
});

// Transfer call endpoint
app.post('/api/transfer', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { ultravoxCallId, destinationNumber, firstName, lastName, transferReason, useWhisper }: TransferRequest = req.body;
    console.log(`Incoming request to /api/transfer...`);
    // Log additional fields if provided
    if (firstName || lastName || transferReason) {
      console.log('Transfer request details:');
      if (firstName) console.log(`First Name: ${firstName}`);
      if (lastName) console.log(`Last Name: ${lastName}`);
      if (transferReason) console.log(`Transfer Reason: ${transferReason}`);
      if (useWhisper) console.log(`Use Whisper Transfer: ${useWhisper}`);
    }

    // Validate input
    if (!ultravoxCallId || !destinationNumber) {
      res.status(400).json({
        status: 'error',
        message: 'Missing required fields: ultravoxCallId and destinationNumber'
      } as ApiResponse);
      return;
    }
    
    // Validate phone number format
    if (!/^\+[1-9]\d{1,14}$/.test(destinationNumber)) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid phone number format. Must be E.164 format (e.g., +15551234567)'
      } as ApiResponse);
      return;
    }
    
    // Attempt to transfer the call
    let result;
    if (useWhisper && useWhisper === true) {
      result = await transferActiveCall(ultravoxCallId, destinationNumber, transferReason);
    } else {
      result = await transferActiveCall(ultravoxCallId, destinationNumber);
    }
    
    res.json({
      status: 'success',
      data: result
    } as ApiResponse<typeof result>);
    
  } catch (error) {
    console.error('Transfer API error:', error);
    const errorMessage = (error as Error).message;
    res.status(errorMessage?.includes('not found') ? 404 : 500).json({
      status: 'error',
      message: errorMessage || 'Unknown error occurred'
    } as ApiResponse);
  }
});

// Mount webhook routes
app.use('/', webhookRoutes);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('API Server Error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal Server Error'
  } as ApiResponse);
});

/**
 * Start the API server
 * @param port - Port to listen on
 * @param ngrokUrl - Ngrok URL (if used)
 * @returns The HTTP server instance 
 */
async function startApiServer(port: number = 3000, ngrokUrl?: string): Promise<{ server: Server }> {
  publicUrl = ngrokUrl;
  baseUrl = ngrokUrl || `http://localhost:${port}`;

  // Start the Express server
  const server = app.listen(port, () => {
    console.log(`API Server listening on port ${port}`);
    console.log(`Public URL: ${baseUrl}`);
    console.log(`Twilio Status: ${baseUrl}/status`);
    console.log(`Twilio Streams: ${baseUrl}/stream-events`);
  });
  
  return {
    server
  };
}

export { startApiServer };