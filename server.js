require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 3000;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

// Serve favicon explicitly so it's never 404
const FAVICON_PATH = path.join(__dirname, 'public', 'favicon.ico');
app.get('/favicon.ico', (req, res) => {
  if (fs.existsSync(FAVICON_PATH)) {
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(FAVICON_PATH);
  } else {
    res.status(204).end(); // No content — silences the 404 without an error
  }
});

// ─── MongoDB OR file fallback ─────────────────────────────────────────────────
const USE_MONGO = !!process.env.MONGO_URL;
let User;
if (USE_MONGO) {
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(e => console.error('❌ MongoDB:', e.message));
  const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    hash:     { type: String, required: true },
    pfp:      { type: String, default: null },
    wins:     { type: Number, default: 0 },
    games:    { type: Number, default: 0 },
    createdAt:{ type: Date, default: Date.now }
  });
  User = mongoose.model('User', userSchema);
  console.log('✅ Using MongoDB');
} else {
  console.log('📁 Using local file storage');
}

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')); } catch { return {}; } }
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

function hashPw(pw) { return crypto.createHash('sha256').update(pw + ':luno_secret_2024').digest('hex'); }
const sessions = new Map();
function mkSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, username);
  setTimeout(() => sessions.delete(token), 86400000 * 7);
  return token;
}

// ─── User CRUD ────────────────────────────────────────────────────────────────
async function getUser(username) {
  if (USE_MONGO) return await User.findOne({ username }).lean();
  const u = loadUsers(); return u[username] ? { username, ...u[username] } : null;
}
async function createUser(username, hash, pfp) {
  if (USE_MONGO) return await User.create({ username, hash, pfp: pfp||null, wins:0, games:0 });
  const u = loadUsers(); u[username] = { hash, pfp:pfp||null, wins:0, games:0 }; saveUsers(u);
}
async function updateUserPfp(username, pfp) {
  if (USE_MONGO) return await User.updateOne({ username }, { pfp:pfp||null });
  const u = loadUsers(); if(u[username]){ u[username].pfp=pfp||null; saveUsers(u); }
}
async function recordResult(username, isWinner) {
  if (!username) return;
  if (USE_MONGO) {
    await User.updateOne({ username }, { $inc: { games:1, ...(isWinner?{wins:1}:{}) } });
  } else {
    const u = loadUsers(); if(!u[username]) return;
    u[username].games=(u[username].games||0)+1;
    if(isWinner) u[username].wins=(u[username].wins||0)+1;
    saveUsers(u);
  }
}
async function getScores() {
  if (USE_MONGO) {
    const rows = await User.find({games:{$gt:0}}).sort({wins:-1}).limit(25).lean();
    return rows.map(u=>({username:u.username,pfp:u.pfp,wins:u.wins||0,games:u.games||0,
      winRate:u.games>0?Math.round(((u.wins||0)/u.games)*100):0}));
  }
  const u = loadUsers();
  return Object.entries(u).filter(([,d])=>(d.games||0)>0)
    .map(([username,d])=>({username,pfp:d.pfp,wins:d.wins||0,games:d.games||0,
      winRate:d.games>0?Math.round(((d.wins||0)/d.games)*100):0}))
    .sort((a,b)=>b.wins-a.wins).slice(0,25);
}

// ─── REST API ─────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password, pfp } = req.body || {};
  const u = (username||'').trim();
  if (!u||!password||u.length<2||password.length<4) return res.json({error:'Username >= 2 chars, password >= 4 chars'});
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return res.json({error:'Letters, numbers, underscores only'});
  if (await getUser(u)) return res.json({error:'Username already taken'});
  await createUser(u, hashPw(password), pfp||null);
  res.json({token:mkSession(u), username:u, pfp:pfp||null, wins:0, games:0});
});
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ud = await getUser(username);
  if (!ud||ud.hash!==hashPw(password)) return res.json({error:'Wrong username or password'});
  res.json({token:mkSession(username), username, pfp:ud.pfp, wins:ud.wins||0, games:ud.games||0});
});
app.post('/api/pfp', async (req, res) => {
  const { token, pfp } = req.body || {};
  const username = sessions.get(token);
  if (!username) return res.json({error:'Not authenticated'});
  await updateUserPfp(username, pfp||null);
  res.json({success:true});
});
app.get('/api/scores', async (req, res) => {
  try { res.json(await getScores()); } catch(e) { res.json([]); }
});

