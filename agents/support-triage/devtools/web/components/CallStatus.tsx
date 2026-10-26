import React from 'react';
import { UltravoxSessionStatus } from 'ultravox-client';

interface CallStatusProps {
  status: UltravoxSessionStatus;
}

const CallStatus: React.FC<CallStatusProps> = ({ status }) => {
  const getStatusColor = () => {
    switch (status) {
      case UltravoxSessionStatus.SPEAKING:
        return 'text-green-600';
      case UltravoxSessionStatus.CONNECTING:
        return 'text-amber-600';
      case UltravoxSessionStatus.DISCONNECTED:
        return 'text-red-600';
      case UltravoxSessionStatus.LISTENING:
        return 'text-blue-600';
      default:
        return 'text-slate-400';
    }
  };

  return (
    <div className="text-sm flex items-center gap-1">
      <span className="mr-1">Call Status:</span>
      <span className={`font-medium ${getStatusColor()}`}>
        {status}
      </span>
    </div>
  );
};

export default CallStatus;