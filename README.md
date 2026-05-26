# UAP Files RAG

A small browser-based RAG app for asking questions over UAP document chunks. It searches local document chunks with BM25, sends the strongest matches to an LLM, and returns a grounded answer plus the most relevant source files to check.

The app supports two providers:

- **Local Ollama** for running a local model such as `llama3.2:latest`.
- **Groq** through the Vercel API route in `api/chat.js`.

## Project Structure

```text
.
|-- api/chat.js              # Vercel serverless proxy for Groq
|-- app.js                   # BM25 search, provider selection, answer rendering
|-- config.js                # Provider/model/chunk configuration
|-- index.html               # Static UI
|-- styles.css               # Site styling
|-- assets/                  # GIFs and other static assets
|-- data/chunks.json         # Main searchable chunks
|-- data/sample-chunks.json  # Small fallback sample dataset
`-- scripts/                 # Chunk-building helpers
```

## Adding New Releases

Put each release in its own folder under `data`. The folder name only needs to contain
`Release`, for example:

```text
data/
|-- Files-Release-1/
|-- Files-Release-2/
`-- processed/
```

The extraction script scans every release folder, stores the release number on each page,
and the chunk builder carries that into `data/chunks.json`. The UI then shows source files
as `Document Title (Release 2)`.

Full clean rebuild:

```powershell
python scripts\extract_pages.py
python scripts\build_chunks.py
```

Faster append workflow after adding a new release folder:

```powershell
python scripts\extract_pages.py --append
python scripts\build_chunks.py --append
```

Use the clean rebuild if you changed old PDFs, renamed release folders, or want to rebuild
everything from scratch. Use append when you only added new files.

## Retrieval Settings

The app uses a multi-step retrieval pass instead of sending only the first few BM25 hits:

1. Search a wider candidate set with BM25.
2. Group matching chunks by source document and release.
3. Expand around the strongest chunks with nearby chunks from the same document.
4. Pack the final context until `maxContextWords` is reached.

Tune this in `config.js`:

```js
topK: 6,              // Legacy/base value used to size candidate search
candidateK: 48,       // First-wave BM25 candidate chunks
maxContextDocs: 5,    // Max source documents in broad searches
chunksPerDocument: 3, // Direct hits per selected document
neighborChunks: 1,    // Nearby chunks before/after direct hits
maxContextWords: 6000 // Final prompt context budget
```

## Local Ollama

The default local provider expects Ollama at:

```text
http://localhost:11434/api/chat
```

You have to make sure that Ollama is running in Docker with NVIDIA GPU support for fast results, 
because by default Ollama runs with CPU which is annoying, you actually need docker to force GPU usage:

```powershell
docker start ollama
docker ps --format "table {{.Names}}\t{{.Ports}}"
docker exec ollama ollama pull llama3.2
docker exec ollama ollama run llama3.2 "Reply only: READY"
docker exec ollama ollama ps
```

To confirm GPU access inside Docker:

```powershell
docker exec ollama nvidia-smi
```

For browser access from deployed sites, the Ollama container must allow those origins. Example:

```powershell
docker stop ollama
docker rm ollama

docker run -d --gpus=all --name ollama --restart unless-stopped `
  -v ollama:/root/.ollama `
  -p 11434:11434 `
  -e OLLAMA_HOST=0.0.0.0:11434 `
  -e OLLAMA_ORIGINS="https://ufo-files-rag.vercel.app,https://cybrok3.github.io,https://*.vercel.app,https://*.github.io,http://localhost:*,http://127.0.0.1:*" `
  -e NVIDIA_VISIBLE_DEVICES=all `
  -e NVIDIA_DRIVER_CAPABILITIES=compute,utility `
  ollama/ollama
```

## Notes

- Local Ollama only works for users running Ollama on their own machine.
- Search is done in the browser against `data/chunks.json`; only the top matching chunks are sent to the selected LLM.