// ─── Deck ─────────────────────────────────────────────────────────────────────
let baseDeck = Array.from({length:112},(_,i)=>i);
baseDeck.splice(56,1); baseDeck.splice(69,1); baseDeck.splice(82,1); baseDeck.splice(95,1);

function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }
function cardColor(n) { if(n%14===13)return'black'; return['red','yellow','green','blue'][Math.floor(n/14)%4]; }
function cardType(n)  { const m=n%14; if(m===10)return'Skip'; if(m===11)return'Reverse'; if(m===12)return'Draw2'; if(m===13)return Math.floor(n/14)>=4?'Draw4':'Wild'; return'Number'; }
function cardScore(n) { const m=n%14; if(m>=10&&m<=12)return 20; if(m===13)return 50; return m; }

// ─── Room state ───────────────────────────────────────────────────────────────
const maxPeople = 10;

function makePlayer() { return {id:null,name:'',pfp:null,hand:[],active:false}; }
function makeRoom(code) {
  return {
    code,
    isPrivate: false,
    started:false, host:null, deck:[], discard:[], reverse:0, turn:0,
    cardOnBoard:0, people:0, chosenColor:null,
    players:Array.from({length:maxPeople},makePlayer),
    lastPlayState: null,   // for undo
    unoCalled: {},         // playerId -> bool
    unoWindow: {}          // playerId -> timeout
  };
}

