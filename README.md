# Commands

Local LLM:
* docker start ollama
* docker ps --format "table {{.Names}}\t{{.Ports}}"
* docker exec ollama ollama pull llama3.2
* docker exec ollama ollama run llama3.2 "Reply only: READY"
* docker exec ollama ollama ps