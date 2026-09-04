import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { attachRoomHandlers } from "../room-server.mjs";

const server = createServer((_request, response) => response.end("Splendor Pokémon WebSocket"));
attachRoomHandlers(new WebSocketServer({ server }));

export default server;