// Dynamic rooms - created on demand
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({length:8}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function getOrCreatePublicRoom() {
  for (const [code, r] of Object.entries(rooms)) {
    if (!r.started && !r.isPrivate && getRoomSockets(code).length < maxPeople) return code;
  }
  const code = generateRoomCode();
  rooms[code] = makeRoom(code);
  rooms[code].isPrivate = false;
  return code;
}

function getRoomSockets(name) { try{const r=io.sockets.adapter.rooms[name];return r?Object.keys(r.sockets):[];}catch{return[];} }
function getActivePlayers(name) { return rooms[name]?rooms[name].players.filter(p=>p.active&&p.id):[]; }

function getLobbyState(name) {
  const r=rooms[name]; if(!r) return null;
  const count=getRoomSockets(name).length;
  return {room:name,count,maxPeople,hostId:r.host,canStart:count>=2,isPrivate:r.isPrivate||false,
    players:r.players.filter(p=>p.id).map(p=>({name:p.name,pfp:p.pfp,isHost:p.id===r.host}))};
}

function broadcastCardCounts(name) {
  const r=rooms[name]; if(!r) return;
  const counts=r.players.filter(p=>p.active&&p.id).map(p=>({id:p.id,count:p.hand.length}));
  io.to(name).emit('cardCounts',counts);
}

function replenishDeck(name) {
  const r=rooms[name]; if(!r||r.deck.length>0) return;
  if(r.discard.length<=1) return;
  const top=r.discard.pop(); r.deck=[...r.discard]; shuffle(r.deck); r.discard=[top];
  io.to(name).emit('notify',{msg:'Deck reshuffled! ♻️',type:'info'});
}

function startGame(name) {
  const r=rooms[name]; if(!r) return;
  const sockets=getRoomSockets(name), people=sockets.length;
  if(people<2){io.to(name).emit('notify',{msg:'Need >= 2 players!',type:'error'});return;}
  r.started=true; r.people=people; r.deck=[]; r.discard=[];
  for(let i=0;i<people;i++) r.players[i]={id:sockets[i],name:r.players[i].name||`P${i+1}`,pfp:r.players[i].pfp||null,hand:[],active:true};
  for(let i=people;i<maxPeople;i++) r.players[i]=makePlayer();
  const d=[...baseDeck]; shuffle(d); r.deck=d;
  for(let i=0;i<people*7;i++) r.players[i%people].hand.push(r.deck.shift());
  let board;
  do{board=r.deck.shift();if(cardColor(board)!=='black')break;r.deck.push(board);}while(true);
  r.cardOnBoard=board; r.chosenColor=null; r.turn=0; r.reverse=0;
  r.lastPlayState=null; r.unoCalled={}; r.unoWindow={};
  if(cardType(board)==='Draw2'){r.players[0].hand.push(r.deck.shift(),r.deck.shift());r.turn=1%people;}
  else if(cardType(board)==='Reverse'){r.reverse=1;r.turn=(people-1)%people;}
  else if(cardType(board)==='Skip'){r.turn=1%people;}
  const playerInfo=r.players.slice(0,people).map(p=>({id:p.id,name:p.name,pfp:p.pfp}));
  io.to(name).emit('gameStarted',{cardOnBoard:r.cardOnBoard,chosenColor:r.chosenColor,turnId:r.players[r.turn].id,players:playerInfo});
  for(let i=0;i<people;i++) io.to(r.players[i].id).emit('haveCard',r.players[i].hand);
  broadcastCardCounts(name);
  console.log(`>> ${name}: Started ${people}p. Board:${cardType(board)} ${cardColor(board)} [${board}]`);
}

function advanceTurn(name,skip=0) {
  const r=rooms[name]; if(!r) return;
  const dir=r.reverse?-1:1;let next=r.turn;
  for(let s=0;s<1+skip;s++){
    next=((next+dir)%r.people+r.people)%r.people;
    let g=0;while(!r.players[next]?.active&&g<r.people){next=((next+dir)%r.people+r.people)%r.people;g++;}
  }
  r.turn=next; io.to(name).emit('turnPlayer',r.players[r.turn].id);
}

function checkWin(name,idx) {
  const r=rooms[name]; if(!r) return false;
  if(r.players[idx].hand.length>0) return false;
  const winner=r.players[idx];
  const points=r.players.filter((_,i)=>i!==idx).reduce((s,p)=>s+p.hand.reduce((a,c)=>a+cardScore(c),0),0);
  io.to(name).emit('gameOver',{winner:winner.name,winnerId:winner.id,points});
  getActivePlayers(name).forEach(p=>{const s=io.sockets.sockets[p.id];if(s?.username)recordResult(s.username,p.id===winner.id);});
  // Capture which sockets are still connected before reset
  const stillConnected=getRoomSockets(name);
  // Reset room but preserve code, privacy, and reassign host to first connected socket
  const isPrivate = r.isPrivate;
  rooms[name]=makeRoom(name);
  rooms[name].isPrivate = isPrivate;
  // Pre-assign host to first still-connected socket so Play Again works
  if(stillConnected.length>0) rooms[name].host = stillConnected[0];
  return true;
}

function handleGameDisconnect(name,socketId,playerName) {
  const r=rooms[name]; if(!r) return;
  const idx=r.players.findIndex(p=>p.id===socketId&&p.active);
  if(idx===-1) return;
  r.deck.push(...r.players[idx].hand); shuffle(r.deck);
  r.players[idx].active=false; r.players[idx].hand=[];
  const remaining=getActivePlayers(name);
  if(remaining.length<2){
    if(remaining.length===1){
      const winner=remaining[0];
      io.to(name).emit('notify',{msg:`${playerName} left — ${winner.name} wins!`,type:'success'});
      setTimeout(()=>{
        io.to(name).emit('gameOver',{winner:winner.name,winnerId:winner.id,points:0,byDisconnect:true});
        const s=io.sockets.sockets[winner.id];if(s?.username)recordResult(s.username,true);
        const isPrivate = r.isPrivate;
        const stillConnected = getRoomSockets(name);
        rooms[name]=makeRoom(name);
        rooms[name].isPrivate = isPrivate;
        // Winner becomes host automatically
        if(stillConnected.length>0) rooms[name].host = stillConnected[0];
      },1500);
    } else {
      io.to(name).emit('notify',{msg:'All players left.',type:'error'});
      const isPrivate = r.isPrivate;
      rooms[name]=makeRoom(name);
      rooms[name].isPrivate = isPrivate;
    }
    return;
  }
  const active=r.players.filter(p=>p.active);
  const wasTurn=r.turn===idx;
  for(let i=0;i<maxPeople;i++) r.players[i]=i<active.length?active[i]:makePlayer();
  r.people=active.length;
  if(wasTurn||r.turn>=r.people) r.turn=r.turn%r.people;
  // If the host left mid-game, promote the next active player as host
  if(r.host===socketId) r.host = active[0]?.id || null;
  io.to(name).emit('notify',{msg:`${playerName} left — ${active.length} players remain`,type:'warning'});
  io.to(name).emit('playerLeft',{players:active.map(p=>({id:p.id,name:p.name,pfp:p.pfp})),cardOnBoard:r.cardOnBoard,chosenColor:r.chosenColor});
  io.to(name).emit('turnPlayer',r.players[r.turn].id);
  active.forEach(p=>io.to(p.id).emit('haveCard',p.hand));
  broadcastCardCounts(name);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  function joinRoom(name) {
    const r=rooms[name]; if(!r) return false;
    const count=getRoomSockets(name).length;
    if(count>=maxPeople) return false;
    socket.join(name); socket.currentRoom=name;
    // Find first empty slot
    let slot=r.players.findIndex(p=>!p.id);
    if(slot===-1) slot=count;
    r.players[slot]={id:socket.id,name:socket.playerName,pfp:socket.pfp,hand:[],active:false};
    // Only auto-assign host if there's no host yet
    if(!r.host) r.host=socket.id;
    setTimeout(()=>{ if(rooms[name]) io.to(name).emit('lobbyUpdate',getLobbyState(name)); },80);
    socket.emit('assignedRoom',name);
    console.log(`>> ${name}: ${socket.playerName} joined (${count+1}/${maxPeople}) host=${r.host}`);
    return true;
  }

  socket.on('requestRoom', ({playerName,token,pfp}) => {
    socket.playerName=playerName||'Guest'; socket.pfp=pfp||null;
    socket.username=token?sessions.get(token)||null:null;
    const code=getOrCreatePublicRoom();
    joinRoom(code);
  });

  // Join a specific room by code
  socket.on('joinRoomByCode', ({code,playerName,token,pfp}) => {
    socket.playerName=playerName||'Guest'; socket.pfp=pfp||null;
    socket.username=token?sessions.get(token)||null:null;
    const r=rooms[code];
    if(!r){socket.emit('roomJoinError','Room not found! Check the code.');return;}
    if(r.started){socket.emit('roomJoinError','Game already started!');return;}
    if(getRoomSockets(code).length>=maxPeople){socket.emit('roomJoinError','Room is full!');return;}
    joinRoom(code);
  });

  // Create a private room
  socket.on('createPrivateRoom', ({playerName,token,pfp}) => {
    socket.playerName=playerName||'Guest'; socket.pfp=pfp||null;
    socket.username=token?sessions.get(token)||null:null;
    const code=generateRoomCode();
    rooms[code]=makeRoom(code);
    rooms[code].isPrivate=true;
    joinRoom(code);
  });

  // Clean rejoin after game — go to a new room
  socket.on('rejoinLobby', () => {
    const oldRoom=socket.currentRoom;
    if(oldRoom&&rooms[oldRoom]){
      const r=rooms[oldRoom];
      socket.leave(oldRoom);
      if(r&&!r.started){
        const active=r.players.filter(p=>p.id&&p.id!==socket.id);
        for(let i=0;i<maxPeople;i++) r.players[i]=i<active.length?active[i]:makePlayer();
        if(r.host===socket.id) r.host=active[0]?.id||null;
        setTimeout(()=>{ if(rooms[oldRoom]) io.to(oldRoom).emit('lobbyUpdate',getLobbyState(oldRoom)); },100);
        if(active.length===0&&!r.isPrivate) setTimeout(()=>{ if(rooms[oldRoom]&&getRoomSockets(oldRoom).length===0) delete rooms[oldRoom]; },5000);
      }
      socket.currentRoom=null;
    }
    const code=getOrCreatePublicRoom();
    joinRoom(code);
  });

  // Rejoin the SAME room (play again in same room)
  socket.on('rejoinRoom', ({code}) => {
    const oldRoom=socket.currentRoom;
    if(oldRoom&&rooms[oldRoom]&&oldRoom!==code){
      socket.leave(oldRoom);
      const r=rooms[oldRoom];
      if(r&&!r.started){
        const active=r.players.filter(p=>p.id&&p.id!==socket.id);
        for(let i=0;i<maxPeople;i++) r.players[i]=i<active.length?active[i]:makePlayer();
        if(r.host===socket.id) r.host=active[0]?.id||null;
        setTimeout(()=>{ if(rooms[oldRoom]) io.to(oldRoom).emit('lobbyUpdate',getLobbyState(oldRoom)); },100);
      }
      socket.currentRoom=null;
    }
    const r=rooms[code];
    if(!r){const newCode=getOrCreatePublicRoom();joinRoom(newCode);return;}
    if(!joinRoom(code)){const newCode=getOrCreatePublicRoom();joinRoom(newCode);}
  });

  socket.on('leaveGame', () => {
    const name=socket.currentRoom; if(!name||!rooms[name]) return;
    const r=rooms[name]; if(!r.started) return;
    if(socket.username) recordResult(socket.username,false);
    handleGameDisconnect(name,socket.id,socket.playerName||'A player');
  });

  socket.on('hostStartGame', name => {
    const r=rooms[name];
    if(!r||r.host!==socket.id||r.started) return;
    if(getRoomSockets(name).length<2){socket.emit('notify',{msg:'Need >= 2 players!',type:'warning'});return;}
    startGame(name);
  });

  socket.on('drawCard', ([_,roomName]) => {
    const r=rooms[roomName];if(!r?.started)return;
    if(r.players[r.turn].id!==socket.id)return;
    replenishDeck(roomName);
    if(r.deck.length===0){io.to(socket.id).emit('notify',{msg:'No cards left!',type:'warning'});return;}
    const card=r.deck.shift();
    r.players[r.turn].hand.push(card);
    r.lastPlayState=null; // clear undo on draw
    io.to(socket.id).emit('haveCard',r.players[r.turn].hand);
    io.to(roomName).emit('playerDrew',{name:r.players[r.turn].name});
    broadcastCardCounts(roomName);
    advanceTurn(roomName);
  });

  socket.on('playCard', ([cardNum,roomName,chosenColor]) => {
    const r=rooms[roomName];if(!r?.started)return;
    const numPlayer=r.turn;
    if(r.players[numPlayer].id!==socket.id)return;
    const hand=r.players[numPlayer].hand,cardIdx=hand.indexOf(cardNum);
    if(cardIdx===-1)return;
    const played=cardColor(cardNum),board=r.chosenColor||cardColor(r.cardOnBoard),pm=cardNum%14,bm=r.cardOnBoard%14;
    // Same color, same number, or black card = valid
    if(played!=='black'&&played!==board&&pm!==bm)return socket.emit('notify',{msg:"Can't play that card!",type:'error'});

    // Save undo state for wild/draw4 cards only
    if(cardColor(cardNum)==='black'){
      r.lastPlayState={
        playerIdx:numPlayer, playerId:socket.id, cardNum,
        hand:[...hand],
        prevCardOnBoard:r.cardOnBoard, prevChosenColor:r.chosenColor,
        prevDiscard:[...r.discard], prevTurn:r.turn, prevReverse:r.reverse,
        draw4Victims:null
      };
    } else {
      r.lastPlayState=null;
    }

    hand.splice(cardIdx,1); r.discard.push(r.cardOnBoard);
    r.cardOnBoard=cardNum; r.chosenColor=played==='black'?(chosenColor||'red'):null;
    io.to(roomName).emit('sendCard',{card:cardNum,chosenColor:r.chosenColor});
    io.to(socket.id).emit('haveCard',hand);
    broadcastCardCounts(roomName);
    if(checkWin(roomName,numPlayer))return;

    // UNO tracking
    if(hand.length===1){
      r.unoCalled[socket.id]=false;
      if(r.unoWindow[socket.id]) clearTimeout(r.unoWindow[socket.id]);
      r.unoWindow[socket.id]=setTimeout(()=>{ delete r.unoWindow[socket.id]; },5000);
      io.to(roomName).emit('unoAlert',{id:socket.id,name:r.players[numPlayer].name});
    }

    const type=cardType(cardNum);let skip=0;
    if(type==='Skip'){skip=1;}
    else if(type==='Reverse'){if(r.people===2)skip=1;else r.reverse=(r.reverse+1)%2;}
    else if(type==='Draw2'){
      skip=1;const dir=r.reverse?-1:1,nextP=((r.turn+dir)%r.people+r.people)%r.people;
      for(let k=0;k<2;k++){replenishDeck(roomName);if(r.deck.length)r.players[nextP].hand.push(r.deck.shift());}
      io.to(r.players[nextP].id).emit('haveCard',r.players[nextP].hand);
      io.to(r.players[nextP].id).emit('notify',{msg:'+2 cards coming! 😬',type:'warning'});
      broadcastCardCounts(roomName);
    }else if(type==='Draw4'){
      skip=1;const dir=r.reverse?-1:1,nextP=((r.turn+dir)%r.people+r.people)%r.people;
      if(r.lastPlayState) r.lastPlayState.draw4Victims={playerIdx:nextP,cardsTaken:4};
      for(let k=0;k<4;k++){replenishDeck(roomName);if(r.deck.length)r.players[nextP].hand.push(r.deck.shift());}
      io.to(r.players[nextP].id).emit('haveCard',r.players[nextP].hand);
      io.to(r.players[nextP].id).emit('notify',{msg:'+4 CARDS!! 💀',type:'error'});
      broadcastCardCounts(roomName);
    }
    advanceTurn(roomName,skip);
  });

  // Undo a wild or draw4 card (only immediately after playing)
  socket.on('undoPlay', (roomName) => {
    const r=rooms[roomName]; if(!r?.started) return;
    const state=r.lastPlayState;
    if(!state){socket.emit('notify',{msg:'Nothing to undo!',type:'warning'});return;}
    if(state.playerId!==socket.id){socket.emit('notify',{msg:"Can't undo another player's card!",type:'error'});return;}
    // Restore player hand
    const p=r.players[state.playerIdx];
    p.hand=state.hand;
    // Restore board state
    r.cardOnBoard=state.prevCardOnBoard;
    r.chosenColor=state.prevChosenColor;
    r.discard=state.prevDiscard;
    r.turn=state.prevTurn;
    r.reverse=state.prevReverse;
    // Undo draw4 victim cards
    if(state.draw4Victims){
      const victim=r.players[state.draw4Victims.playerIdx];
      const taken=victim.hand.splice(victim.hand.length-state.draw4Victims.cardsTaken, state.draw4Victims.cardsTaken);
      r.deck.unshift(...taken);
      io.to(victim.id).emit('haveCard',victim.hand);
      io.to(victim.id).emit('notify',{msg:'Opponent undid their +4!',type:'info'});
    }
    r.lastPlayState=null;
    // Clear UNO state for this player if triggered
    delete r.unoCalled[socket.id];
    if(r.unoWindow[socket.id]){clearTimeout(r.unoWindow[socket.id]);delete r.unoWindow[socket.id];}
    io.to(socket.id).emit('haveCard',p.hand);
    io.to(roomName).emit('sendCard',{card:r.cardOnBoard,chosenColor:r.chosenColor});
    io.to(roomName).emit('turnPlayer',r.players[r.turn].id);
    io.to(roomName).emit('notify',{msg:`${p.name} took back their card`,type:'info'});
    broadcastCardCounts(roomName);
  });

  socket.on('callUno', roomName => {
    const r=rooms[roomName];if(!r?.started)return;
    const p=r.players.find(pl=>pl.id===socket.id);
    if(p&&p.hand.length===1){
      r.unoCalled[socket.id]=true;
      if(r.unoWindow[socket.id]){clearTimeout(r.unoWindow[socket.id]);delete r.unoWindow[socket.id];}
      io.to(roomName).emit('unoShout',{id:socket.id,name:p.name});
    }
  });

  // Catch a player who didn't say UNO
  socket.on('catchUno', ({roomName,targetId}) => {
    const r=rooms[roomName]; if(!r?.started) return;
    if(socket.id===targetId) return; // can't catch yourself
    const target=r.players.find(p=>p.id===targetId);
    if(!target||!target.active) return;
    if(target.hand.length!==1){socket.emit('notify',{msg:'They no longer have 1 card!',type:'warning'});return;}
    // Must not have called UNO and must be in the catch window
    if(r.unoCalled[targetId]!==false){socket.emit('notify',{msg:'No catch available!',type:'warning'});return;}
    // Penalty +2
    for(let k=0;k<2;k++){replenishDeck(roomName);if(r.deck.length)target.hand.push(r.deck.shift());}
    delete r.unoCalled[targetId];
    if(r.unoWindow[targetId]){clearTimeout(r.unoWindow[targetId]);delete r.unoWindow[targetId];}
    io.to(target.id).emit('haveCard',target.hand);
    io.to(target.id).emit('notify',{msg:"Caught! You didn't say UNO! +2 cards!",type:'error'});
    io.to(roomName).emit('notify',{msg:`${socket.playerName} caught ${target.name} — +2 cards!`,type:'warning'});
    io.to(roomName).emit('unoCaught',{caughtId:targetId,caughtName:target.name,catcherName:socket.playerName});
    broadcastCardCounts(roomName);
  });

  // ─── Reactions ──────────────────────────────────────────────────────────────
  socket.on('reaction', ({key,roomName,x,y}) => {
    if(!roomName) return;
    socket.to(roomName).emit('reaction',{fromName:socket.playerName||'Guest',fromPfp:socket.pfp||null,key,x,y});
  });

  // ─── Chat ────────────────────────────────────────────────────────────────────
  socket.on('chat', ({msg,roomName}) => {
    const clean=(msg||'').trim().substring(0,200);
    if(!clean||!roomName) return;
    io.to(roomName).emit('chat',{id:socket.id,name:socket.playerName,pfp:socket.pfp,msg:clean,ts:Date.now()});
  });

  // ─── WebRTC VC signaling ────────────────────────────────────────────────────
  socket.on('vc-join', roomName => { socket.to(roomName).emit('vc-user-joined',{id:socket.id,name:socket.playerName}); });
  socket.on('vc-leave', roomName => { socket.to(roomName).emit('vc-user-left',{id:socket.id}); });
  socket.on('vc-offer',    ({to,offer})     => io.to(to).emit('vc-offer',    {from:socket.id,offer}));
  socket.on('vc-answer',   ({to,answer})    => io.to(to).emit('vc-answer',   {from:socket.id,answer}));
  socket.on('vc-ice',      ({to,candidate}) => io.to(to).emit('vc-ice',      {from:socket.id,candidate}));
  socket.on('vc-speaking', ({roomName,speaking}) => socket.to(roomName).emit('vc-speaking',{id:socket.id,speaking}));

  // ─── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnecting', () => {
    const name=socket.currentRoom; if(!name||!rooms[name]) return;
    const r=rooms[name];
    if(r.started) handleGameDisconnect(name,socket.id,socket.playerName||'A player');
    else{
      const active=r.players.filter(p=>p.id&&p.id!==socket.id);
      for(let i=0;i<maxPeople;i++) r.players[i]=i<active.length?active[i]:makePlayer();
      if(r.host===socket.id) r.host=active[0]?.id||null;
      setTimeout(()=>{ if(rooms[name]) io.to(name).emit('lobbyUpdate',getLobbyState(name)); },100);
      if(active.length===0&&!r.isPrivate) setTimeout(()=>{ if(rooms[name]&&getRoomSockets(name).length===0) delete rooms[name]; },5000);
    }
  });
  socket.on('disconnect',()=>console.log(`>> ${socket.playerName||'?'} disconnected`));
});

http.listen(port,()=>console.log(`LUNO on :${port} | MongoDB: ${USE_MONGO}`));