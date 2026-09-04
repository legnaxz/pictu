import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { attachRoomHandlers } from "./room-server.mjs";

const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  const requested = request.url === "/" ? "index.html" : request.url.split("?")[0];
  const file = normalize(join(root, decodeURIComponent(requested)));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(response);
});

attachRoomHandlers(new WebSocketServer({ server }));
server.listen(process.env.PORT || 4174, "0.0.0.0", () => console.log("Splendor Pokémon: http://localhost:4174"));
