// server.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import MessageModel from './models/Message.js';

const app = express();

// ---------- CORS (tight, with proper preflight) ----------
const ALLOWED_ORIGINS = [
  'http://localhost:5173',        // Vite dev
  process.env.FRONTEND_ORIGIN || '' // e.g. https://your-frontend.onrender.com
].filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// ---------- Mongo ----------
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp';
const PORT = process.env.PORT || 5001;

mongoose.connect(MONGODB_URI, { dbName: 'whatsapp' })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ---------- HTTP + Socket.IO ----------
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS (socket)'));
    },
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('🔌 socket connected', socket.id);
});

app.set('io', io);

// ---------- Routes ----------
app.get('/', (_req, res) => res.send('API is running'));

// ✅ Health probe (added)
app.get('/health', (_req, res) => {
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  res.json({ ok: true, state: mongoose.connection.readyState });
});

// Save message
app.post('/messages', async (req, res) => {
  try {
    const {
      wa_id,
      text,
      timestamp,
      status,
      msg_id,
      meta_msg_id,
      profileName,
      fromSelf,
      clientId // pass-through for echo suppression on client
    } = req.body || {};

    if (!wa_id || !text) {
      return res.status(400).json({ error: 'wa_id and text are required' });
    }

    const doc = await MessageModel.create({
      wa_id,
      msg_id: msg_id || randomUUID(),
      meta_msg_id: meta_msg_id || undefined,
      text,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      status: status || 'sent',
      profileName: profileName || 'Unknown',
      fromSelf: !!fromSelf
    });

    // broadcast (include clientId so sender can ignore its own echo)
    io.emit('message:new', { ...doc.toObject(), clientId: clientId || null });

    return res.status(201).json(doc);
  } catch (e) {
    console.error('POST /messages failed:', e?.code, e?.message);
    return res.status(500).json({
      error: 'Could not save message',
      code: e?.code || null,
      message: e?.message || null,
    });
  }
});

// Load messages for a chat
app.get('/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const list = await MessageModel.find({ wa_id: chatId }).sort({ timestamp: 1 });
    return res.json(list);
  } catch (e) {
    console.error('GET /messages/:chatId failed:', e?.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Demo status endpoints
app.post('/delivered', async (req, res) => {
  try {
    const { msg_id, wa_id } = req.body || {};
    if (!msg_id) return res.status(400).json({ error: 'msg_id required' });

    const updated = await MessageModel.findOneAndUpdate(
      { msg_id, ...(wa_id ? { wa_id } : {}) },
      { $set: { status: 'delivered' } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'Message not found' });

    io.emit('message:status', { wa_id: updated.wa_id, msg_id: updated.msg_id, status: 'delivered' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /delivered failed:', e?.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/read', async (req, res) => {
  try {
    const { msg_id, wa_id } = req.body || {};
    if (!msg_id) return res.status(400).json({ error: 'msg_id required' });

    const updated = await MessageModel.findOneAndUpdate(
      { msg_id, ...(wa_id ? { wa_id } : {}) },
      { $set: { status: 'read' } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'Message not found' });

    io.emit('message:status', { wa_id: updated.wa_id, msg_id: updated.msg_id, status: 'read' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /read failed:', e?.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Conversations list (used by App)
app.get('/conversations', async (_req, res) => {
  try {
    const chats = await MessageModel.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$wa_id',
          lastMsg: { $first: '$text' },
          lastTimestamp: { $first: '$timestamp' },
          status: { $first: '$status' }
        }
      },
      {
        $project: {
          wa_id: '$_id',
          lastMsg: 1,
          lastTimestamp: 1,
          status: 1,
          _id: 0
        }
      },
      { $sort: { lastTimestamp: -1 } }
    ]);
    res.json(chats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
