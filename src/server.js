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
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
const upload = multer({ storage: storage });

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
    const { student_id } = req.body;
    const file = req.file;

    if (!file || !student_id) {
      return res.status(400).json({ error: 'Missing file or student_id' });
    }

        const content_text = await fs.readFile(file.path, 'utf-8').catch(() => '');
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
app.get('/api/submissions', async (req, res) => {
  try {
    const submissions = await db('submissions').orderBy('created_at', 'desc');
    res.json(submissions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});