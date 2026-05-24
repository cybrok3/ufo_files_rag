import argparse
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


def load_existing_chunks():
    if not CHUNKS_FILE.exists():
        return []

    return json.loads(CHUNKS_FILE.read_text(encoding="utf-8"))


def make_chunk(page, index, chunk_text):
    return {
        "id": f"{page['id']}-c{index:03d}",
        "title": page["title"],
        "source": page["source"],
        "release": page.get("release"),
        "releaseFolder": page.get("releaseFolder"),
        "page": page["page"],
        "text": chunk_text,
        "method": page["method"]
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append only chunks whose ids are not already in chunks.json."
    )
    args = parser.parse_args()

    if not PAGES_FILE.exists():
        raise SystemExit(f"Missing file: {PAGES_FILE}")

    pages = load_pages()
    chunks = load_existing_chunks() if args.append else []
    existing_ids = {chunk.get("id") for chunk in chunks}
    added_chunks = 0

    for page in pages:
        text = clean_text(page.get("text", ""))
        page_words = words(text)

        if len(page_words) < MIN_CHUNK_WORDS:
            continue

        page_chunks = chunk_words(page_words)

        for index, chunk_text in enumerate(page_chunks, start=1):
            chunk = make_chunk(page, index, chunk_text)

            if chunk["id"] in existing_ids:
                continue

            chunks.append(chunk)
            existing_ids.add(chunk["id"])
            added_chunks += 1

    CHUNKS_FILE.write_text(
        json.dumps(chunks, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"Pages read: {len(pages)}")
    print(f"Chunks written: {len(chunks)}")
    print(f"Chunks added: {added_chunks}")
    print(f"Output: {CHUNKS_FILE}")


if __name__ == "__main__":
    main()
