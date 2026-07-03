// Render plain text to a US letter-sized PDF buffer.
// Used when a caller sends `body_text` instead of a `file_url`.
//
// Intentionally simple: left-aligned text on letter paper with one-inch
// margins. No letterhead, no signature block, no fancy layout. Anyone who
// wants branding should pass file_url to a pre-rendered PDF.
//
// Click2Mail's "Address on Separate Page" layout means the recipient address
// is printed on a separate cover sheet, so the body PDF doesn't need to
// include it.

import PDFDocument from "pdfkit";

const MAX_TEXT_LEN = 20_000; // ~6-8 pages. Providers charge per page; cap protects against runaway costs.

export class TextToPdfError extends Error {
  constructor(message) {
    super(message);
    this.name = "TextToPdfError";
  }
}

/**
 * @param {string} text - Body of the letter. Plain text. Newlines are honored.
 * @param {object} [opts]
 * @param {string} [opts.from_name] - Optional sender name printed at top-right.
 * @returns {Promise<Buffer>} PDF buffer.
 */
export function textToPdf(text, opts = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return Promise.reject(new TextToPdfError("body_text must be a non-empty string"));
  }
  if (text.length > MAX_TEXT_LEN) {
    return Promise.reject(
      new TextToPdfError(
        `body_text length ${text.length} exceeds limit of ${MAX_TEXT_LEN} chars`,
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: { Title: "Letter", Producer: "mailsnail-gateway" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Date in the top-right.
    const today = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    doc.font("Helvetica").fontSize(10).text(today, { align: "right" });
    doc.moveDown(2);

    // Optional sender name in the top-right block.
    if (opts.from_name) {
      doc.fontSize(10).text(opts.from_name, { align: "right" });
      doc.moveDown(1);
    }

    // Body.
    doc.font("Helvetica").fontSize(11).text(text, {
      align: "left",
      lineGap: 4,
    });

    doc.end();
  });
}
