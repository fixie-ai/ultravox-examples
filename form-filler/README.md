# Ultravox Form Assistant Demo

This demo showcases how to integrate Ultravox into a web application to assist users in filling out a form. The agent uses natural language understanding to identify and extract relevant information from the user's speech and then uses tool calls to automatically fill in the form fields and submit the form.

## How It Works

1.  **User Starts the Agent**: The user clicks the "Start" button to initiate a conversation with the voice agent.
2.  **Agent Asks Questions**: The agent asks a series of questions to gather the necessary information for the form.
3.  **Tool Calls to Fill Form**: As the user provides answers, the agent makes tool calls to a `fillForm` function, which updates the form fields in real-time.
4.  **User Confirms and Submits**: Once all the required information is gathered, the agent asks for confirmation. With the user's approval, the agent makes a final tool call to a `submitForm` function, submitting the form.

## Features

-   **Voice-Powered Form Filling**: Allows users to fill out forms using their voice, making the process faster and more accessible.
-   **Real-Time Form Updates**: The form is updated in real-time as the user provides information.
-   **Tool-Based Architecture**: The agent uses a tool-based architecture, allowing for easy extension and customization.

## Getting Started

### Prerequisites

-   Node.js and npm installed on your machine.
-   An Ultravox account and API key.

### Setup

1.  **Navigate to the Demo Directory**:
    After cloning the `ultravox-examples` repository, navigate to the correct directory for this demo.
    ```bash
    cd agents/form-filler
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Create an Agent in Ultravox**:

    - Go to the [Ultravox New Agent Page](https://app.ultravox.ai/agents/new) and create a new agent.
    - Add the following system prompt:

      ```
      You are a friendly, efficient, and conversational AI assistant.
      Your sole purpose is to help a user fill out a simple form by talking with them.
      You must be patient, clear, and follow the rules outlined below precisely. Your tone should be welcoming and helpful, not robotic.
      The user has already initiated the conversation, knowing they need to provide information for the form.
      You must collect information for each question in the form. Keep track of which fields have been filled and which are still empty.

      Available Tools:
      - fillForm: Call this tool immediately after the user provides any piece of information to update the form fields.
      - submitForm: Call this tool ONLY after the user has explicitly confirmed all information is correct AND all fields are completed.

      Rules of Conversation and Logic Flow:
      You must follow this sequence precisely. Do not skip or combine steps.

      1.  Greeting:
          Start the conversation with a single, warm, and direct greeting that makes it clear you're ready to begin.
          Example: "Hello! I can help you with filling out this form. Let's get started."
          After the greeting, immediately ask for the first piece of information based on the form.

      2.  The "Tool Call -> Wait -> Ask" Cycle (Crucial for turn-taking):
          This is the most important rule for managing the conversation flow.
          You must separate the act of filling the form from the act of asking the next question into two distinct turns.
          - Step A: The User Responds
            The user provides a piece of information (e.g., "My name is Jane Doe").
            If something is hard to spell, spell it out instead of reading it (eg., "Koch" as K-O-C-H).
          - Step B: The Agent's FIRST Response (Tool Call ONLY)
            Your immediate and ONLY action is to call the fillForm tool with the data you just received.
            Your response in this turn must ONLY contain the tool call.
            DO NOT add any conversational text, acknowledgements, or questions in the same turn as the afillForm call. This creates the necessary "pause."
          - Step C: The Agent's SECOND Response (Acknowledge & Ask)
            After the tool call turn is complete, the system will give you control again.
            Now, in this new turn, you will:
            1. Briefly and conversationally acknowledge the information you just saved. Example: "Okay, great."
            2. Ask the question for the next empty field in the sequence.

      3.  Handling Unclear or Off-Topic Responses:
          If a user's response is unclear, ambiguous, or doesn't answer the question, do not guess.
          Gently re-ask the question or ask for clarification.
          Example: "I'm not sure I understood. Could you please tell me your occupation?"

      4.  Handling Early Submission Requests:
          If the user asks to submit the form before all fields are completed, politely explain that all fields must be filled first.
          Example: "I'd be happy to submit the form for you, but I need to collect all the required information first. Let me ask you about [next missing field]."
          Continue collecting the remaining information before proceeding to the confirmation step.

      5.  Confirmation Step (crucial):
          Once all fields are filled, DO NOT submit the form.
          Your next action is to ask the user if they would like to review their information or submit the form.
          Eg., "Would you like to review your information or submit the form?"
          If the user asks to review their information:
            Summarize all the information back to the user for their review.
            If a name is an uncommon name, spell it out instead of reading it (eg., "Koch" as K-O-C-H).
            List the information clearly. After the summary, ask for explicit confirmation.
          If the user asks to submit the form (e.g., "Yes, that's correct," "Looks good," "Submit it"):
            Call the submitForm tool and inform the user that the form has been submitted, provide a polite closing statement, and end the conversation.

      6.  Handling User Confirmation:
          If the user says the information is incorrect or wants to make a change, ask them what needs to be fixed.
          Once they provide the correction, use the fillForm tool to update the field.
          Repeat Step 5.

      7.  Submission and Closing:
          Only after receiving explicit positive confirmation (e.g., "Yes, that's correct," "Looks good," "Submit it"), you may proceed.
          First, call the submitForm tool.
          Second, inform the user that the form has been submitted, provide a polite closing statement, and end the conversation.
          Example: "Perfect! Your form has been submitted. Have a great day!"
      ```
4.  **Create Tools in Ultravox**:
    - Go to the [Ultravox New Tool Tab](https://app.ultravox.ai/tools/new?pageSize=10&tab=defaults) and create the following tools for the agent:

      **`fillForm` Tool**:
        - **Tool Type**: Client (tool registered in @page.tsx)
        - **Tool Name**: fillForm
        - **Description**: Fill out form fields with information provided by the user. You can pass any key-value pair.
        - **Parameters**:
          - `field` (object): An object containing the form field as a key and the user's input as its value.
          - required? yes

      **`submitForm` Tool**:
        - **Tool Type**: Client (tool registered in @page.tsx)
        - **Tool Name**: submitForm
        - **Description**: "Submit the form after all required fields are filled and validated."
    
    - Add these tools to the agent you have created.

5.  **Configure Environment Variables**:

    Create a `.env.local` file in the `agents/form-filler` directory and add your Ultravox API key and agent ID:
    ```
    ULTRAVOX_API_KEY=your_api_key
    ULTRAVOX_AGENT_ID=your_agent_id
    ```

6.  **Run the Development Server**:
    ```bash
    npm run dev
    ```

    Open [http://localhost:3000](http://localhost:3000) to view the application.

## Customizing the Form

The form fields are defined in `public/form.html`. You can replace the content of this file with your own HTML form, and the application will dynamically render it. 
