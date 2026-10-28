import React from 'react';

interface CallControlsProps {
  callActive: boolean;
  isStartingCall: boolean;
  onStartCall: () => void;
  onEndCall: () => void;
}

const CallControls: React.FC<CallControlsProps> = ({ callActive, isStartingCall, onStartCall, onEndCall }) =>
  !callActive ? (
    <button
      onClick={onStartCall}
      disabled={isStartingCall}
      className={`text-white py-1.5 px-4 rounded-md text-sm font-medium transition-colors ${isStartingCall ? 'bg-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
    >
      {isStartingCall ? 'Starting Call...' : 'Start Call'}
    </button>
  ) : (
    <button onClick={onEndCall} className="bg-red-600 text-white py-1.5 px-3 rounded-md text-sm font-medium hover:bg-red-700">
      End Call
    </button>
  );

export default CallControls;
