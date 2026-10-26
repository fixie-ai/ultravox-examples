// The agent's sample data, passed to the prompts. All names are fictional.

export interface SupportContext {
  company: string;
  agentName: string;
  supportHours: string;
}

export const supportContext: SupportContext = {
  company: 'Acme Internet',
  agentName: 'Riley',
  supportHours: '8 AM to 8 PM, Monday through Saturday',
};
