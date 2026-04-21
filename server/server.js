import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import coachRoutes from './routes/coach.js';

const app = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = [
  'https://newapp-ruddy.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];
// Support additional origins via env var (comma-separated)
if (process.env.CORS_ORIGINS) {
  ALLOWED_ORIGINS.push(...process.env.CORS_ORIGINS.split(',').map(s => s.trim()));
}

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return cb(null, true);
    // Allow any *.vercel.app subdomain for preview deployments
    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// Set 90s timeout for coach routes (AI generation can be slow)
app.use('/api/coach', (req, res, next) => {
  req.setTimeout(90000);
  res.setTimeout(90000);
  next();
}, coachRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.send('Server Alive');
});

// Global error handler — prevent Express from crashing on unhandled route errors
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Prevent server crashes on unhandled async errors
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err.message);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
server.timeout = 90000;
