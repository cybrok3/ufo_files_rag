import argparse
import json
import re
import shutil
from pathlib import Path

import fitz
from PIL import Image, ImageOps

try:
    import pytesseract
except ImportError:
    pytesseract = None


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "data" / "processed"
OUT_FILE = OUT_DIR / "pages.jsonl"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
OCR_DPI = 220
MIN_GOOD_TEXT_CHARS = 250


def release_value(path):
    match = re.search(r"release[-_\s]*(\d+)", path.name, re.IGNORECASE)
    return match.group(1) if match else path.name


def release_slug(release):
    return re.sub(r"[^a-z0-9]+", "-", str(release).lower()).strip("-")


def find_release_dirs():
    dirs = []

    for path in DATA_DIR.iterdir():
        if not path.is_dir():
            continue
        if path.name == "processed":
            continue
        if re.search(r"release", path.name, re.IGNORECASE):
            dirs.append(path)

    return sorted(dirs, key=lambda path: path.name.lower())


def load_existing_ids():
    ids = set()

    if not OUT_FILE.exists():
        return ids

    with OUT_FILE.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("id"):
                ids.add(record["id"])

    return ids


def setup_tesseract():
    if pytesseract is None:
        return False

    found = shutil.which("tesseract")
    if found:
        return True

    common_path = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
    if common_path.exists():
        pytesseract.pytesseract.tesseract_cmd = str(common_path)
        return True

    return False


def clean_text(text):
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def text_quality(text):
    text = clean_text(text)
    if not text:
        return 0

    letters = sum(ch.isalpha() for ch in text)
    ratio = letters / max(len(text), 1)

    if len(text) < MIN_GOOD_TEXT_CHARS:
        return 1

    if ratio < 0.35:
        return 1

    return 2


def preprocess_for_ocr(image):
    image = image.convert("L")
    image = ImageOps.autocontrast(image)
    return image


def ocr_image(image):
    image = preprocess_for_ocr(image)
    return clean_text(
        pytesseract.image_to_string(
            image,
            lang="eng",
            config="--oem 1 --psm 3"
        )
    )


def page_to_image(page):
    zoom = OCR_DPI / 72
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def write_record(handle, record):
    handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def extract_pdf(path, handle, can_ocr, release, release_folder, existing_ids):
    with fitz.open(path) as doc:
        for page_index in range(doc.page_count):
            page_number = page_index + 1
            page_id = f"{release_slug(release)}-{path.stem}-p{page_number:04d}"
            legacy_page_id = f"{path.stem}-p{page_number:04d}"

            if page_id in existing_ids or legacy_page_id in existing_ids:
                continue

            page = doc.load_page(page_index)

            embedded_text = clean_text(page.get_text("text"))
            final_text = embedded_text
            method = "embedded"

            if can_ocr and text_quality(embedded_text) < 2:
                try:
                    image = page_to_image(page)
                    ocr_text = ocr_image(image)

                    if len(ocr_text) > len(embedded_text):
                        final_text = ocr_text
                        method = "ocr"
                    elif embedded_text and ocr_text:
                        final_text = embedded_text
                        method = "embedded"
                    elif ocr_text:
                        final_text = ocr_text
                        method = "ocr"
                except Exception as exc:
                    print(f"OCR failed: {path.name} page {page_number}: {exc}")

            if not final_text:
                continue

            write_record(handle, {
                "id": page_id,
                "title": path.stem,
                "source": path.name,
                "release": release,
                "releaseFolder": release_folder,
                "page": page_number,
                "text": final_text,
                "method": method,
                "type": "pdf_page"
            })
            existing_ids.add(page_id)


def extract_image(path, handle, can_ocr, release, release_folder, existing_ids):
    if not can_ocr:
        return

    image_id = f"{release_slug(release)}-{path.stem}-image"

    legacy_image_id = f"{path.stem}-image"

    if image_id in existing_ids or legacy_image_id in existing_ids:
        return

    try:
        with Image.open(path) as image:
            text = ocr_image(image)

        if not text:
            return

        write_record(handle, {
            "id": image_id,
            "title": path.stem,
            "source": path.name,
            "release": release,
            "releaseFolder": release_folder,
            "page": None,
            "text": text,
            "method": "ocr",
            "type": "image"
        })
        existing_ids.add(image_id)
    except Exception as exc:
        print(f"Image OCR failed: {path.name}: {exc}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append only pages whose ids are not already in pages.jsonl."
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    release_dirs = find_release_dirs()

    if not release_dirs:
        raise SystemExit(f"No release folders found in: {DATA_DIR}")

    can_ocr = setup_tesseract()
    mode = "a" if args.append else "w"
    existing_ids = load_existing_ids() if args.append else set()

    print("Sources:")
    for release_dir in release_dirs:
        print(f"- {release_dir} (Release {release_value(release_dir)})")
    print(f"Output: {OUT_FILE}")
    print(f"OCR enabled: {can_ocr}")
    print(f"Append mode: {args.append}")

    with OUT_FILE.open(mode, encoding="utf-8") as handle:
        for release_dir in release_dirs:
            release = release_value(release_dir)
            release_folder = release_dir.name
            files = sorted(path for path in release_dir.iterdir() if path.is_file())

            for path in files:
                suffix = path.suffix.lower()
                print(f"Processing Release {release}: {path.name}")

                if suffix == ".pdf":
                    extract_pdf(path, handle, can_ocr, release, release_folder, existing_ids)
                elif suffix in IMAGE_EXTENSIONS:
                    extract_image(path, handle, can_ocr, release, release_folder, existing_ids)

    print("Done.")


if __name__ == "__main__":
    main()
