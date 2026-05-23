const CONFIG = window.UAP_RAG_CONFIG || {};

const OLLAMA_BASE_URL = CONFIG.ollamaBaseUrl || "http://localhost:11434";
const OLLAMA_URL = `${OLLAMA_BASE_URL}/api/chat`;
const TOP_K = CONFIG.topK || 4;
const CHUNKS_URL = CONFIG.chunksUrl || "data/sample-chunks.json";
const MODELS = CONFIG.models || ["llama3.2:latest"];
const DEFAULT_MODEL = CONFIG.defaultModel || MODELS[0];

let chunks = [];        // The chunks 
let index = [];         // search index BM25 is going to create
let idf = new Map();    // Inverse do frequency
let avgDocLength = 0;   // Average length in tokens of all docs, is going to be used by BM25

const questionEl = document.querySelector("#question");
const modelEl = document.querySelector("#model");
const askBtn = document.querySelector("#askBtn");
const answerEl = document.querySelector("#answer");
const sourcesEl = document.querySelector("#sources");
const configStatusEl = document.querySelector("#configStatus");

// Configure the status 
function showConfigStatus() {
  configStatusEl.textContent =
    `Ollama: ${OLLAMA_BASE_URL} · Model: ${DEFAULT_MODEL} · Chunks: ${CHUNKS_URL}`;
}

// Return the text into tokens == words
function tokenize(text) {
  return text.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

// Load the LLM model options from the config.js
function loadModelOptions() {
  modelEl.innerHTML = "";

  for (const model of MODELS) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;

    if (model === DEFAULT_MODEL) {
      option.selected = true;
    }

    modelEl.appendChild(option);
  }
}

// load the chunks form the chunks.json and build the index
async function loadChunks() {
  const res = await fetch(CHUNKS_URL);
  chunks = await res.json();
  buildIndex();
}

// Creates BM25-ready index
function buildIndex() {
  index = chunks.map((chunk) => {
    const terms = tokenize(`${chunk.title} ${chunk.source} ${chunk.text}`);
    const counts = new Map();

    for (const term of terms) {
      counts.set(term, (counts.get(term) || 0) + 1);
    }

    return {
      chunk,
      counts,
      length: terms.length || 1 // Number of tokens
    };
  });

  const docFreq = new Map(); // Computer doc frequency for each term

  for (const doc of index) {
    for (const term of doc.counts.keys()) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  idf = new Map();

  // Compute IDF (inverse document frequency) based on the formula
  for (const [term, count] of docFreq) {
    idf.set(term, Math.log(1 + (index.length - count + 0.5) / (count + 0.5)));
  }

  // Average doc length across all chunks
  avgDocLength = index.reduce((sum, doc) => sum + doc.length, 0) / index.length;
}

// Main search function
function search(query) {
  const terms = [...new Set(tokenize(query))];
  const k1 = 1.5; 
  const b = 0.75;

  return index
    .map((doc) => {
      let score = 0;

      for (const term of terms) {
        const freq = doc.counts.get(term) || 0;
        if (!freq) continue;

        const termIdf = idf.get(term) || 0;
        const denom = freq + k1 * (1 - b + b * (doc.length / avgDocLength));
        score += termIdf * ((freq * (k1 + 1)) / denom);
      }

      return { ...doc.chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K); // Keep top 4
}


function getRankedSources(results) {
  const sourcesByTitle = new Map();

  for (const item of results) {
    const title = item.title || item.source || "Untitled source";
    const current = sourcesByTitle.get(title);

    if (!current || item.score > current.score) {
      sourcesByTitle.set(title, { title, score: item.score });
    }
  }

  return [...sourcesByTitle.values()].sort((a, b) => b.score - a.score);
}

function renderSources(results) {
  sourcesEl.innerHTML = "";

  const rankedSources = getRankedSources(results);

  if (!rankedSources.length) {
    sourcesEl.innerHTML = `<div class="box muted">No sources found.</div>`;
    return;
  }

  for (const [i, item] of rankedSources.entries()) {
    const div = document.createElement("div");
    div.className = "source";
    div.textContent = `${i + 1}. ${item.title}`;
    sourcesEl.appendChild(div);
  }
}

// Build the prompt that's going to be fed into Local Ollama
function buildPrompt(question, results) {
  const context = results
    .map((item, i) => `[${i + 1}] ${item.title} (${item.source}, page ${item.page})\n${item.text}`)
    .join("\n\n");

  return `
You answer questions about UAP files.
Do not invent new information.
Use only the context below.
Format the answer with short paragraphs and bullet points when useful. 
Use Markdown bold for key labels.
If the context is not enough, say that clearly.
Answer with bullet points.
Cite sources with [1], [2], etc.

Context:
${context}

Question:
${question}
`;
}

function cleanAnswer(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// Ask the Ollama the prompt
async function askOllama(question, results) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelEl.value,
      stream: false,
      messages: [
        {
          role: "system",
          content: "You are a careful, concise research assistant."
        },
        {
          role: "user",
          content: buildPrompt(question, results)
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error("Ollama request failed");
  }

  const data = await res.json();
  return cleanAnswer(data.message?.content || "No answer returned.");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
}

function inlineFormat(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
}

function renderAnswer(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let html = "";
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    const bullet = trimmed.match(/^(\*|-|\+)\s+(.*)$/);

    if (bullet) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }

      html += `<li>${inlineFormat(bullet[2])}</li>`;
      continue;
    }

    if (inList) {
      html += "</ul>";
      inList = false;
    }

    html += `<p>${inlineFormat(trimmed)}</p>`;
  }

  if (inList) {
    html += "</ul>";
  }

  answerEl.innerHTML = html;
}

// Main orchestrator, this runs when the user asks question
async function handleAsk() {
  const question = questionEl.value.trim();

  if (!question) {
    questionEl.focus();
    return;
  }

  askBtn.disabled = true;
  answerEl.textContent = "Searching...";
  answerEl.classList.add("muted");

  const results = search(question);
  renderSources(results);

  if (!results.length) {
    answerEl.textContent = "No matching chunks found.";
    askBtn.disabled = false;
    return;
  }

  answerEl.textContent = "Asking Ollama...";

  try {
    const answer = await askOllama(question, results);
    renderAnswer(answer);
    answerEl.classList.remove("muted");
  } catch {
    answerEl.textContent =
      "Ollama is not reachable. Start Ollama locally, pull the selected model, and try again.";
    answerEl.classList.add("muted");
  }

  askBtn.disabled = false;
}

askBtn.addEventListener("click", handleAsk);

questionEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleAsk();
  }
});

loadModelOptions();
showConfigStatus();
loadChunks();
