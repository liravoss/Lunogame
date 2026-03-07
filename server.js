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
  if (!u||!password||u.length<2||password.length<4) return res.json({error:'Username ≥2 chars, password ≥4 chars'});
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
// BUG FIX: correct offsets to skip the 4 blank sprite cells
let baseDeck = Array.from({length:112},(_,i)=>i);
baseDeck.splice(56,1); baseDeck.splice(69,1); baseDeck.splice(82,1); baseDeck.splice(95,1);
// Result: 108 valid card sprite indices

function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }
function cardColor(n) { if(n%14===13)return'black'; return['red','yellow','green','blue'][Math.floor(n/14)%4]; }
function cardType(n)  { const m=n%14; if(m===10)return'Skip'; if(m===11)return'Reverse'; if(m===12)return'Draw2'; if(m===13)return Math.floor(n/14)>=4?'Draw4':'Wild'; return'Number'; }
function cardScore(n) { const m=n%14; if(m>=10&&m<=12)return 20; if(m===13)return 50; return m; }

// ─── Room state ───────────────────────────────────────────────────────────────
const numRooms=5, maxPeople=10;
function makePlayer() { return {id:null,name:'',pfp:null,hand:[],active:false}; }
function makeRoom()   { return {started:false,host:null,deck:[],discard:[],reverse:0,turn:0,cardOnBoard:0,people:0,chosenColor:null,players:Array.from({length:maxPeople},makePlayer)}; }
const rooms = {};
for(let i=1;i<=numRooms;i++) rooms[`Room_${i}`]=makeRoom();

function getRoomSockets(name) { try{const r=io.sockets.adapter.rooms[name];return r?Object.keys(r.sockets):[];}catch{return[];} }
function getActivePlayers(name) { return rooms[name].players.filter(p=>p.active&&p.id); }

function getLobbyState(name) {
  const r=rooms[name], count=getRoomSockets(name).length;
  return {room:name,count,maxPeople,hostId:r.host,canStart:count>=2,
    players:r.players.filter(p=>p.id).slice(0,count).map(p=>({name:p.name,pfp:p.pfp,isHost:p.id===r.host}))};
}

// Broadcast card counts to everyone in room
function broadcastCardCounts(name) {
  const r=rooms[name];
  const counts=r.players.filter(p=>p.active&&p.id).map(p=>({id:p.id,count:p.hand.length}));
  io.to(name).emit('cardCounts',counts);
}

function replenishDeck(name) {
  const r=rooms[name]; if(r.deck.length>0) return;
  if(r.discard.length<=1) return;
  const top=r.discard.pop(); r.deck=[...r.discard]; shuffle(r.deck); r.discard=[top];
  io.to(name).emit('notify',{msg:'Deck reshuffled! ♻️',type:'info'});
}

function startGame(name) {
  const r=rooms[name], sockets=getRoomSockets(name), people=sockets.length;
  if(people<2){io.to(name).emit('notify',{msg:'Need ≥2 players!',type:'error'});return;}
  r.started=true; r.people=people; r.deck=[]; r.discard=[];
  for(let i=0;i<people;i++) r.players[i]={id:sockets[i],name:r.players[i].name||`P${i+1}`,pfp:r.players[i].pfp||null,hand:[],active:true};
  for(let i=people;i<maxPeople;i++) r.players[i]=makePlayer();
  const d=[...baseDeck]; shuffle(d); r.deck=d;
  for(let i=0;i<people*7;i++) r.players[i%people].hand.push(r.deck.shift());
  let board;
  do{board=r.deck.shift();if(cardColor(board)!=='black')break;r.deck.push(board);}while(true);
  r.cardOnBoard=board; r.chosenColor=null; r.turn=0; r.reverse=0;
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
  const r=rooms[name],dir=r.reverse?-1:1;let next=r.turn;
  for(let s=0;s<1+skip;s++){
    next=((next+dir)%r.people+r.people)%r.people;
    let g=0;while(!r.players[next]?.active&&g<r.people){next=((next+dir)%r.people+r.people)%r.people;g++;}
  }
  r.turn=next; io.to(name).emit('turnPlayer',r.players[r.turn].id);
}

function checkWin(name,idx) {
  const r=rooms[name];
  if(r.players[idx].hand.length>0) return false;
  const winner=r.players[idx];
  const points=r.players.filter((_,i)=>i!==idx).reduce((s,p)=>s+p.hand.reduce((a,c)=>a+cardScore(c),0),0);
  io.to(name).emit('gameOver',{winner:winner.name,winnerId:winner.id,points});
  getActivePlayers(name).forEach(p=>{const s=io.sockets.sockets[p.id];if(s?.username)recordResult(s.username,p.id===winner.id);});
  // Reset room but DON'T kick sockets — let them rejoin via rejoinLobby
  rooms[name]=makeRoom();
  return true;
}

