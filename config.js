window.UAP_RAG_CONFIG = {
  ollamaBaseUrl: "http://localhost:11434",
  defaultModel: "llama3.2:latest",
  models: [
    "llama3.2:latest",
    "qwen2.5:7b-instruct"
  ],
  topK: 4,
  chunksUrl: "data/chunks.json"
};