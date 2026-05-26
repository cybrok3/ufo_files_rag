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
  candidateK: 48,
  maxContextDocs: 5,
  chunksPerDocument: 3,
  neighborChunks: 1,
  maxContextWords: 6000,
  chunksUrl: "data/chunks.json"
};
