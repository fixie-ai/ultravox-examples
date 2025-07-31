import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, formFields } = body;
    if (!process.env.ULTRAVOX_API_KEY) {
      console.error('ULTRAVOX_API_KEY is not set');
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }
    if (!agentId) {
      console.error('Agent ID is not provided');
      return NextResponse.json(
        { error: 'Agent ID not configured' },
        { status: 500 }
      );
    }

    const response = await fetch(`https://api.ultravox.ai/api/agents/${agentId}/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.ULTRAVOX_API_KEY,
      },
      body: JSON.stringify({
        medium: {
          serverWebSocket: {
            input_sample_rate: 16000,
          },
        },
        templateContext: {
          form_fields: JSON.stringify(formFields, null, 2),
        }
      }),
    });

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errorData = await response.text();
        try {
          const parsedError = JSON.parse(errorData);
          errorMessage = parsedError.error || parsedError.message || errorData;
        } catch {
          errorMessage = errorData;
        }
      } catch (e) {
        console.error('Could not read error response:', e);
      }
      
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error creating call:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
} 