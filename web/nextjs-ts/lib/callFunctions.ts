'use client';
import { UltravoxSession, UltravoxSessionStatus, Transcript, UltravoxExperimentalMessageEvent, Role } from 'ultravox-client';
import { JoinUrlResponse, CallConfig } from '@/lib/types';
import { updateOrderTool } from './clientTools';

let uvSession: UltravoxSession | null = null;
const debugMessages: Set<string> = new Set(["debug"]);

interface CallCallbacks {
  onStatusChange: (status: UltravoxSessionStatus | string | undefined) => void;
  onTranscriptChange: (transcripts: Transcript[] | undefined) => void;
  onDebugMessage?: (message: UltravoxExperimentalMessageEvent ) => void;
}

export function toggleMute(role: Role): void {

  if (uvSession) {
    // Toggle (user) Mic
    if (role == Role.USER) {
      uvSession.isMicMuted ? uvSession.unmuteMic() : uvSession.muteMic();
    } 
    // Mute (agent) Speaker
    else {
      uvSession.isSpeakerMuted ? uvSession.unmuteSpeaker() : uvSession.muteSpeaker();
    }
  } else {
    console.error('uvSession is not initialized.');
  }
}

async function createCall(callConfig: CallConfig, showDebugMessages?: boolean): Promise<JoinUrlResponse> {

  try {
    if(showDebugMessages) {
      console.log(`Using model ${callConfig.model}`);
    }

    const response = await fetch(`/api/ultravox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...callConfig }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    const data: JoinUrlResponse = await response.json();

    if(showDebugMessages) {
      console.log(`Call created. Join URL: ${data.joinUrl}`);
    }
    
    return data;
  } catch (error) {
    console.error('Error creating call:', error);
    throw error;
  }
}

export async function startCall(callbacks: CallCallbacks, callConfig: CallConfig, showDebugMessages?: boolean): Promise<void> {
  const callData = await createCall(callConfig, showDebugMessages);
  const joinUrl = callData.joinUrl;

  if (!joinUrl && !uvSession) {
    console.error('Join URL is required');
    return;
  } else {
    console.log('Joining call:', joinUrl);

    // Start up our Ultravox Session
    uvSession = new UltravoxSession({ experimentalMessages: debugMessages });
    
    // Register our tool for order details
    uvSession.registerToolImplementation(
      "updateOrder",
      updateOrderTool
    );

    if(showDebugMessages) {
      console.log('uvSession created:', uvSession);
      console.log('uvSession methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(uvSession)));
    }

    if (uvSession) {
      uvSession.addEventListener('status', (event: any) => {
        callbacks.onStatusChange(uvSession?.status);
      });
  
      uvSession.addEventListener('transcript', (event: any) => {
        callbacks.onTranscriptChange(uvSession?.transcripts);
      });
  
      uvSession.addEventListener('experimental_message', (msg: any) => {
        callbacks?.onDebugMessage?.(msg);
      });

      uvSession.joinCall(joinUrl);
      console.log('Session status:', uvSession.status);
    } else {
      return;
    }
  }

  console.log('Call started!'); 
}

export async function endCall(): Promise<void> {
  console.log('Call ended.');

  if (uvSession) {
    uvSession.leaveCall();
    uvSession = null;
  }

  // Dispatch a custom event when the call ends so that we can clear the order details form
  if (typeof window !== 'undefined') {
    const event = new CustomEvent('callEnded');
    window.dispatchEvent(event);
  }

}