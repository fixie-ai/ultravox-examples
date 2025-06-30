import https from 'https';
import dotenv from 'dotenv';
import type { UltravoxCallConfig, UltravoxResponse, AgentTool } from './types.js';

// Get our environment variables from .env file
dotenv.config();

const DESTINATION_PHONE_NUMBER = process.env.DESTINATION_PHONE_NUMBER;
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const SERVICE_API_KEY = process.env.SERVICE_API_KEY;

// Ultravox configuration
const ULTRAVOX_API_URL = 'https://api.ultravox.ai/api/calls';
const SYSTEM_PROMPT = 'Your name is Steve and you are calling a person on the phone. Ask them their name and see how they are doing.';

const getAgentTools = (baseUrl: string): AgentTool[] => {
    if (!DESTINATION_PHONE_NUMBER || !SERVICE_API_KEY) {
        throw new Error('DESTINATION_PHONE_NUMBER and SERVICE_API_KEY must be set');
    }

    return [
        {
            "temporaryTool": {
                "modelToolName": "transferCall",
                "description": "Transfers call to a human. Use this if a caller is upset or if there are questions you cannot answer.",
                "requirements": {
                    "httpSecurityOptions": {
                        "options": [
                            {
                                "requirements": {
                                    "api_key_auth": {
                                        "headerApiKey": {
                                            "name": "X-API-Key"
                                        }
                                    }
                                }
                            }
                        ]
                    }
                },
                "automaticParameters": [
                    {
                        "name": "ultravoxCallId",
                        "location": "PARAMETER_LOCATION_BODY",
                        "knownValue": "KNOWN_PARAM_CALL_ID"
                    }
                ],
                "staticParameters": [
                    {
                        "name": "destinationNumber",
                        "location": "PARAMETER_LOCATION_BODY",
                        "value": DESTINATION_PHONE_NUMBER
                    },
                    {
                        "name": "useWhisper",
                        "location": "PARAMETER_LOCATION_BODY",
                        "value": true
                    }
                ],
                "dynamicParameters": [
                {
                    "name": "firstName",
                    "location": "PARAMETER_LOCATION_BODY",
                    "schema": {
                    "description": "The caller's first name",
                    "type": "string",
                    },
                    "required": true,
                },
                {
                    "name": "lastName",
                    "location": "PARAMETER_LOCATION_BODY",
                    "schema": {
                        "description": "The caller's last name",
                        "type": "string",
                    },
                    "required": true,
                },
                {
                    "name": "transferReason",
                    "location": "PARAMETER_LOCATION_BODY",
                    "schema": {
                        "description": "The reason the call is being transferred.",
                        "type": "string",
                    },
                    "required": true,
                },
                ],
                "http": {
                    "baseUrlPattern": `${baseUrl}/api/transfer`,
                    "httpMethod": "POST",
                },
            },
            "authTokens": {
                "api_key_auth": SERVICE_API_KEY
            },
        }
    ];
}

const getUltravoxCallConfig = (baseUrl: string): UltravoxCallConfig => {
    const selectedTools = getAgentTools(baseUrl);
    return {
        systemPrompt: SYSTEM_PROMPT,
        model: 'fixie-ai/ultravox',
        voice: 'Mark',
        temperature: 0.3,
        firstSpeakerSettings: { user: {} },
        selectedTools: selectedTools,
        medium: { twilio: {} }
    };
};

export async function createUltravoxCall(baseUrl: string): Promise<UltravoxResponse> {
    if (!ULTRAVOX_API_KEY) {
        throw new Error('ULTRAVOX_API_KEY must be set');
    }

    const callConfig = getUltravoxCallConfig(baseUrl);
    console.log('Creating Ultravox call with Twilio as medium...');
    // Uncomment the line below to see full call configuration used for creating Ultravox call
    //console.log('Call configuration:', JSON.stringify(callConfig, null, 2));
    
    const request = https.request(ULTRAVOX_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': ULTRAVOX_API_KEY
        }
    });

    return new Promise((resolve, reject) => {
        let data = '';

        request.on('response', (response) => {
            console.log(`Ultravox API response status: ${response.statusCode} ${response.statusMessage}`);
            
            response.on('data', chunk => {
                data += chunk;
            });
            
            response.on('end', () => {
                console.log('Complete response data:', data);
                
                try {
                    const parsedData = JSON.parse(data) as UltravoxResponse;
                    
                    if (response.statusCode && response.statusCode >= 400) {
                        console.error('ERROR: API request failed with status', response.statusCode);
                        console.error('Error details:', JSON.stringify(parsedData, null, 2));
                        reject(new Error(`API request failed with status ${response.statusCode}: ${JSON.stringify(parsedData)}`));
                    } else {
                        console.log('API request succeeded');
                        resolve(parsedData);
                    }
                } catch (error) {
                    console.error('Failed to parse response data. Raw response:', data);
                    reject(new Error(`Failed to parse Ultravox response: ${(error as Error).message}. Raw response: ${data}`));
                }
            });
        });

        request.on('error', (error: Error) => {
            console.error('Network error during API call:', error.message);
            reject(error);
        });

        const jsonPayload = JSON.stringify(callConfig);
        console.log('Sending request payload:', jsonPayload);
        
        request.write(jsonPayload);
        request.end();
    });
}