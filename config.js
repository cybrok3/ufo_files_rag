window.UAP_RAG_CONFIG = {
  providers: {
    ollama: {
      label: "Local Ollama",
      chatUrl: "http://localhost:11434/api/chat",
      models: ["llama3.2:latest"]
    },
    groq: {
      label: "Groq",
      chatUrl: "/api/chat",
      models: ["llama-3.3-70b-versatile"]
    }
  },
  defaultProvider: "groq",
  topK: 6,
  chunksUrl: "data/chunks.json"
};
