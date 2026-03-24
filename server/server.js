import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import coachRoutes from './routes/coach.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (0.0.0.0)`);
});
server.timeout = 90000; // 90s default server timeout
