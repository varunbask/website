// JPEG bytes for tests: two real encoder outputs (baseline, no EXIF) and a
// builder for synthetic JPEGs with exact dimensions and an arbitrary payload.

const fromBase64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

// 12 x 16 pixels, 3 components (RGB), baseline
export const RGB_12X16 = fromBase64([
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdB',
  'RkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09P',
  'T09PT09PT09PT09PT0//wAARCAAQAAwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA',
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6',
  'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG',
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA',
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5',
  'OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE',
  'xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDm7LTuny1tRad8g+WtSy07p8tbUWnfux8t',
  'GIx2u5vlGY+5uf/Z',
].join(''));

// 16 x 8 pixels, 1 component (gray), baseline
export const GRAY_16X8 = fromBase64([
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdB',
  'RkxOUlNSMj5aYVpQYEpRUk//wAALCAAIABABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgED',
  'AwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RF',
  'RkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJ',
  'ytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AOS8P/w16f4f/hr/2Q==',
].join(''));

// SOI, a JFIF header, a frame header (SOF0 unless `marker` says otherwise), a scan
// header, `payload` as the entropy-coded data (0xff bytes are followed by 0x00 as
// a real encoder would), EOI. The scan is not decodable; the bytes only need to
// look like a JPEG to code that reads markers.
export function fakeJpeg({ width, height, components = 3, precision = 8, marker = 0xc0, payload = new Uint8Array(0) }) {
  const out = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const frame = [precision, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 0; c < components; c += 1) frame.push(c + 1, 0x11, 0);
  out.push(0xff, marker, 0x00, frame.length + 2, ...frame);
  const scan = [components];
  for (let c = 0; c < components; c += 1) scan.push(c + 1, 0x00);
  scan.push(0, 63, 0);
  out.push(0xff, 0xda, 0x00, scan.length + 2, ...scan);
  for (const byte of payload) out.push(byte, ...(byte === 0xff ? [0x00] : []));
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}
