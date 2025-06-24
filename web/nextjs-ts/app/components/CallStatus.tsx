import React, { ReactNode, useState } from 'react';

interface CallStatusProps {
  status: string;
  children?: ReactNode;
}

const CallStatus: React.FC<CallStatusProps> = ({ status, children }) => {
  return (
    <div className="flex flex-col bg-[#121212] border border-[#2A2A2A] rounded-r-[1px] p-4 w-full lg:w-1/3">
      <div className="mt-2">
        <h2 className="text-xl font-semibold mb-2">Call Status</h2>
        <p className="text-lg font-mono text-gray-400">Status: <span className="text-white text-base">{status}</span></p>
        {/* TODO <p className="font-mono text-gray-400">Latency: <span className="text-gray-500">N/A</span></p> */}
        {/* TODO <p className="font-mono">00:00</p> */}
      </div>

      {/* Optional Children */}
      {children}
    </div>
  );
};

export default CallStatus;