# WhatsApp Web – Backend (Node.js + MongoDB + Socket.IO)

## Overview
A minimal backend that stores messages in MongoDB, serves chat/message data via REST APIs, and broadcasts live updates with Socket.IO. Built for the “WhatsApp Web Clone” task.

## Features
- REST API:
  - `GET /conversations` – last message per wa_id
  - `GET /messages/:chatId` – full thread for a wa_id
  - `POST /messages` – store message
  - `POST /delivered`, `POST /read` – update message status
  - `GET /health` – health check
- Socket.IO events:
  - `message:new` – new message broadcast
  - `message:status` – status updates (sent/delivered/read)

## Tech Stack
Node.js, Express, MongoDB (Mongoose), Socket.IO, ES Modules.

## Live URL
Backend: [https://whatsapp-web-backend-2omx.onrender.com](https://whatsapp-web-backend-2omx.onrender.com)

## Local Setup
```bash
git clone <repo-url>
cd whatsapp-web-backend
cp .env.example .env
npm install
npm run dev   # or: node server.js

.env Example
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority
PORT=5001
FRONTEND_ORIGIN=http://localhost:5173
