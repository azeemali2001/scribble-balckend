const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = {}; // { roomId: { users: [], drawer: null, word: "", scores: {}, timerInterval: null } }
const userSockets = {}; // username -> socket.id
const words = ["Apple", "Car", "Sun", "Tree", "Laptop"]; // add more

const getSafeRoom = (room) => ({
  users: room.users,
  drawer: room.drawer,
  word: room.word,
  scores: room.scores,
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // CREATE ROOM
  socket.on("createRoom", ({ username }) => {
    const roomId = Math.random().toString(36).substr(2, 6);
    rooms[roomId] = { users: [username], scores: {}, drawer: null, word: null, timerInterval: null };
    rooms[roomId].scores[username] = 0;

    socket.join(roomId);
    socket.username = username;
    socket.roomId = roomId;
    userSockets[username] = socket.id;

    socket.emit("roomCreated", { roomId });
  });

  // JOIN ROOM
  socket.on("joinRoom", ({ roomId, username }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("errorMsg", "Room not found");

    socket.username = username;
    socket.roomId = roomId;
    socket.join(roomId);

    if (!room.users.includes(username)) room.users.push(username);
    room.scores[username] = room.scores[username] || 0;
    userSockets[username] = socket.id;

    io.to(roomId).emit("roomUpdated", getSafeRoom(room));
  });

  // GET ROOM INFO
  socket.on("getRoomInfo", ({ roomId }) => {
    const room = rooms[roomId];
    if (room) socket.emit("roomUpdated", getSafeRoom(room));
    else socket.emit("errorMsg", "Room not found");
  });

  // SELECT DRAWER AND START ROUND
  socket.on("selectDrawer", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.users.length === 0) return;

    const randomIndex = Math.floor(Math.random() * room.users.length);
    const drawer = room.users[randomIndex];
    const word = words[Math.floor(Math.random() * words.length)];

    room.drawer = drawer;
    room.word = word;

    const drawerSocketId = userSockets[drawer];
    if (drawerSocketId) io.to(drawerSocketId).emit("yourWord", word);

    let timeLeft = 60;
    io.to(roomId).emit("roundStarted", { drawer, timeLeft });

    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      timeLeft--;
      io.to(roomId).emit("timer", timeLeft);

      if (timeLeft <= 0) {
        clearInterval(room.timerInterval);
        room.drawer = null;
        room.word = null;
        io.to(roomId).emit("drawingTimeOver");
        io.to(roomId).emit("roomUpdated", getSafeRoom(room));
      }
    }, 1000);

    io.to(roomId).emit("roomUpdated", getSafeRoom(room));
  });

  // GUESS WORD
  socket.on("guessWord", ({ roomId, username, guess }) => {
    const room = rooms[roomId];
    if (!room || !room.word) return;

    if (guess.toLowerCase().trim() === room.word.toLowerCase().trim()) {
      room.scores[username] = (room.scores[username] || 0) + 5;
      io.to(roomId).emit("correctGuess", { username, word: room.word, scores: room.scores });

      clearInterval(room.timerInterval);
      room.word = null;
      room.drawer = null;
      io.to(roomId).emit("drawingTimeOver");
      io.to(roomId).emit("roomUpdated", getSafeRoom(room));
    }
  });

  // DRAWING
  socket.on("drawing", ({ roomId, username, ...data }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (username !== room.drawer) return; // only drawer
    socket.to(roomId).emit("drawing", data);
  });

  // UNDO 
  socket.on("undo", ({ roomId, data }) => io.to(roomId).emit("undo", { data }));

  // DISCONNECT
  socket.on("disconnect", () => {
    const { roomId, username } = socket;
    if (username) delete userSockets[username];

    if (roomId && username && rooms[roomId]) {
      const room = rooms[roomId];
      room.users = room.users.filter((u) => u !== username);
      delete room.scores[username];

      if (room.drawer === username) {
        clearInterval(room.timerInterval);
        room.drawer = null;
        room.word = null;
        io.to(roomId).emit("drawingTimeOver");
      }

      io.to(roomId).emit("roomUpdated", getSafeRoom(room));
      if (room.users.length === 0) delete rooms[roomId];
    }
  });
});


const PORT = process.env.PORT || 4000;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

