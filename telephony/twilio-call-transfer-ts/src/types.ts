export interface CallData {
  callerNumber: string;
  startTime: Date;
  providerCallSid: string;
  joinUrl?: string;
}

export interface UltravoxCallConfig {
  systemPrompt: string;
  model: string;
  voice: string;
  temperature: number;
  firstSpeakerSettings: {
    user: Record<string, unknown>;
  };
  selectedTools: AgentTool[];
  medium: {
    twilio: Record<string, unknown>;
  };
}

export interface AgentTool {
  temporaryTool: {
    modelToolName: string;
    description: string;
    requirements: {
      httpSecurityOptions: {
        options: Array<{
          requirements: {
            api_key_auth: {
              headerApiKey: {
                name: string;
              };
            };
          };
        }>;
      };
    };
    automaticParameters: Parameter[];
    staticParameters: Parameter[];
    dynamicParameters: Parameter[];
    http: {
      baseUrlPattern: string;
      httpMethod: string;
    };
  };
  authTokens: {
    api_key_auth: string;
  };
}

export interface Parameter {
  name: string;
  location: string;
  value?: undefined | string | number | boolean;
  knownValue?: string;
  schema?: {
    description: string;
    type: string;
  };
  required?: boolean;
}

export interface UltravoxResponse {
  callId: string;
  joinUrl: string;
}

export interface CallResult {
  sid: string;
  status: string;
}

export interface TransferRequest {
  ultravoxCallId: string;
  destinationNumber: string;
  firstName?: string;
  lastName?: string;
  transferReason?: string;
  useWhisper?: boolean;
}

export interface TransferResult {
  status: 'success' | 'error';
  message: string;
  callDetails: {
    ultravoxCallId: string;
    destinationNumber: string;
    transferInitiated: Date;
    providerCallSid?: string;
    conferenceName?: string;
    transferReason?: string;
  };
}

export interface ApiResponse<T = unknown> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  timestamp?: Date;
}

export interface HealthResponse {
  status: string;
  timestamp: Date;
  server: {
    local: string;
    public: string;
  };
  webhookEndpoints: {
    status: string;
    streamEvents: string;
    recording: string;
  };
}

export interface TwilioStatusWebhook {
  CallSid: string;
  CallStatus: string;
  From: string;
  To: string;
  Duration?: string;
  RecordingUrl?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

export interface TwilioStreamEvent {
  event: 'start' | 'media' | 'stop';
  start?: {
    streamSid: string;
    callSid: string;
    tracks: string[];
  };
  media?: {
    timestamp: string;
    track: string;
    payload: string;
  };
  stop?: {
    streamSid: string;
    callSid: string;
  };
}