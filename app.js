const CONFIG = window.UAP_RAG_CONFIG || {};

const DEFAULT_PROVIDERS = {
  ollama: {
    label: "Local Ollama",
    chatUrl: "http://localhost:11434/api/chat",
    models: ["llama3.2:latest"]
  }
};
const PROVIDERS = CONFIG.providers || DEFAULT_PROVIDERS;
const PROVIDER_KEYS = Object.keys(PROVIDERS);
const DEFAULT_PROVIDER = PROVIDERS[CONFIG.defaultProvider]
  ? CONFIG.defaultProvider
  : PROVIDER_KEYS[0];
const TOP_K = CONFIG.topK || 4;
const CHUNKS_URL = CONFIG.chunksUrl || "data/sample-chunks.json";
const CANDIDATE_K = CONFIG.candidateK || Math.max(TOP_K * 8, 40);
const MAX_CONTEXT_WORDS = CONFIG.maxContextWords || 6000;
const MAX_CONTEXT_DOCS = CONFIG.maxContextDocs || 5;
const CHUNKS_PER_DOCUMENT = CONFIG.chunksPerDocument || 3;
const NEIGHBOR_CHUNKS = CONFIG.neighborChunks || 1;
const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "about",
  "be",
  "by",
  "can",
  "did",
  "do",
  "does",
  "doc",
  "docs",
  "document",
  "documents",
  "file",
  "files",
  "for",
  "from",
  "give",
  "how",
  "in",
  "into",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "release",
  "so",
  "show",
  "summarize",
  "summary",
  "tell",
  "that",
  "the",
  "their",
  "them",
  "these",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with"
]);

let chunks = [];        // The chunks 
let index = [];         // search index BM25 is going to create
let chunksByDocument = new Map();
let idf = new Map();    // Inverse do frequency
let avgDocLength = 0;   // Average length in tokens of all docs, is going to be used by BM25

const questionEl = document.querySelector("#question");
const providerEl = document.querySelector("#provider");
const modelEl = document.querySelector("#model");
const askBtn = document.querySelector("#askBtn");
const answerEl = document.querySelector("#answer");
const answerSectionEl = document.querySelector("#answerSection");
const sourcesEl = document.querySelector("#sources");
const sourcesSectionEl = document.querySelector("#sourcesSection");
const configStatusEl = document.querySelector("#configStatus");
const infoToggleEl = document.querySelector("#infoToggle");

function getSelectedProvider() {
  return PROVIDERS[providerEl.value] || PROVIDERS[DEFAULT_PROVIDER];
}

function showResultSections() {
  answerSectionEl.classList.remove("is-hidden");
  sourcesSectionEl.classList.remove("is-hidden");
}

// Configure the status 
function showConfigStatus() {
  const provider = getSelectedProvider();

  configStatusEl.textContent =
    `${provider.label}: ${provider.chatUrl} - Model: ${modelEl.value} - Chunks: ${CHUNKS_URL}`;
}

