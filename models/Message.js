// models/Message.js
import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  wa_id: { type: String, required: true },

  // keep your unique id fields
  msg_id: { type: String, unique: true, required: true },
  meta_msg_id: { type: String },

  // message content
  text: { type: String, default: "" },

  // store as Date (same as you had before)
  timestamp: { type: Date, required: true },

  // delivery status (same enum as before)
  status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },

  // ✅ optional, with a safe default
  profileName: { type: String, default: "Unknown" },

  // ✅ NEW: who sent it; defaults to false
  fromSelf: { type: Boolean, default: false }
});

const MessageModel = mongoose.model('Message', MessageSchema);
export default MessageModel;
