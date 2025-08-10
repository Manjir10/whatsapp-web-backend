// whatsapp-web-backend/scripts/processPayloads.mjs
// Run with: node scripts/processPayloads.mjs
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import MessageModel from '../models/Message.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp';
const DB_NAME = 'whatsapp'; // same as you’ve been using
const PAYLOAD_DIR = path.resolve(process.cwd(), 'payloads');

function asDate(ts) {
  if (!ts) return new Date();
  // many webhook timestamps are seconds; accept both
  const n = Number(ts);
  if (!Number.isNaN(n)) {
    return new Date(n > 1e12 ? n : n * 1000);
  }
  return new Date(ts);
}

async function upsertMessage({
  wa_id,
  msg_id,
  meta_msg_id,
  text,
  timestamp,
  status = 'sent',
  profileName = 'Unknown',
  fromSelf = false
}) {
  if (!wa_id || !msg_id) return;

  await MessageModel.updateOne(
    { msg_id },
    {
      $setOnInsert: {
        wa_id,
        msg_id,
        meta_msg_id,
        text: text ?? '',
        timestamp: asDate(timestamp),
        profileName,
        fromSelf
      },
      $set: {
        status
      }
    },
    { upsert: true }
  );
}

async function applyStatus({ id, metaMsgId, status }) {
  if (!id && !metaMsgId) return;

  // try by msg_id, else by meta_msg_id
  const byMsgId = await MessageModel.findOneAndUpdate(
    { msg_id: id },
    { $set: { status } },
    { new: true }
  );
  if (!byMsgId && metaMsgId) {
    await MessageModel.findOneAndUpdate(
      { meta_msg_id: metaMsgId },
      { $set: { status } },
      { new: true }
    );
  }
}

function extractContacts(payload) {
  // best-effort: WhatsApp Business webhook often includes contacts
  const contact = payload?.contacts?.[0];
  const wa_id =
    contact?.wa_id || contact?.waId || payload?.wa_id || payload?.from?.id || null;
  const profileName =
    contact?.profile?.name ||
    payload?.profile?.name ||
    payload?.value?.contacts?.[0]?.profile?.name ||
    'Unknown';
  return { wa_id, profileName };
}

function asArray(maybeArray) {
  if (!maybeArray) return [];
  return Array.isArray(maybeArray) ? maybeArray : [maybeArray];
}

async function processFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const payload = JSON.parse(raw);

  // Try to normalize common WhatsApp webhook shapes
  // 1) Plain messages/statuses at root
  // 2) In entry[0].changes[0].value.messages / .statuses
  const entry = asArray(payload.entry || payload.entries)[0];
  const change = entry?.changes ? asArray(entry.changes)[0] : null;
  const value = change?.value || payload.value || payload;

  const messages =
    value?.messages || payload?.messages || [];
  const statuses =
    value?.statuses || value?.message_status || payload?.statuses || [];

  const { wa_id: fallbackWaId, profileName: fallbackProfile } = extractContacts(value);

  // Insert / upsert messages
  for (const m of asArray(messages)) {
    const msg_id = m.id || m.msg_id;
    const wa_id =
      m?.from || m?.from?.id || fallbackWaId || m?.wa_id;
    const meta_msg_id = m?.context?.id || m?.meta_msg_id;
    const text = m?.text?.body ?? m?.text ?? m?.message ?? '';
    const ts = m?.timestamp || value?.timestamp || payload?.timestamp;

    await upsertMessage({
      wa_id,
      msg_id,
      meta_msg_id,
      text,
      timestamp: ts,
      status: 'sent',
      profileName: fallbackProfile,
      fromSelf: false
    });
  }

  // Apply statuses
  for (const s of asArray(statuses)) {
    const status = s.status || s?.conversation?.status || s?.message_status;
    const id = s?.id || s?.message_id || s?.msg_id || s?.meta_msg_id;
    const metaMsgId = s?.meta_msg_id || s?.id;
    await applyStatus({ id, metaMsgId, status });
  }
}

async function main() {
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log('✅ Connected to MongoDB');

  try {
    const files = await fs.readdir(PAYLOAD_DIR);
    const jsonFiles = files.filter(f => f.toLowerCase().endsWith('.json'));
    if (jsonFiles.length === 0) {
      console.log('ℹ️ No JSON files found in payloads/');
      return;
    }

    for (const f of jsonFiles) {
      const fp = path.join(PAYLOAD_DIR, f);
      console.log(`📦 Processing ${f} ...`);
      try {
        await processFile(fp);
        console.log(`✅ Done: ${f}`);
      } catch (e) {
        console.error(`❌ Failed: ${f}`, e.message);
      }
    }
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
