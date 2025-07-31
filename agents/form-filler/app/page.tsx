"use client";

import React, { useEffect, useRef, useState } from 'react';
import { UltravoxSession } from "ultravox-client";
import './App.css';
import Form from './components/Form';

interface FormField {
  type: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  label: string;
  options?: { value: string; label: string }[];
}

export default function Page() {
  const [formData, setFormData] = useState<Record<string, string | string[]>>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [formHtml, setFormHtml] = useState('');
  const formDataRef = useRef(formData);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  const sessionRef = useRef<UltravoxSession | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);

  useEffect(() => {
    const initialize = async () => {
      try {
        const [formFieldsResponse, formHtmlResponse] = await Promise.all([
          fetch("/api/get-form"),
          fetch("/form.html"),
        ]);
        const formFieldsData = await formFieldsResponse.json();
        const formHtmlData = await formHtmlResponse.text();

        setFormFields(formFieldsData);
        setFormHtml(formHtmlData);
        initializeFormData(formFieldsData);

        const uvSession = new UltravoxSession({ experimentalMessages: new Set(["debug"]) });
        sessionRef.current = uvSession;

        uvSession.registerToolImplementation('fillForm', (parameters) => {
          const { field } = parameters;
          const fieldName: string = Object.keys(field)[0];
          const formField = formFieldsData.find((f: FormField) => f.name === fieldName);

          if (formField?.type === 'checkbox') {
            setFormData(prev => ({
              ...prev,
              [fieldName]: Array.isArray(field[fieldName]) ? field[fieldName] : [...(prev[fieldName] || []), field[fieldName]],
            }));
          } else {
            setFormData(prev => ({
              ...prev,
              ...field,
            }));
          }
          return 'Form fields updated successfully!';
        });

        uvSession.registerToolImplementation('submitForm', () => {
          const requiredFields = formFieldsData.filter((field: FormField) => field.required).map((field: FormField) => field.name);
          const missingFields = requiredFields.filter((field: string) => {
            const value = formDataRef.current[field];
            return !value || (Array.isArray(value) && value.length === 0);
          });
          
          if (missingFields.length > 0) {
            const fieldNames = missingFields.map((fieldName: string) => formFieldsData.find((f: FormField) => f.name === fieldName)?.label || fieldName);
            return `I cannot submit the form yet. Please provide the following missing information: ${fieldNames.join(', ')}.`;
          }
          
          formRef.current?.requestSubmit();
          return 'Form submitted successfully!';
        });
        
        uvSession.addEventListener('transcripts', (_) => {
          const transcripts = uvSession.transcripts;
          const last = Array.isArray(transcripts) && transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;
          if (last?.speaker === 'agent' && last.isFinal) {
            if (/goodbye|bye\b|see you|have a great day|talk to you later|farewell|see ya|later/i.test(last.text)) {
              handleStopVoice();
            }
          }
        });

        setIsSessionReady(true);
      } catch (error) {
        console.error('Error initializing session:', error);
      }
    };
    initialize();
  }, []);

  const initializeFormData = (fields: FormField[]) => {
    const initialData: Record<string, string | string[]> = {};
    fields.forEach((field) => {
      initialData[field.name] = field.type === 'checkbox' ? [] : '';
    });
    setFormData(initialData);
  };

  async function createJoinUrl() {
    const response = await fetch("/api/create-call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: process.env.NEXT_PUBLIC_ULTRAVOX_AGENT_ID,
        formFields: formFields,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to create call. Status:", response.status, "Response:", errorText);
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: errorText };
      }
      throw new Error(`Failed to create call: ${errorData.error || response.statusText}`);
    }

    const data = await response.json();
    return data.joinUrl || data.join_url;
  }

  async function handleStartVoice() {
    const uvSession = sessionRef.current;
    if (!isSessionReady || !uvSession) return;
    try {
      const joinUrl = await createJoinUrl();
      if (!joinUrl) {
        console.error('joinUrl is null or undefined. Aborting call.');
        return;
      }
      const modifiedJoinUrl = joinUrl.substring(0, joinUrl.lastIndexOf('/'));
      uvSession.joinCall(modifiedJoinUrl);
      setIsSpeaking(true);
    } catch (error) {
      console.error('Error starting voice session:', error);
    }
  }

  async function handleStopVoice() {
    const uvSession = sessionRef.current;
    if (uvSession) {
      try {
        await uvSession.leaveCall();
        setIsSpeaking(false);
      } catch (error) {
        console.error('Error stopping voice session:', error);
      }
    } else {
      setIsSpeaking(false);
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prevData) => {
      if (type === "checkbox") {
        const existingValues = (prevData[name] as string[]) || [];
        if (checked) {
          return { ...prevData, [name]: [...existingValues, value] };
        } else {
          return {
            ...prevData,
            [name]: existingValues.filter((v: string) => v !== value),
          };
        }
      }
      return { ...prevData, [name]: value };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Form submitted:", formData);
    alert("Form submitted successfully!");
    initializeFormData(formFields);
  };

  return (
    <div className="App">
      <div className="form-container">
        <div className="form-header">
          <h1>Ultravox Form Assistant Demo</h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '16px 0' }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: isSpeaking ? '#34c759' : '#d93025',
                marginRight: 4,
                border: '1.5px solid #e8eaed',
                transition: 'background-color 0.2s',
              }}
            ></span>
            <span style={{ color: isSpeaking ? '#34c759' : '#d93025', fontWeight: 600, fontSize: 12, marginRight: 8 }}>
              {isSpeaking ? 'ON' : 'OFF'}
            </span>
            <button
              type="button"
              className="submit-button"
              style={{ minWidth: 80, marginLeft: 8 }}
              onClick={isSpeaking ? handleStopVoice : handleStartVoice}
            >
              {isSpeaking ? 'Stop' : 'Start'}
            </button>
          </div>
          <p style={{ marginTop: 0, color: '#5f6368', fontSize: 15 }}>
            This voice agent will ask you a few questions, then use tool calls to auto-complete and submit the form below.
          </p>
        </div>
        <Form
          formFields={formFields}
          formData={formData}
          handleInputChange={handleInputChange}
          handleSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
