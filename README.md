# Ultravox Examples

A comprehensive collection of examples and solutions demonstrating how to integrate Ultravox AI voice technology into your applications. These examples cover both telephony and web implementations, from simple quickstarts to advanced use cases.

## Agents

| Example                     | Location                      | Description                                                                                                                   |
|-----------------------------|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| **Agent Creator**           | `agents/demo-agent-js/`       | Ultravox demo agent creator. Uses JavaScript and shows how to create a simple agent.                                          |
| **No Code Outbound Caller** | `agents/n8n-outbound-caller/` | No-code agent that makes outbound calls using n8n and Twilio. Agent configured via Ultravox web app with workflow automation. |
| **Form Filler**           | `agents/form-filler/`       | Integrate an agent into a web app to assist users in filling out a form. Agent and tools configured via Ultravox web app. |
## Ultravox + Telephony

These all show how to use various telephony providers with Ultravox and demonstrate having agents make and receive calls along with how to do call transfers.

| Example                        | Location                                   | Description                                                                                                                                              |
|--------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Twilio Inbound Quickstart**  | `telephony/twilio-inbound-quickstart-js/`  | Simple Node.js app that connects incoming Twilio calls to an Ultravox AI agent.                                                                          |
| **Twilio Incoming Advanced**   | `telephony/twilio-incoming-advanced-js/`   | Advanced inbound call handler with RAG, calendar booking, call transfers, and transcript processing ([video walkthrough](https://youtu.be/sa9uF5Rr9Os)). |
| **Twilio Outbound Quickstart** | `telephony/twilio-outbound-quickstart-js/` | Make AI-powered outbound phone calls using Ultravox and Twilio.                                                                                          |
| **Twilio Call Transfer**       | `telephony/twilio-call-transfer-ts/`       | How to implement call transfers from AI agent to a human when using Twilio.                                                                              |
| **No Code Outbound Caller**    | `agents/n8n-outbound-caller/`              | No-code agent that makes outbound calls using n8n and Twilio. Agent configured via Ultravox web app with workflow automation.                            |
| **Plivo Calls**                | `telephony/plivo/plivo-phone-calls-ts/`.   | Make outbound calls and receive inbound calls with Plivo. Uses TypeScript.                                                                               |


## Ultravox + Web Apps
How to use the Ultravox SDK to integrate voice AI calls into web apps.

| Example                     | Location                  | Description                                                                     |
|-----------------------------|---------------------------|---------------------------------------------------------------------------------|
| **Web Quickstart**          | `web/web-quickstart.html` | Single HTML file for quick Ultravox web integration testing (development only). |
| **Next.js TypeScript Demo** | `web/nextjs-ts/`          | Production-ready web app with TypeScript, deployable to Vercel.                 |

## 📚 Additional Resources

- [Ultravox Documentation](https://docs.ultravox.ai)
- [Discord Community](https://discord.com/channels/1240071833798184990/1323352273165881426/1323352273165881426) for early access to new features
- Each example includes its own detailed README with step-by-step instructions
