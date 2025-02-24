const ai = require('unlimited-ai');
const fs = require('fs').promises;
const path = require('path');

const models = new Set([
  'gpt-4o-mini-free', 'gpt-4o-mini', 'gpt-4o-free', 'gpt-4-turbo-2024-04-09',
  'gpt-4o-2024-08-06', 'grok-2', 'grok-2-mini', 'claude-3-opus-20240229',
  'claude-3-opus-20240229-gcp', 'claude-3-sonnet-20240229', 'claude-3-5-sonnet-20240620',
  'claude-3-haiku-20240307', 'claude-2.1', 'gemini-1.5-flash-exp-0827', 'gemini-1.5-pro-exp-0827'
]);

const conversationHistoryFile = path.join(__dirname, 'conversationHistories.json');
let conversationHistories = {};

// Load conversation histories from the file
async function loadConversationHistories() {
  try {
    const data = await fs.readFile(conversationHistoryFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading conversation histories:", error);
    return {};
  }
}

// Save conversation histories to the file
async function saveConversationHistories() {
  try {
    await fs.writeFile(conversationHistoryFile, JSON.stringify(conversationHistories, null, 2));
  } catch (error) {
    console.error("Error saving conversation histories:", error);
  }
}

exports.config = {
  name: 'ai',
  author: 'Zishin Sama',
  description: 'Advanced API for dynamic text generation using various AI models',
  category: 'ai',
  usage: ['/ai?q=hi&id=100']
};

exports.initialize = async function ({ req, res }) {
  const { q: question, id: userId, model, system } = req.query;

  if (!userId || !question) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).send(
      JSON.stringify({
        status: 400,
        data: {
          error: "Missing required parameters",
          message: "Please provide 'id' and 'q' query parameters.",
          exampleUsage: "/ai?q=Hello&id=100&model=gpt-4-turbo-2024-04-09&system=You%20are%20a%20helpful%20assistant"
        }
      }, null, 2)
    );
  }

  if (question.toLowerCase() === 'clear') {
    delete conversationHistories[userId];
    await saveConversationHistories();  // Immediate save on clear
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(
      JSON.stringify({
        status: 200,
        data: {
          message: "Conversation history has been cleared."
        }
      }, null, 2)
    );
  }

  // Initialize or retrieve user's conversation history
  if (!conversationHistories[userId]) {
    conversationHistories[userId] = {
      history: [],
      model: model && models.has(model) ? model : 'gpt-4-turbo-2024-04-09',
      system: system || null  // Save system if provided
    };
  } else {
    // Update model or system if new valid values are provided
    if (model && !models.has(model)) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).send(
        JSON.stringify({
          status: 400,
          data: {
            error: "Invalid model",
            message: `The provided model '${model}' is not valid. Please choose from the available models.`
          }
        }, null, 2)
      );
    }
    if (model && models.has(model) && model !== conversationHistories[userId].model) {
      conversationHistories[userId].model = model;
    }
    if (system) {
      conversationHistories[userId].system = system; // Update system role
    }
  }

  const userConversation = conversationHistories[userId];

  // Prepare messages for AI, including history and system role
  const messages = [
    ...(userConversation.system ? [{ role: 'system', content: userConversation.system }] : []),
    ...userConversation.history.flatMap(conv => [
      { role: 'user', content: conv.question },
      { role: 'assistant', content: conv.response }
    ]),
    { role: 'user', content: question }
  ];

  try {
    const chatResponse = await ai.generate(userConversation.model, messages);

    // Store the new conversation in user history
    userConversation.history.push({ question, response: chatResponse });

    // Save updated histories immediately after each new conversation
    await saveConversationHistories();

    // Clean API response
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(
      JSON.stringify({
        status: 200,
        data: {
          query: question,
          response: chatResponse,
          author: exports.config.author
        }
      }, null, 2)
    );
  } catch (error) {
    console.error("Error in AI response generation:", error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).send(
      JSON.stringify({
        status: 500,
        data: {
          error: "Internal Server Error",
          message: "An unexpected error occurred during AI response generation. Please try again later.",
          errorDetails: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      })
    );
  }
};

// Load initial conversation histories when the server starts
(async () => {
  conversationHistories = await loadConversationHistories();
})();

// Write histories to file when the server is shutting down
process.on('SIGINT', async () => {
  console.log('Server is shutting down. Writing conversation histories to file...');
  await saveConversationHistories();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Server is being terminated. Writing conversation histories to file...');
  await saveConversationHistories();
  process.exit(0);
});
