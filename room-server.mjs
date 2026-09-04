// 방/자리 관리 + 재접속 복구를 담당하는 공통 로직.
// api/ws.js(배포)와 local-server.mjs(로컬)가 같은 구현을 공유한다.

// 연결이 끊겨도 이 시간 동안은 자리를 비워두지 않고 붙잡아 둔다.
// 잠깐 다른 앱을 보고 돌아오는 정도로 자리를 잃으면 안 되기 때문.
const SEAT_GRACE_MS = 10 * 60 * 1000;
// 모든 자리가 비고 이 시간이 지나면 방을 정리한다.
const ROOM_GRACE_MS = 15 * 60 * 1000;

const rooms = new Map();

const randomCode = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const randomToken = () =>
  `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const send = (socket, message) => {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
};

function broadcast(room, message, { except = null } = {}) {
  for (const seat of room.seats) {
    if (!seat.socket || seat.socket === except) continue;
    send(seat.socket, message);
  }
}

const connectedCount = (room) => room.seats.filter((seat) => seat.socket && seat.socket.readyState === 1).length;

function presencePayload(room) {
  return {
    type: "presence",
    connected: connectedCount(room),
    capacity: room.capacity,
    seats: room.seats.map((seat) => ({
      seat: seat.index,
      claimed: Boolean(seat.token),
      online: Boolean(seat.socket && seat.socket.readyState === 1),
    })),
  };
}

function createRoom(capacity) {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();
  const room = {
    code,
    capacity,
    snapshot: null,
    // 스냅샷마다 번호를 매겨, 재접속한 쪽이 뒤처진 상태인지 바로 판별한다.
    revision: 0,
    seats: Array.from({ length: capacity }, (_, index) => ({
      index,
      token: null,
      socket: null,
      disconnectedAt: null,
    })),
    emptiedAt: null,
  };
  rooms.set(code, room);
  return room;
}

function claimSeat(room, socket) {
  const free = room.seats.find((seat) => !seat.token);
  if (!free) return null;
  free.token = randomToken();
  free.socket = socket;
  free.disconnectedAt = null;
  room.emptiedAt = null;
  return free;
}

function attach(socket, room, seat) {
  socket.roomCode = room.code;
  socket.seatIndex = seat.index;
}

function welcome(socket, room, seat, { resumed = false } = {}) {
  send(socket, {
    type: "welcome",
    code: room.code,
    seat: seat.index,
    token: seat.token,
    capacity: room.capacity,
    snapshot: room.snapshot,
    revision: room.revision,
    resumed,
  });
}

function sweep() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const seat of room.seats) {
      if (!seat.token || seat.socket) continue;
      if (seat.disconnectedAt && now - seat.disconnectedAt > SEAT_GRACE_MS) {
        seat.token = null;
        seat.disconnectedAt = null;
      }
    }
    const anyClaimed = room.seats.some((seat) => seat.token);
    if (!anyClaimed) {
      room.emptiedAt = room.emptiedAt ?? now;
      if (now - room.emptiedAt > ROOM_GRACE_MS) rooms.delete(code);
    } else {
      room.emptiedAt = null;
    }
  }
}

export function attachRoomHandlers(wss) {
  const timer = setInterval(sweep, 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();

  wss.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      if (message.type === "create") {
        const capacity = Number(message.playerCount);
        if (![2, 3, 4].includes(capacity)) {
          send(socket, { type: "error", message: "플레이어 수는 2~4명이어야 합니다." });
          return;
        }
        const room = createRoom(capacity);
        const seat = claimSeat(room, socket);
        attach(socket, room, seat);
        welcome(socket, room, seat);
        broadcast(room, presencePayload(room));
        return;
      }

      if (message.type === "join") {
        const room = rooms.get(String(message.code || "").toUpperCase());
        if (!room) {
          send(socket, { type: "error", message: "방을 찾을 수 없습니다." });
          return;
        }
        const seat = claimSeat(room, socket);
        if (!seat) {
          send(socket, { type: "error", message: "이미 가득 찬 방입니다." });
          return;
        }
        attach(socket, room, seat);
        welcome(socket, room, seat);
        broadcast(room, presencePayload(room));
        return;
      }

      // 끊겼다 돌아온 클라이언트가 원래 자리를 되찾는다.
      if (message.type === "resume") {
        const room = rooms.get(String(message.code || "").toUpperCase());
        const seat = room?.seats[Number(message.seat)];
        if (!room || !seat || !seat.token || seat.token !== message.token) {
          send(socket, { type: "resume-failed", message: "세션이 만료되었습니다." });
          return;
        }
        // 같은 자리에 유령 연결이 남아 있으면 정리한다.
        if (seat.socket && seat.socket !== socket) {
          try {
            seat.socket.close();
          } catch {
            /* 이미 닫힌 소켓은 무시 */
          }
        }
        seat.socket = socket;
        seat.disconnectedAt = null;
        room.emptiedAt = null;
        attach(socket, room, seat);
        welcome(socket, room, seat, { resumed: true });
        broadcast(room, presencePayload(room));
        return;
      }

      const room = rooms.get(socket.roomCode);
      if (!room) return;

      if (message.type === "snapshot") {
        room.snapshot = message.snapshot;
        room.revision += 1;
        broadcast(room, { type: "snapshot", snapshot: room.snapshot, revision: room.revision }, { except: socket });
        return;
      }

      // 재접속 직후 클라이언트가 자기 상태가 최신인지 확인할 때 쓴다.
      if (message.type === "sync-request") {
        send(socket, { type: "snapshot", snapshot: room.snapshot, revision: room.revision });
      }
    });

    socket.on("close", () => {
      const room = rooms.get(socket.roomCode);
      const seat = room?.seats[socket.seatIndex];
      if (!seat || seat.socket !== socket) return;
      // 자리는 남겨두고 소켓만 떼어낸다. 유예 시간 안에 돌아오면 그대로 복구된다.
      seat.socket = null;
      seat.disconnectedAt = Date.now();
      broadcast(room, presencePayload(room));
    });
  });

  // 죽은 연결을 감지해 자리를 오래 붙잡고 있지 않도록 한다.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        /* 전송 실패는 다음 주기에 정리된다 */
      }
    }
  }, 30 * 1000);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  return wss;
}
