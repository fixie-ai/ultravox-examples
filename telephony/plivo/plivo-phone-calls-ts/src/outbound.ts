import { config } from 'dotenv';
config();

async function makeOutboundCall(destination?: string): Promise<void> {
  const targetNumber = destination || process.env.DESTINATION_PHONE_NUMBER;
  const port = parseInt(process.env.PORT || '3000');
  
  try {
    const response = await fetch(`http://localhost:${port}/outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination: targetNumber }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Call initiated to ${targetNumber} (UUID: ${data.requestUuid})`);
  } catch (error) {
    console.error('Error making call:', error);
    process.exit(1);
  }
}

const destination = process.argv[2];
makeOutboundCall(destination);