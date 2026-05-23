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
SOURCE_DIR = ROOT / "data" / "Files-Release-1"
OUT_DIR = ROOT / "data" / "processed"
OUT_FILE = OUT_DIR / "pages.jsonl"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
OCR_DPI = 220
MIN_GOOD_TEXT_CHARS = 250


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


def extract_pdf(path, handle, can_ocr):
    with fitz.open(path) as doc:
        for page_index in range(doc.page_count):
            page_number = page_index + 1
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
                "id": f"{path.stem}-p{page_number:04d}",
                "title": path.stem,
                "source": path.name,
                "page": page_number,
                "text": final_text,
                "method": method,
                "type": "pdf_page"
            })


def extract_image(path, handle, can_ocr):
    if not can_ocr:
        return

    try:
        with Image.open(path) as image:
            text = ocr_image(image)

        if not text:
            return

        write_record(handle, {
            "id": f"{path.stem}-image",
            "title": path.stem,
            "source": path.name,
            "page": None,
            "text": text,
            "method": "ocr",
            "type": "image"
        })
    except Exception as exc:
        print(f"Image OCR failed: {path.name}: {exc}")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not SOURCE_DIR.exists():
        raise SystemExit(f"Missing source folder: {SOURCE_DIR}")

    can_ocr = setup_tesseract()
    print(f"Source: {SOURCE_DIR}")
    print(f"Output: {OUT_FILE}")
    print(f"OCR enabled: {can_ocr}")

    files = sorted(path for path in SOURCE_DIR.iterdir() if path.is_file())

    with OUT_FILE.open("w", encoding="utf-8") as handle:
        for path in files:
            suffix = path.suffix.lower()
            print(f"Processing {path.name}")

            if suffix == ".pdf":
                extract_pdf(path, handle, can_ocr)
            elif suffix in IMAGE_EXTENSIONS:
                extract_image(path, handle, can_ocr)

    print("Done.")


if __name__ == "__main__":
    main()