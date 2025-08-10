// import.js
require("dotenv").config();
console.log("👉 Import script using MONGODB_URI:", process.env.MONGODB_URI);

const mongoose = require("mongoose");
const fs       = require("fs");
const path     = require("path");
const Message  = require("./models/Message");

async function importPayloads() {
  // 1) Connect
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("🔗 Connected to MongoDB for import");

  const dir   = path.join(__dirname, "payloads");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));

  for (const file of files) {
    const data    = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    const entries = data.metaData?.entry || [];

    const messages = [];
    const statuses = [];

    // 2) Extract messages & statuses from each change
    for (const entry of entries) {
      for (const change of entry.changes) {
        if (change.field === "messages") {
          // attach wa_id from contacts[0]
          const wa_id = change.value.contacts?.[0]?.wa_id;
          for (const m of change.value.messages || []) {
            messages.push({ ...m, wa_id });
          }
        }
        if (change.field === "statuses") {
          for (const s of change.value.statuses || []) {
            statuses.push(s);
          }
        }
      }
    }

    // 3) Upsert each message
    for (const msg of messages) {
      const doc = {
        wa_id:       msg.wa_id,
        msg_id:      msg.id,
        text:        msg.text?.body || "",
        timestamp:   new Date(Number(msg.timestamp) * 1000),
        status:      "sent",
        meta_msg_id: msg.id
      };
      await Message.updateOne(
        { msg_id: doc.msg_id },
        { $set: doc },
        { upsert: true }
      );
    }

    // 4) Update each status
    for (const st of statuses) {
      const metaId = st.id || st.messageId || st.meta_msg_id;
      if (!metaId) continue;
      await Message.updateOne(
        { msg_id: metaId },
        { $set: { status: st.status } }
      );
    }

    console.log(`✅ Processed ${file}`);
  }

  console.log("🎉 Import complete.");
  await mongoose.disconnect();
}

importPayloads().catch(err => {
  console.error("❌ Import error:", err);
  mongoose.disconnect();
});
