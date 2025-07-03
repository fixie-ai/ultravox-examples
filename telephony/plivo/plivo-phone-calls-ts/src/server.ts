import express from 'express';
import plivo from 'plivo';
import { config } from 'dotenv';
import { createAgentCall } from './ultravox.js';

config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const plivoClient = new plivo.Client(process.env.PLIVO_AUTH_ID!, process.env.PLIVO_AUTH_TOKEN!);

// Outbound call endpoint
app.post('/outbound', async (req, res) => {
  try {
    const destination = req.body.destination || process.env.DESTINATION_PHONE_NUMBER;
    const callResponse = await plivoClient.calls.create(
      process.env.PLIVO_PHONE_NUMBER!,
      destination,
      `${process.env.WEBHOOK_BASE_URL}/connect`,
      { method: 'POST' }
    );

    res.json({ 
      success: true, 
      requestUuid: callResponse.requestUuid,
      message: `Call initiated to ${destination}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to make outbound call' });
  }
});

// Inbound call webhook
app.post('/inbound', (req, res) => {
  const response = plivo.Response();
  response.addRedirect(`${process.env.WEBHOOK_BASE_URL}/connect`, { method: 'POST' });
  res.type('text/xml').send(response.toXML());
});

// Connect call to Ultravox
app.post('/connect', async (req, res) => {
  try {
    const ultravoxResponse = await createAgentCall();
    
    const xmlString = `<Response>
  <Stream bidirectional="true" keepCallAlive="true">${ultravoxResponse.joinUrl}</Stream>
</Response>`;
    
    res.type('text/xml').send(xmlString);
  } catch (error) {
    const response = plivo.Response();
    response.addSpeak('Sorry, there was an error connecting your call. Please try again.');
    res.type('text/xml').send(response.toXML());
  }
});

// Start server
const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Webhook URLs:`);
  console.log(`  • Inbound: ${process.env.WEBHOOK_BASE_URL}/inbound`);
  console.log(`  • Connect: ${process.env.WEBHOOK_BASE_URL}/connect`);
});