// Return the text into tokens == words
function tokenize(text) {
  return text.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

function releasePhraseTokens(text) {
  const tokens = [];
  const matches = String(text).matchAll(/release[-_\s]*(\d+)/gi);

  for (const match of matches) {
    tokens.push(`release${match[1]}`);
  }

  return tokens;
}

function searchTokens(text) {
  return [
    ...new Set([
      ...tokenize(text).filter((term) => !SEARCH_STOP_WORDS.has(term)),
      ...releasePhraseTokens(text)
    ])
  ];
}

function countTerms(terms) {
  const counts = new Map();

  for (const term of terms) {
    counts.set(term, (counts.get(term) || 0) + 1);
  }

  return counts;
}

function releaseTokens(release) {
  if (!release) return [];

  const compactRelease = String(release).toLowerCase().replace(/[^a-z0-9]/g, "");

  return [...new Set([...tokenize(String(release)), `release${compactRelease}`])];
}

function metadataBoost(queryTerms, counts, weight) {
  let boost = 0;

  for (const term of queryTerms) {
    if (counts.has(term)) {
      boost += weight;
    }
  }

  return boost;
}

function documentKey(item) {
  return `${item.release || "unknown"}::${item.source || item.title || "untitled"}`;
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function loadProviderOptions() {
  providerEl.innerHTML = "";

  for (const key of PROVIDER_KEYS) {
    const provider = PROVIDERS[key];
    const option = document.createElement("option");
    option.value = key;
    option.textContent = provider.label || key;

    if (key === DEFAULT_PROVIDER) {
      option.selected = true;
    }

    providerEl.appendChild(option);
  }
}

// Load the LLM model options from the config.js
function loadModelOptions() {
  const provider = getSelectedProvider();
  const models = provider.models || [];
  const defaultModel = provider.defaultModel || models[0] || "";

  modelEl.innerHTML = "";

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;

    if (model === defaultModel) {
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
  chunksByDocument = new Map();

  index = chunks.map((chunk, chunkIndex) => {
    const titleTerms = tokenize(`${chunk.title} ${chunk.source}`);
    const releaseTerms = releaseTokens(chunk.release);
    const textTerms = tokenize(chunk.text);
    const terms = [...titleTerms, ...releaseTerms, ...textTerms];
    const key = documentKey(chunk);

    const indexedChunk = {
      chunk,
      key,
      chunkIndex,
      counts: countTerms(terms),
      titleCounts: countTerms(titleTerms),
      releaseCounts: countTerms(releaseTerms),
      length: terms.length || 1 // Number of tokens
    };

    if (!chunksByDocument.has(key)) {
      chunksByDocument.set(key, []);
    }

    chunksByDocument.get(key).push(indexedChunk);

    return indexedChunk;
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

function scoreChunk(doc, terms) {
  const k1 = 1.5; 
  const b = 0.75;
  const titleWeight = 5.0;
  const releaseWeight = 14.0;
  let score = 0;

  for (const term of terms) {
    const freq = doc.counts.get(term) || 0;
    if (!freq) continue;

    const termIdf = idf.get(term) || 0;
    const denom = freq + k1 * (1 - b + b * (doc.length / avgDocLength));
    score += termIdf * ((freq * (k1 + 1)) / denom);
  }

  score += metadataBoost(terms, doc.titleCounts, titleWeight);
  score += metadataBoost(terms, doc.releaseCounts, releaseWeight);

  return {
    ...doc.chunk,
    score,
    key: doc.key,
    chunkIndex: doc.chunkIndex
  };
}

function scoreChunks(query, limit = CANDIDATE_K) {
  const terms = searchTokens(query);

  if (!terms.length) {
    return [];
  }

  return index
    .map((doc) => scoreChunk(doc, terms))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function rankDocuments(candidates) {
  const documents = new Map();

  for (const item of candidates) {
    const key = item.key || documentKey(item);

    if (!documents.has(key)) {
      documents.set(key, {
        key,
        chunks: [],
        bestScore: 0,
        score: 0,
        title: item.title,
        source: item.source,
        release: item.release
      });
    }

    const doc = documents.get(key);
    doc.chunks.push(item);
    doc.bestScore = Math.max(doc.bestScore, item.score);
  }

  for (const doc of documents.values()) {
    const topScores = doc.chunks
      .map((item) => item.score)
      .sort((a, b) => b - a)
      .slice(0, 3);

    doc.score = (doc.bestScore * 0.6) + (topScores.reduce((sum, score) => sum + score, 0) * 0.4);
  }

  return [...documents.values()].sort((a, b) => b.score - a.score);
}

function addContextChunk(pool, seen, item, score) {
  if (!item?.id || seen.has(item.id)) {
    return;
  }

  seen.add(item.id);
  pool.push({
    ...item,
    score
  });
}

function addExpandedChunks(pool, seen, item, directScore) {
  addContextChunk(pool, seen, item, directScore);

  const documentChunks = chunksByDocument.get(item.key || documentKey(item)) || [];
  const position = documentChunks.findIndex((doc) => doc.chunk.id === item.id);

  if (position === -1) {
    return;
  }

  for (let offset = 1; offset <= NEIGHBOR_CHUNKS; offset += 1) {
    for (const neighborPosition of [position - offset, position + offset]) {
      const neighbor = documentChunks[neighborPosition];

      if (neighbor) {
        addContextChunk(pool, seen, {
          ...neighbor.chunk,
          key: neighbor.key,
          chunkIndex: neighbor.chunkIndex
        }, directScore * 0.75);
      }
    }
  }
}

function packContextChunks(pool) {
  const packed = [];
  const seen = new Set();
  let words = 0;

  for (const item of pool.sort((a, b) => b.score - a.score)) {
    if (seen.has(item.id)) {
      continue;
    }

    const itemWords = wordCount(item.text);

    if (packed.length && words + itemWords > MAX_CONTEXT_WORDS) {
      continue;
    }

    packed.push(item);
    seen.add(item.id);
    words += itemWords;
  }

  return packed.sort((a, b) => b.score - a.score);
}

function retrieveContext(query) {
  const candidates = scoreChunks(query, CANDIDATE_K);
  const allRankedDocuments = rankDocuments(candidates);
  const firstDoc = allRankedDocuments[0];
  const secondDoc = allRankedDocuments[1];
  const isClearHit = firstDoc && (!secondDoc || firstDoc.score >= secondDoc.score * 1.8);
  const rankedDocuments = allRankedDocuments.slice(0, isClearHit ? 1 : MAX_CONTEXT_DOCS);
  const chunksPerDocument = isClearHit ? CHUNKS_PER_DOCUMENT + 3 : CHUNKS_PER_DOCUMENT;
  const pool = [];
  const seen = new Set();

  for (const doc of rankedDocuments) {
    const directChunks = doc.chunks
      .sort((a, b) => b.score - a.score)
      .slice(0, chunksPerDocument);

    for (const item of directChunks) {
      addExpandedChunks(pool, seen, item, item.score);
    }
  }

  return packContextChunks(pool);
}

// Main search function
function search(query) {
  return retrieveContext(query);
}

function releaseLabel(item) {
  return item.release ? `Release ${item.release}` : "";
}

function sourceDisplayTitle(item) {
  const release = releaseLabel(item);
  const title = item.title || item.source || "Untitled source";

  return release ? `${title} (${release})` : title;
}

function getRankedSources(results) {
  const sourcesByTitle = new Map();

  for (const item of results) {
    const title = item.title || item.source || "Untitled source";
    const release = releaseLabel(item);
    const key = `${release || "unknown"}::${title}`;
    const current = sourcesByTitle.get(key);

    if (!current || item.score > current.score) {
      sourcesByTitle.set(key, {
        title,
        release,
        displayTitle: sourceDisplayTitle(item),
        score: item.score
      });
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
    div.textContent = `${i + 1}. ${item.displayTitle}`;
    sourcesEl.appendChild(div);
  }
}

function buildCorpusSummary(results) {
  const releases = new Set();
  const sources = new Set();

  for (const item of results) {
    if (item.release) {
      releases.add(releaseLabel(item));
    }

    if (item.title || item.source) {
      sources.add(sourceDisplayTitle(item));
    }
  }

  return [
    "Corpus: released UAP files and related historical/government documents.",
    "The word \"release\" refers to a foldered document release in this app, such as Release 1 or Release 2.",
    releases.size ? `Retrieved releases: ${[...releases].join(", ")}.` : "",
    sources.size ? `Retrieved source documents: ${[...sources].join("; ")}.` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

// Build the prompt that's going to be fed into Local Ollama
function buildPrompt(question, results) {
  const corpusSummary = buildCorpusSummary(results);
  const context = results
    .map((item, i) => {
      const release = releaseLabel(item);
      const releaseText = release ? `, ${release}` : "";

      return `[${i + 1}] ${item.title} (${item.source}${releaseText}, page ${item.page})\n${item.text}`;
    })
    .join("\n\n");

  return `
You answer questions about UAP files.
Do not invent new information.
Use only the context below.
When the user mentions a release, such as "Release 2" or "Release-2", interpret that as a UAP document release from this app.
If the user asks what a release or document is about, summarize the retrieved source documents and say when the retrieved context is only partial.
Format the answer with short paragraphs and bullet points when useful. 
Use Markdown bold for key labels.
If the context is not enough, say that clearly.
Answer with bullet points.
Cite sources with [1], [2], etc.

Corpus summary:
${corpusSummary}

Context:
${context}

Question:
${question}
`;
}

function cleanAnswer(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// Ask the selected LLM agent
async function askLLM(question, results) {
  const provider = getSelectedProvider();

  const res = await fetch(provider.chatUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelEl.value,
      stream: false,
      messages: [
        {
          role: "system",
          content: "You are a careful, concise research assistant for a UAP files RAG app. Interpret releases and document titles as belonging to the app's UAP document corpus, and answer only from retrieved context."
        },
        {
          role: "user",
          content: buildPrompt(question, results)
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error("LLM request failed");
  }

  const data = await res.json();

  return cleanAnswer(
    data.message?.content ||
    data.choices?.[0]?.message?.content ||
    "No answer returned."
  );
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
  showResultSections();
  answerEl.textContent = "Searching...";
  answerEl.classList.add("muted");

  const results = search(question);
  renderSources(results);

  if (!results.length) {
    answerEl.textContent = "No matching chunks found.";
    askBtn.disabled = false;
    return;
  }

  answerEl.textContent = `Asking ${getSelectedProvider().label}...`;

  try {
    const answer = await askLLM(question, results);
    renderAnswer(answer);
    answerEl.classList.remove("muted");
  } catch {
    answerEl.textContent =
      `${getSelectedProvider().label} is not reachable. Check the selected provider and try again.`;
    answerEl.classList.add("muted");
  }

  askBtn.disabled = false;
}

askBtn.addEventListener("click", handleAsk);

infoToggleEl.addEventListener("click", () => {
  const isVisible = document.body.classList.toggle("info-visible");
  infoToggleEl.setAttribute("aria-expanded", String(isVisible));
});

providerEl.addEventListener("change", () => {
  loadModelOptions();
  showConfigStatus();
});

modelEl.addEventListener("change", showConfigStatus);

questionEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleAsk();
  }
});

loadProviderOptions();
loadModelOptions();
showConfigStatus();
loadChunks();
