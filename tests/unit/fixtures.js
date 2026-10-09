// A 1x1 PNG, enough to stand in for a photo of handwritten work
export const TINY_PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

// Wraps a body the way an OpenAI-style chat completion does
export function completion(body) {
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
}

// A valid one-page PDF. With text it has a text layer; with '' it has none, like a scanned page.
export function makePdf(text) {
  const stream = text ? `BT /F1 18 Tf 72 720 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET` : 'q Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

// A one-page scan the way iPhone's "Scan Documents" saves it (PDF 1.3, no text):
// the photo is a JPEG whose dictionary lists /Length first and an ICC color
// space, unlike the portal's own photo PDFs (portal/js/pdf-pack.js)
export function makeIosScanPdf(jpeg, { width = 12, height = 16, extra = '' } = {}) {
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
  const icc = 'not a real profile';
  const parts = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    null,   // the image, written as bytes below
    `<< /Length ${icc.length} /N 3 /Alternate /DeviceRGB >>\nstream\n${icc}\nendstream`,
  ];
  const chunks = [Buffer.from(`%PDF-1.3\n${extra}`, 'latin1')];
  const size = () => chunks.reduce((n, c) => n + c.length, 0);
  const offsets = [];
  parts.forEach((body, i) => {
    offsets.push(size());
    if (body) {
      chunks.push(Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1'));
    } else {
      chunks.push(Buffer.from(`${i + 1} 0 obj\n<<\n/Length ${jpeg.length}\n/Type /XObject\n/Subtype /Image\n/Width ${width}\n/Height ${height}\n/Interpolate true\n/ColorSpace [/ICCBased 6 0 R]\n/Intent /Perceptual\n/BitsPerComponent 8\n/Filter /DCTDecode\n>>\nstream\n`, 'latin1'));
      chunks.push(Buffer.from(jpeg));
      chunks.push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    }
  });
  const xref = size();
  let tail = `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  chunks.push(Buffer.from(tail, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}
