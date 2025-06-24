import React, { useState, useEffect, useRef } from "react";
import { UltravoxExperimentalMessageEvent } from "ultravox-client";
import ToggleSwitch from "@/app/components/ui/Toggle";

interface DebugMessagesProps {
  debugMessages: UltravoxExperimentalMessageEvent[];
}

const DebugMessages: React.FC<DebugMessagesProps> = ({ debugMessages }) => {
  const [messages, setMessages] = useState<UltravoxExperimentalMessageEvent[]>(
    []
  );
  const [showDebugMessages, setShowDebugMessages] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(debugMessages);
  }, [debugMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleToggle = () => {
    setShowDebugMessages(!showDebugMessages);
  };

  return (
    <div className="mb-4 flex flex-col max-w-[1206px] mx-auto w-full py-5 pr-[10px]">
      <div className="flex flex-row">
        <h2 className="text-lg font-mono mr-4">Debug View</h2>
        <ToggleSwitch
          id="toggleDebug"
          isOn={showDebugMessages}
          handleToggle={handleToggle}
        />
      </div>

      {showDebugMessages && debugMessages && debugMessages.length > 0 && (
        <div className="mt-4 border-b border-[#3A3B3F]">
          <div className="h-40">
            <div ref={scrollRef} className="h-full pr-2 scrollbar-visible">
              {messages.map((msg, index) => (
                <p
                  key={index}
                  className="text-sm font-mono text-gray-200 py-2 border-dotted border-b border-[#3A3B3F]"
                >
                  {msg.message.message}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugMessages;