function handleGameDisconnect(name,socketId,playerName) {
  const r=rooms[name];
  const idx=r.players.findIndex(p=>p.id===socketId&&p.active);
  if(idx===-1) return;
  r.deck.push(...r.players[idx].hand); shuffle(r.deck);
  r.players[idx].active=false; r.players[idx].hand=[];
  const remaining=getActivePlayers(name);
  if(remaining.length<2){
    if(remaining.length===1){
      const winner=remaining[0];
      io.to(name).emit('notify',{msg:`${playerName} left — ${winner.name} wins! 🏆`,type:'success'});
      setTimeout(()=>{
        io.to(name).emit('gameOver',{winner:winner.name,winnerId:winner.id,points:0,byDisconnect:true});
        const s=io.sockets.sockets[winner.id];if(s?.username)recordResult(s.username,true);
        rooms[name]=makeRoom();
      },1500);
    } else {io.to(name).emit('notify',{msg:'All players left.',type:'error'});rooms[name]=makeRoom();}
    return;
  }
  const active=r.players.filter(p=>p.active);
  const wasTurn=r.turn===idx;
  for(let i=0;i<maxPeople;i++) r.players[i]=i<active.length?active[i]:makePlayer();
  r.people=active.length;
  if(wasTurn||r.turn>=r.people) r.turn=r.turn%r.people;
  io.to(name).emit('notify',{msg:`${playerName} left — ${active.length} players remain`,type:'warning'});
  io.to(name).emit('playerLeft',{players:active.map(p=>({id:p.id,name:p.name,pfp:p.pfp})),cardOnBoard:r.cardOnBoard,chosenColor:r.chosenColor});
  io.to(name).emit('turnPlayer',r.players[r.turn].id);
  active.forEach(p=>io.to(p.id).emit('haveCard',p.hand));
  broadcastCardCounts(name);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  // Helper: assign socket to a room
  function joinRoom(name) {
    const r=rooms[name];
    const count=getRoomSockets(name).length;
    socket.join(name); socket.currentRoom=name;
    r.players[count]={id:socket.id,name:socket.playerName,pfp:socket.pfp,hand:[],active:false};
    if(count===0) r.host=socket.id;
    io.to(name).emit('lobbyUpdate',getLobbyState(name));
    socket.emit('assignedRoom',name);
    console.log(`>> ${name}: ${socket.playerName} joined (${count+1}/${maxPeople})`);
    return true;
  }

  socket.on('requestRoom', ({playerName,token,pfp}) => {
    socket.playerName=playerName||'Guest'; socket.pfp=pfp||null;
    socket.username=token?sessions.get(token)||null:null;
    for(let i=1;i<=numRooms;i++){
      const name=`Room_${i}`,r=rooms[name];
      if(r.started) continue;
      const count=getRoomSockets(name).length;
      if(count>=maxPeople) continue;
      joinRoom(name); return;
    }
    socket.emit('responseRoom','error');
  });

  // Clean rejoin after game — no disconnect/reconnect needed
  socket.on('rejoinLobby', () => {
    const oldRoom=socket.currentRoom;
    if(oldRoom){
      socket.leave(oldRoom);
      const r=rooms[oldRoom];
      if(r&&!r.started){
        const active=r.players.filter(p=>p.id&&p.id!==socket.id);
        for(let i=0;i<maxPeople;i++) r.players[i]=i<active.length?active[i]:makePlayer();
        if(r.host===socket.id) r.host=active[0]?.id||null;
        setTimeout(()=>io.to(oldRoom).emit('lobbyUpdate',getLobbyState(oldRoom)),50);
      }
      socket.currentRoom=null;
    }
    for(let i=1;i<=numRooms;i++){
      const name=`Room_${i}`,r=rooms[name];
      if(r.started) continue;
      const count=getRoomSockets(name).length;
      if(count>=maxPeople) continue;
      joinRoom(name); return;
    }
    socket.emit('responseRoom','error');
  });

  socket.on('leaveGame', () => {
    const name = socket.currentRoom; if (!name || !rooms[name]) return;
    const r = rooms[name]; if (!r.started) return;
    // Record a loss for the leaver
    if (socket.username) recordResult(socket.username, false);
    handleGameDisconnect(name, socket.id, socket.playerName || 'A player');
  });

  socket.on('hostStartGame', name => {
    const r=rooms[name];
    if(!r||r.host!==socket.id||r.started) return;
    if(getRoomSockets(name).length<2){socket.emit('notify',{msg:'Need ≥2 players!',type:'warning'});return;}
    startGame(name);
  });

  socket.on('drawCard', ([_,roomName]) => {
    const r=rooms[roomName];if(!r?.started)return;
    if(r.players[r.turn].id!==socket.id)return;
    replenishDeck(roomName);
    if(r.deck.length===0){io.to(socket.id).emit('notify',{msg:'No cards left!',type:'warning'});return;}
    const card=r.deck.shift();
    r.players[r.turn].hand.push(card);
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
    if(played!=='black'&&played!==board&&pm!==bm)return socket.emit('notify',{msg:"Can't play that card!",type:'error'});
    hand.splice(cardIdx,1); r.discard.push(r.cardOnBoard);
    r.cardOnBoard=cardNum; r.chosenColor=played==='black'?(chosenColor||'red'):null;
    io.to(roomName).emit('sendCard',{card:cardNum,chosenColor:r.chosenColor});
    io.to(socket.id).emit('haveCard',hand);
    broadcastCardCounts(roomName);
    if(checkWin(roomName,numPlayer))return;
    if(hand.length===1) io.to(roomName).emit('unoAlert',{id:socket.id,name:r.players[numPlayer].name});

    const type=cardType(cardNum);let skip=0;
    if(type==='Skip'){skip=1;}
    else if(type==='Reverse'){if(r.people===2)skip=1;else r.reverse=(r.reverse+1)%2;}
    else if(type==='Draw2'){
      skip=1;const dir=r.reverse?-1:1,nextP=((r.turn+dir)%r.people+r.people)%r.people;
      for(let k=0;k<2;k++){replenishDeck(roomName);r.players[nextP].hand.push(r.deck.shift());}
      io.to(r.players[nextP].id).emit('haveCard',r.players[nextP].hand);
      io.to(r.players[nextP].id).emit('notify',{msg:'+2 cards coming! 😬',type:'warning'});
      broadcastCardCounts(roomName);
    }else if(type==='Draw4'){
      skip=1;const dir=r.reverse?-1:1,nextP=((r.turn+dir)%r.people+r.people)%r.people;
      for(let k=0;k<4;k++){replenishDeck(roomName);r.players[nextP].hand.push(r.deck.shift());}
      io.to(r.players[nextP].id).emit('haveCard',r.players[nextP].hand);
      io.to(r.players[nextP].id).emit('notify',{msg:'+4 CARDS!! 💀',type:'error'});
      broadcastCardCounts(roomName);
    }
    advanceTurn(roomName,skip);
  });

  socket.on('callUno', roomName => {
    const r=rooms[roomName];if(!r?.started)return;
    const p=r.players.find(pl=>pl.id===socket.id);
    if(p&&p.hand.length===1) io.to(roomName).emit('unoShout',{id:socket.id,name:p.name});
  });

  // ─── Reactions ────────────────────────────────────────────────────────────
  socket.on('reaction', ({key, roomName, x, y}) => {
    if (!roomName) return;
    socket.to(roomName).emit('reaction', {
      fromName: socket.playerName || 'Guest',
      fromPfp:  socket.pfp || null,
      key, x, y
    });
  });

  // ─── Chat ─────────────────────────────────────────────────────────────────
  socket.on('chat', ({msg,roomName}) => {
    const clean=(msg||'').trim().substring(0,200);
    if(!clean||!roomName) return;
    io.to(roomName).emit('chat',{id:socket.id,name:socket.playerName,pfp:socket.pfp,msg:clean,ts:Date.now()});
  });

  // ─── WebRTC VC signaling ──────────────────────────────────────────────────
  socket.on('vc-join', roomName => {
    socket.to(roomName).emit('vc-user-joined',{id:socket.id,name:socket.playerName});
    console.log(`>> VC: ${socket.playerName} joined VC in ${roomName}`);
  });
  socket.on('vc-leave', roomName => {
    socket.to(roomName).emit('vc-user-left',{id:socket.id});
  });
  socket.on('vc-offer',     ({to,offer})     => io.to(to).emit('vc-offer',     {from:socket.id,offer}));
  socket.on('vc-answer',    ({to,answer})    => io.to(to).emit('vc-answer',    {from:socket.id,answer}));
  socket.on('vc-ice',       ({to,candidate}) => io.to(to).emit('vc-ice',       {from:socket.id,candidate}));
  socket.on('vc-speaking',  ({roomName,speaking}) => socket.to(roomName).emit('vc-speaking',{id:socket.id,speaking}));

  // ─── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnecting', () => {
    const name=socket.currentRoom;if(!name||!rooms[name])return;
    const r=rooms[name];
    if(r.started) handleGameDisconnect(name,socket.id,socket.playerName||'A player');
    else{
      const active=r.players.filter(p=>p.id&&p.id!==socket.id);
      for(let i=0;i<maxPeople;i++) r.players[i]=i<active.length?active[i]:makePlayer();
      if(r.host===socket.id) r.host=active[0]?.id||null;
      setTimeout(()=>io.to(name).emit('lobbyUpdate',getLobbyState(name)),100);
    }
  });
  socket.on('disconnect',()=>console.log(`>> ${socket.playerName||'?'} disconnected`));
});

http.listen(port,()=>console.log(`🃏 LUNO on :${port} | MongoDB: ${USE_MONGO}`));