import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGES_FILE = ROOT / "data" / "processed" / "pages.jsonl"
CHUNKS_FILE = ROOT / "data" / "chunks.json"

TARGET_WORDS = 850
OVERLAP_WORDS = 120
MIN_CHUNK_WORDS = 80


def clean_text(text):
    text = text.replace("\x00", " ")
    text = re.sub(r"-\s*\n\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def words(text):
    return text.split()


def chunk_words(word_list):
    chunks = []
    start = 0

    while start < len(word_list):
        end = min(start + TARGET_WORDS, len(word_list))
        chunk = word_list[start:end]

        if len(chunk) >= MIN_CHUNK_WORDS:
            chunks.append(" ".join(chunk))

        if end == len(word_list):
            break

        start = max(end - OVERLAP_WORDS, start + 1)

    return chunks


def load_pages():
    pages = []

    with PAGES_FILE.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                pages.append(json.loads(line))

    return pages


def main():
    if not PAGES_FILE.exists():
        raise SystemExit(f"Missing file: {PAGES_FILE}")

    pages = load_pages()
    chunks = []

    for page in pages:
        text = clean_text(page.get("text", ""))
        page_words = words(text)

        if len(page_words) < MIN_CHUNK_WORDS:
            continue

        page_chunks = chunk_words(page_words)

        for index, chunk_text in enumerate(page_chunks, start=1):
            chunks.append({
                "id": f"{page['id']}-c{index:03d}",
                "title": page["title"],
                "source": page["source"],
                "page": page["page"],
                "text": chunk_text,
                "method": page["method"]
            })

    CHUNKS_FILE.write_text(
        json.dumps(chunks, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"Pages read: {len(pages)}")
    print(f"Chunks written: {len(chunks)}")
    print(f"Output: {CHUNKS_FILE}")


if __name__ == "__main__":
    main()