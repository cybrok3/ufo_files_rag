# Commands

Local LLM:
* docker start ollama
* docker ps --format "table {{.Names}}\t{{.Ports}}"
* docker exec ollama ollama pull llama3.2
* docker exec ollama ollama run llama3.2 "Reply only: READY"
* docker exec ollama ollama ps
* docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi (make it use gpu only for faster results)
* python -m http.server 8080