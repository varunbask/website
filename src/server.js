import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import knex from 'knex';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { startScheduler } from './worker/scheduler.js';
import { authMiddleware } from './middleware/auth.js';
import { readFile, unlink } from 'fs/promises';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
import knexfile from './db/knexfile.cjs';
const db = knex(knexfile);

// Middleware
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
  }
});

const isTutor = (user) => user.app_metadata?.role === 'tutor';

// A photo is sent to the grading model as an image, base64-encoded. The API
// allows 10 MB per encoded image, which is about 7 MB on disk.
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

// Text for the grader. Photos return null: they are not converted to text,
// the grader sends the image itself so the model reads the handwriting.
async function extractText(file) {
  if (file.mimetype === 'application/pdf') {
    const parser = new PDFParse({ data: await readFile(file.path) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  if (file.mimetype === 'text/plain') {
    return readFile(file.path, 'utf-8');
  }
  // Remaining allowed types are PNG/JPG photos
  return null;
}

// Initialize Scheduler
let scheduler;
startScheduler({ cronExpression: '*/5 * * * *', threshold: 5 }).then(s => {
  scheduler = s;
  console.log('Scheduler initialized');
}).catch(err => {
  console.error('Failed to initialize scheduler:', err);
});

// POST /api/submit
app.post('/api/submit', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const student_id = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Missing file' });
    }

    if (file.mimetype.startsWith('image/') && file.size > MAX_IMAGE_BYTES) {
      await unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'Photos must be under 7 MB. Please upload a smaller photo or a PDF.' });
    }

    const content_text = await extractText(file);

    await db('submissions').insert({
      student_id,
      file_path: file.path,
      file_type: file.mimetype,
      content_text,
      status: 'pending',
      created_at: new Date()
    });

    // Trigger threshold check if scheduler is ready
    if (scheduler && scheduler.checkThreshold) {
      scheduler.checkThreshold().catch(err => console.error('Threshold check error:', err));
    }

    res.status(201).json({ message: 'Submission successful', id: file.filename });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/submissions
app.get('/api/submissions', authMiddleware, async (req, res) => {
  try {
    const query = db('submissions');
    
    if (!isTutor(req.user)) {
      query.where('student_id', req.user.id);
    }

    const submissions = await query.orderBy('created_at', 'desc');
    res.json(submissions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /uploads/:name (owner or tutor only)
app.get('/uploads/:name', authMiddleware, async (req, res) => {
  try {
    const filePath = path.join(uploadDir, path.basename(req.params.name));
    const submission = await db('submissions').where('file_path', filePath).first();

    if (!submission || (!isTutor(req.user) && submission.student_id !== req.user.id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(filePath);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Upload errors (size limit, disallowed type)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 20 MB)' : 'Only PDF, PNG, JPG, or TXT files are allowed' });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
