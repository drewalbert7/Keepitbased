/**
 * Push paper-bot mutations to authenticated Socket.IO rooms (`user_<id>`).
 */
let io = null;

function setIo(socketIo) {
  io = socketIo;
}

function emitPaperBotUpdate(userId, payload) {
  if (!io || userId == null) return false;
  const room = `user_${userId}`;
  io.to(room).emit('paperBotUpdate', {
    ts: new Date().toISOString(),
    ...payload
  });
  return true;
}

module.exports = {
  setIo,
  emitPaperBotUpdate
};
