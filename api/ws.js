import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const rooms = new Map();
const code = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const send = (socket, message) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(message));
const broadcast = (room, message) => room.clients.forEach((client) => send(client, message));
const server = createServer((_request, response) => response.end("Gem Trade WebSocket"));
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === "create") {
      let roomCode = code(); while (rooms.has(roomCode)) roomCode = code();
      const room = { code: roomCode, capacity: message.playerCount, clients: new Set(), snapshot: null };
      rooms.set(roomCode, room); socket.room = room; socket.seat = 0; room.clients.add(socket);
      send(socket, { type: "welcome", code: roomCode, seat: 0, capacity: room.capacity, snapshot: null });
      return;
    }
    if (message.type === "join") {
      const room = rooms.get(String(message.code || "").toUpperCase());
      if (!room || room.clients.size >= room.capacity) { send(socket, { type: "error", message: "방을 찾을 수 없거나 이미 가득 찼습니다." }); return; }
      socket.room = room; socket.seat = room.clients.size; room.clients.add(socket);
      send(socket, { type: "welcome", code: room.code, seat: socket.seat, capacity: room.capacity, snapshot: room.snapshot });
      broadcast(room, { type: "presence", connected: room.clients.size, capacity: room.capacity });
      return;
    }
    if (message.type === "snapshot" && socket.room) { socket.room.snapshot = message.snapshot; broadcast(socket.room, { type: "snapshot", snapshot: message.snapshot }); }
  });
  socket.on("close", () => { if (!socket.room) return; socket.room.clients.delete(socket); if (!socket.room.clients.size) rooms.delete(socket.room.code); });
});

export default server;
