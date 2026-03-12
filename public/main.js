/* ═══════════════════════════════════════════════
   LUNO — Glass Edition · Client
═══════════════════════════════════════════════ */
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const cdW = 240, cdH = 360;
const cards = new Image(), back = new Image();
cards.src = 'images/deck.svg';
back.src  = 'images/uno.svg';

// ─── Reaction GIF map ─────────────────────────────────────────────────────────
const REACTIONS = {
  lol:     { emoji:'😂', url:'https://media1.giphy.com/media/k8HUduIsUYo1XNbqne/giphy.gif' },
  sad:     { emoji:'😢', url:'https://media4.giphy.com/media/08ZDVgdH4lE46VQxT4/giphy.gif' },
  ok:      { emoji:'👍', url:'https://media.giphy.com/media/E2Lte85Qijl4QpI8LO/giphy.gif' },
  love:    { emoji:'❤️', url:'https://media.giphy.com/media/4mm3aYvQEGaowd8DPo/giphy.gif' },
  shocked: { emoji:'😱', url:'https://media.giphy.com/media/E0Bud9Tnwtmv893CmE/giphy.gif' },
  yeah:    { emoji:'🎉', url:'https://media.giphy.com/media/4NIoxNWNZKjdFtOA7G/giphy.gif' },
  sleepy:  { emoji:'😴', url:'https://media.giphy.com/media/TCaINDQJGnEFNWPhc4/giphy.gif' },
  punch:   { emoji:'👊', url:'https://media.giphy.com/media/PiIiEQ1R4HBV9YV9xw/giphy.gif' },
  bye:     { emoji:'👋', url:'https://media4.giphy.com/media/W9fllJ4HOEnNmwmihB/giphy.gif' },
  pat:     { emoji:'🤗', url:'https://media.giphy.com/media/aOHodO2ZG8Z1LVqyMX/giphy.gif' },
  jumping: { emoji:'🙌', url:'https://media3.giphy.com/media/U3Tfz4as0JGSwSjb7r/giphy.gif' },
  cow:     { emoji:'🐄', url:'https://media.giphy.com/media/EIuVm49WrrUHYSWOQy/giphy.gif' },
};

// ─── State ────────────────────────────────────────────────────────────────────
let room = null, hand = [], isTurn = false;
let cardOnBoard = null, boardChosenColor = null;
let myName = '', myPfp = null, myToken = null;
let currentPlayers = [], currentTurnId = null;
let cardCounts = new Map(), unoPlayers = new Set();
let hoveredCard = -1, pendingWild = null;
let notifyTimer = null, chatOpen = false, chatUnread = 0;
let inGame = false;
let rxnCooldown = false;

// ─── Session ──────────────────────────────────────────────────────────────────
myToken = localStorage.getItem('luno_token')    || null;
myName  = localStorage.getItem('luno_username') || '';
myPfp   = localStorage.getItem('luno_pfp')      || null;

const socket = io({ autoConnect: false });

// ═══════════════════════════════════════════
// DAZZLE PARTICLES (front page)
// ═══════════════════════════════════════════

const DAZZLE_CHARS=['✦','✧','⋆','✺','✹','★','☆','◆','✴','✵','💫','⭐','✨'];
const MAX_DAZZLE=30;
function spawnDazzle(){
  const wrap=document.getElementById('dazzle-wrap');
  if(!wrap) return;
  // Cap particle count to prevent buildup
  if(wrap.children.length>=MAX_DAZZLE) return;
  const el=document.createElement('div');
  el.className='dazzle-star';
  const char=DAZZLE_CHARS[Math.floor(Math.random()*DAZZLE_CHARS.length)];
  el.textContent=char;
  const size=8+Math.random()*16;
  el.style.cssText=`left:${Math.random()*100}%;top:${42+Math.random()*52}%;font-size:${size}px;color:hsl(${Math.random()*360},90%,78%);animation-duration:${2.8+Math.random()*2.8}s;`;
  wrap.appendChild(el);
  setTimeout(()=>el.remove(),6000);
}
let dazzleInterval=setInterval(spawnDazzle,260);
function stopDazzle(){ clearInterval(dazzleInterval); const w=document.getElementById('dazzle-wrap'); if(w) w.innerHTML=''; }

// ═══════════════════════════════════════════
// STARS CANVAS
// ═══════════════════════════════════════════
(function() {
  const sc=document.getElementById('stars'), sx=sc.getContext('2d');
  let raf, lastT=0;
  function resize(){ sc.width=innerWidth; sc.height=innerHeight; }
  resize();
  const resizeObs=()=>resize();
  window.addEventListener('resize',resizeObs,{passive:true});
  const stars=Array.from({length:180},()=>({
    x:Math.random()*innerWidth, y:Math.random()*innerHeight,
    r:Math.random()*1.3+0.2, a:Math.random(), da:(Math.random()-.5)*.006
  }));
  (function draw(t){
    raf=requestAnimationFrame(draw);
    // Throttle to ~30 fps to save GPU
    if(t-lastT<32) return;
    lastT=t;
    sx.clearRect(0,0,sc.width,sc.height);
    stars.forEach(s=>{
      s.a=Math.max(.05,Math.min(1,s.a+s.da));
      if(s.a<=.05||s.a>=1) s.da*=-1;
      sx.beginPath(); sx.arc(s.x,s.y,s.r,0,Math.PI*2);
      sx.fillStyle=`rgba(210,220,255,${s.a.toFixed(2)})`; sx.fill();
    });
  })(0);
})();

// ═══════════════════════════════════════════
// AUDIO
// ═══════════════════════════════════════════
let actx;
function initAudio() { if(!actx) actx=new(window.AudioContext||window.webkitAudioContext)(); }
function tone(f,d,type='sine',vol=.18,delay=0) {
  if(!actx) return;
  const t=actx.currentTime+delay, osc=actx.createOscillator(), g=actx.createGain();
  osc.connect(g); g.connect(actx.destination);
  osc.type=type; osc.frequency.setValueAtTime(f,t);
  g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(.001,t+d);
  osc.start(t); osc.stop(t+d+.01);
}
const SFX = {
  play:   ()=>{ tone(340,.06,'sine',.18); tone(200,.1,'sine',.12,.05); },
  draw:   ()=>{ tone(180,.1,'triangle',.14); tone(140,.13,'triangle',.1,.08); },
  click:  ()=>{ tone(520,.035,'square',.06); },
  turn:   ()=>{ tone(900,.1,'sine',.2); tone(1150,.14,'sine',.13,.1); },
  uno:    ()=>{ [440,550,660,880].forEach((f,i)=>tone(f,.18,'square',.08,i*.08)); },
  win:    ()=>{ [523,659,784,1047,1319,1568].forEach((f,i)=>tone(f,.28,'sine',.16,i*.1)); },
  start:  ()=>{ [392,494,587,740,880,1047].forEach((f,i)=>tone(f,.22,'sine',.14,i*.09)); },
  draw4:  ()=>{ [200,185,165,145].forEach((f,i)=>tone(f,.14,'sawtooth',.1,i*.07)); },
  reverse:()=>{ tone(440,.08,'sine',.12); tone(330,.1,'sine',.12,.06); },
  skip:   ()=>{ tone(600,.1,'square',.08); tone(500,.08,'square',.06,.08); },
  chat:   ()=>{ tone(700,.06,'sine',.08); tone(900,.06,'sine',.06,.08); },
  rxn:    ()=>{ tone(800,.08,'sine',.12); tone(1000,.1,'sine',.1,.07); },
};
function playSound(k) { initAudio(); SFX[k]?.(); }

// ═══════════════════════════════════════════
// CARD HELPERS
// ═══════════════════════════════════════════
function cardColor(n){ if(n%14===13)return'black'; return['red','yellow','green','blue'][Math.floor(n/14)%4]; }
function cardType(n) { const m=n%14; if(m===10)return'Skip'; if(m===11)return'Reverse'; if(m===12)return'Draw2'; if(m===13)return Math.floor(n/14)>=4?'Draw4':'Wild'; return'Number'; }
function glowCol(n)  { const c=(boardChosenColor&&cardColor(n)==='black')?boardChosenColor:cardColor(n); return{red:'#ff4757',yellow:'#ffd700',green:'#2ed573',blue:'#339af0',black:'#a855f7'}[c]||'#fff'; }
function effectiveBC(){ return boardChosenColor||cardColor(cardOnBoard); }
function canPlay(n)  { if(!isTurn||cardOnBoard===null)return false; const pc=cardColor(n),pm=n%14,bm=cardOnBoard%14; return pc==='black'||pc===effectiveBC()||pm===bm; }

// ═══════════════════════════════════════════
// CANVAS RESIZE
// ═══════════════════════════════════════════
function resizeCanvas() {
  const hudH=52; // HUD top bar height
  const availW=innerWidth;
  const availH=innerHeight-hudH;
  const s=Math.min(availW/1000, availH/600, 2);
  canvas.style.width=(1000*s)+'px';
  canvas.style.height=(600*s)+'px';
}
resizeCanvas();
window.addEventListener('resize',()=>{ resizeCanvas(); if(inGame) renderGame(); },{passive:true});

function getCanvasCoords(e) {
  const rect=canvas.getBoundingClientRect();
  const src=(e.changedTouches&&e.changedTouches.length)?e.changedTouches[0]:(e.touches&&e.touches[0])?e.touches[0]:e;
  return{X:(src.clientX-rect.left)*(1000/rect.width), Y:(src.clientY-rect.top)*(600/rect.height)};
}

// ═══════════════════════════════════════════
// API
// ═══════════════════════════════════════════
async function apiPost(url,data) {
  try{ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); return await r.json(); }
  catch{ return{error:'Network error'}; }
}
async function doLogin(u,p) {
  const r=await apiPost('/api/login',{username:u,password:p}); if(r.error)return r.error;
  myToken=r.token; myName=r.username; myPfp=r.pfp||null;
  localStorage.setItem('luno_token',myToken); localStorage.setItem('luno_username',myName);
  if(myPfp) localStorage.setItem('luno_pfp',myPfp); return null;
}
async function doRegister(u,p,pfp) {
  const r=await apiPost('/api/register',{username:u,password:p,pfp}); if(r.error)return r.error;
  myToken=r.token; myName=r.username; myPfp=pfp||null;
  localStorage.setItem('luno_token',myToken); localStorage.setItem('luno_username',myName);
  if(myPfp) localStorage.setItem('luno_pfp',myPfp); return null;
}
async function savePfp(pfp) {
  if(!myToken)return; await apiPost('/api/pfp',{token:myToken,pfp});
  myPfp=pfp; localStorage.setItem('luno_pfp',pfp);
}

// ═══════════════════════════════════════════
// SCOREBOARD
// ═══════════════════════════════════════════
async function showScoreboard() {
  playSound('click'); setOverlay('scoreboard-overlay');
  const el=document.getElementById('scoreboard-list');
  el.innerHTML='<div class="loading-msg">Loading…</div>';
  try {
    const data=await(await fetch('/api/scores')).json();
    const medals=['🥇','🥈','🥉'];
    el.innerHTML=!data.length
      ?'<div class="loading-msg">No games yet! 🎮</div>'
      :data.map((u,i)=>`
        <div class="score-row ${i<3?'rank-'+(i+1):''}">
          <div class="rank-num">${medals[i]||(i+1)}</div>
          <div class="score-user">
            <div class="score-pfp">${u.pfp?`<img src="${u.pfp}">`:'🎮'}</div>
            <div><div class="score-name">${esc(u.username)}</div>
            <div class="score-sub">${u.games} games · ${u.winRate}% win rate</div></div>
          </div>
          <div class="score-wins">${u.wins}W</div>
        </div>`).join('');
  } catch{ el.innerHTML='<div class="loading-msg">Failed to load.</div>'; }
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════
// OVERLAY MANAGER
// ═══════════════════════════════════════════
function setOverlay(id) {
  // Fade overlays
  document.querySelectorAll('.overlay').forEach(el=>el.classList.toggle('active', el.id===id));
  // Canvas shown only when no overlay (pure game view)
  const isGameView = !id && inGame;
  document.getElementById('canvas-wrap').classList.toggle('active', isGameView);
  // HUD / panels
  const hud = document.getElementById('hud');
  const pp  = document.getElementById('player-panel');
  const cp  = document.getElementById('chat-panel');
  if(isGameView){
    hud.style.display=''; pp.style.display=''; cp.style.display='';
    stopDazzle();
  } else {
    hud.style.display='none'; pp.style.display='none'; cp.style.display='none';
  }
}
function closeModal() {
  if(inGame){
    // Close any modal without leaving the game
    document.querySelectorAll('.modal-overlay').forEach(el=>el.classList.remove('active'));
    const hud=document.getElementById('hud');
    const pp=document.getElementById('player-panel');
    const cp=document.getElementById('chat-panel');
    hud.style.display=''; pp.style.display=''; cp.style.display='';
    document.getElementById('canvas-wrap').classList.add('active');
  } else {
    setOverlay('lobby-overlay');
  }
}

// ═══════════════════════════════════════════
// PFP HELPER
// ═══════════════════════════════════════════
function setupPfpInput(fileInput,previewEl,cb) {
  fileInput.addEventListener('change',e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image(); img.onload=()=>{
        const c=document.createElement('canvas'); c.width=c.height=200;
        const cx=c.getContext('2d');
        const min=Math.min(img.width,img.height),ox=(img.width-min)/2,oy=(img.height-min)/2;
        cx.drawImage(img,ox,oy,min,min,0,0,200,200);
        const d=c.toDataURL('image/jpeg',.75);
        if(previewEl) previewEl.innerHTML=`<img src="${d}">`;
        cb(d);
      }; img.src=ev.target.result;
    }; reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════
// AUTH UI
// ═══════════════════════════════════════════
// AUTH UI
// ═══════════════════════════════════════════
let regPfp=null;

// ── Password eye toggle ──────────────────────────────────────────────────────
// Works on mobile (touchstart) and desktop (click).
// Uses CSS classes .eye-on / .eye-off controlled by .showing on the button.
document.querySelectorAll('.pw-eye').forEach(btn=>{
  function toggle(e){
    e.preventDefault();
    e.stopPropagation();
    const inp=document.getElementById(btn.dataset.target);
    if(!inp) return;
    const show=inp.type==='password';
    inp.type=show?'text':'password';
    btn.classList.toggle('showing',show);
    btn.setAttribute('aria-label', show?'Hide password':'Show password');
    inp.focus();
  }
  btn.addEventListener('click',toggle);
  // Also support touchstart so mobile doesn't need double-tap
  btn.addEventListener('touchstart',toggle,{passive:false});
});

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{
  playSound('click');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
  document.getElementById('auth-error').textContent='';
}));

// ── PFP upload ────────────────────────────────────────────────────────────────
document.getElementById('pfp-upload-btn').addEventListener('click',()=>document.getElementById('pfp-file').click());
document.getElementById('pfp-preview').addEventListener('click',()=>document.getElementById('pfp-file').click());
setupPfpInput(document.getElementById('pfp-file'),document.getElementById('pfp-preview'),d=>{regPfp=d;});

// ── Login ─────────────────────────────────────────────────────────────────────
async function handleLogin(){
  playSound('click');
  const u=document.getElementById('login-username').value.trim();
  const p=document.getElementById('login-password').value;
  const errEl=document.getElementById('auth-error');
  if(!u||!p){errEl.textContent='Please fill in all fields.';return;}
  const btn=document.getElementById('login-btn');
  btn.textContent='Logging in…'; btn.disabled=true;
  const err=await doLogin(u,p);
  btn.textContent='🚀 Login'; btn.disabled=false;
  if(err){errEl.textContent=err;return;}
  errEl.textContent='';
  enterLobby();
}
document.getElementById('login-btn').addEventListener('click',handleLogin);
// Enter key on either login field triggers login
['login-username','login-password'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin();});
});

// ── Register ──────────────────────────────────────────────────────────────────
async function handleRegister(){
  playSound('click');
  const u=document.getElementById('reg-username').value.trim();
  const p=document.getElementById('reg-password').value;
  const errEl=document.getElementById('auth-error');
  if(!u||!p){errEl.textContent='Please fill in all fields.';return;}
  const btn=document.getElementById('register-btn');
  btn.textContent='Creating…'; btn.disabled=true;
  const err=await doRegister(u,p,regPfp);
  btn.textContent='✨ Create Account'; btn.disabled=false;
  if(err){errEl.textContent=err;return;}
  errEl.textContent='';
  enterLobby();
}
document.getElementById('register-btn').addEventListener('click',handleRegister);
['reg-username','reg-password'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')handleRegister();});
});

// ── Guest ─────────────────────────────────────────────────────────────────────
document.getElementById('guest-btn').addEventListener('click',()=>{
  playSound('click');
  myName='Guest'+Math.floor(1000+Math.random()*9000);
  myToken=null; myPfp=null;
  enterLobby();
});

// ── Auto-login (no flash — skip animation for instant transition) ─────────────
if(myToken&&myName){
  // Disable the overlay transition so there's no visible flash on load
  const authEl=document.getElementById('auth-overlay');
  authEl.style.transition='none';
  authEl.style.opacity='0';
  authEl.style.pointerEvents='none';
  // Restore transition after a tick so future .active changes animate normally
  requestAnimationFrame(()=>{ authEl.style.transition=''; });
  enterLobby();
}

function enterLobby() {
  inGame=false;
  document.getElementById('lobby-my-name').textContent=myName;
  const pfpEl=document.getElementById('lobby-my-pfp');
  pfpEl.innerHTML=myPfp?`<img src="${myPfp}" alt="pfp">`:'🎮';
  if(!socket.connected){
    socket.connect();
    // 'connect' event will call showRoomPicker
  } else {
    showRoomPicker();
  }
}

// ─── Room Picker ─────────────────────────────────────────────────────────────
function showRoomPicker() {
  document.getElementById('rp-error').textContent='';
  document.getElementById('rp-code-input').value='';
  document.getElementById('room-picker-overlay').classList.add('active');
}
function hideRoomPicker() {
  document.getElementById('room-picker-overlay').classList.remove('active');
  setOverlay('lobby-overlay');
}
document.getElementById('rp-public-btn').addEventListener('click', () => {
  playSound('click');
  document.getElementById('rp-error').textContent='';
  socket.emit('requestRoom',{playerName:myName,token:myToken,pfp:myPfp});
  hideRoomPicker();
});
document.getElementById('rp-join-btn').addEventListener('click', () => {
  playSound('click');
  const code = document.getElementById('rp-code-input').value.trim().toUpperCase();
  if(code.length!==8){document.getElementById('rp-error').textContent='Code must be 8 characters!';return;}
  socket.emit('joinRoomByCode',{code,playerName:myName,token:myToken,pfp:myPfp});
});
document.getElementById('rp-create-btn').addEventListener('click', () => {
  playSound('click');
  socket.emit('createPrivateRoom',{playerName:myName,token:myToken,pfp:myPfp});
  hideRoomPicker();
});
document.getElementById('rp-code-input').addEventListener('keydown', e => {
  if(e.key==='Enter') document.getElementById('rp-join-btn').click();
});
document.getElementById('switch-room-btn').addEventListener('click', () => {
  playSound('click'); showRoomPicker();
});
socket.on('roomJoinError', msg => {
  document.getElementById('rp-error').textContent = msg;
});

// ═══════════════════════════════════════════
// LOBBY CONTROLS
// ═══════════════════════════════════════════
document.getElementById('change-pfp-btn').addEventListener('click',()=>document.getElementById('change-pfp-file').click());
setupPfpInput(document.getElementById('change-pfp-file'),null,async d=>{
  await savePfp(d); document.getElementById('lobby-my-pfp').innerHTML=`<img src="${d}">`;
});
document.getElementById('scores-from-lobby-btn').addEventListener('click',showScoreboard);
document.getElementById('scoreboard-btn').addEventListener('click',showScoreboard);
document.getElementById('scoreboard-close').addEventListener('click',()=>{playSound('click');closeModal();});
document.getElementById('start-btn').addEventListener('click',()=>{playSound('click');socket.emit('hostStartGame',room);});

// ─── Play Again / Leave ───────────────────────────────────────────────────────
function doRejoin(sameRoom=false) {
  playSound('click');
  const oldRoom=room;
  hand=[]; cardOnBoard=null; boardChosenColor=null; isTurn=false; inGame=false;
  currentPlayers=[]; cardCounts.clear(); unoPlayers.clear(); currentTurnId=null;
  pendingWild=null;
  leaveVC();
  hideUndoBtn();
  catchablePlayers.clear(); updateUnoCatchBar();
  clearInterval(dazzleInterval);
  dazzleInterval=setInterval(spawnDazzle,260);
  document.getElementById('win-overlay').classList.remove('active');
  if(sameRoom&&oldRoom){
    socket.emit('rejoinRoom',{code:oldRoom});
    setOverlay('lobby-overlay');
  } else {
    socket.emit('rejoinLobby');
    setOverlay('lobby-overlay');
    showRoomPicker();
  }
}
document.getElementById('play-again-btn').addEventListener('click',()=>doRejoin(true));
document.getElementById('leave-btn').addEventListener('click',()=>{
  playSound('click');
  hand=[]; cardOnBoard=null; boardChosenColor=null; isTurn=false; inGame=false;
  currentPlayers=[]; cardCounts.clear(); unoPlayers.clear(); currentTurnId=null;
  catchablePlayers.clear(); updateUnoCatchBar(); hideUndoBtn(); pendingWild=null;
  leaveVC();
  clearInterval(dazzleInterval); dazzleInterval=setInterval(spawnDazzle,260);
  setOverlay('auth-overlay');
  socket.disconnect();
  localStorage.clear();
  myToken=null; myName=''; myPfp=null;
});
document.getElementById('hud-leave-btn').addEventListener('click',()=>{
  if(confirm('Leave the game? You will forfeit.')){
    playSound('click');
    if(inGame) socket.emit('leaveGame');
    hand=[]; cardOnBoard=null; boardChosenColor=null; isTurn=false; inGame=false;
    currentPlayers=[]; cardCounts.clear(); unoPlayers.clear(); currentTurnId=null;
    catchablePlayers.clear(); updateUnoCatchBar(); hideUndoBtn(); pendingWild=null;
    leaveVC();
    clearInterval(dazzleInterval); dazzleInterval=setInterval(spawnDazzle,260);
    setOverlay('auth-overlay');
    socket.disconnect();
    localStorage.clear();
    myToken=null; myName=''; myPfp=null;
  }
});

// ═══════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════
socket.on('connect',()=>{
  showRoomPicker();
});
socket.on('assignedRoom',name=>{
  room=name;
  document.getElementById('lobby-room-name').textContent='Game Lobby';
  const codeEl=document.getElementById('lobby-room-code');
  if(codeEl){ codeEl.textContent=name; codeEl.title='Click to copy: '+name; }
  document.getElementById('hud-room-name').textContent=name;
  document.getElementById('pp-room-name').textContent=name;
  document.getElementById('room-picker-overlay').classList.remove('active');
  setOverlay('lobby-overlay');
});
socket.on('lobbyUpdate',state=>{
  room=state.room;
  document.getElementById('lobby-count').textContent=`${state.count}/${state.maxPeople}`;
  document.getElementById('player-list').innerHTML=state.players.map((p,i)=>`
    <div class="player-item" style="animation-delay:${i*.05}s">
      <div class="p-pfp">${p.pfp?`<img src="${p.pfp}">`:'🎮'}</div>
      <div class="p-name">${esc(p.name)}</div>
      ${p.isHost?'<div class="host-badge">HOST</div>':''}
    </div>`).join('');
  const isHost=state.hostId===socket.id;
  const startBtn=document.getElementById('start-btn');
  const waitMsg=document.getElementById('waiting-msg');
  const hint=document.getElementById('start-hint');
  if(isHost){
    startBtn.style.display=state.canStart?'':'none';
    waitMsg.style.display=state.canStart?'none':'';
    document.getElementById('waiting-text').textContent='Waiting for more players…';
    hint.textContent=state.canStart?'You are host — start when ready!':'Need at least 2 players';
  } else {
    startBtn.style.display='none'; waitMsg.style.display='';
    document.getElementById('waiting-text').textContent=state.canStart?'Waiting for host to start…':'Waiting for more players…';
    hint.textContent='';
  }
});
socket.on('responseRoom',v=>{ if(v==='error') showNotify('All rooms full!','error'); });

socket.on('gameStarted',({cardOnBoard:c,chosenColor:cc,turnId,players})=>{
  cardOnBoard=c; boardChosenColor=cc; currentPlayers=players; currentTurnId=turnId; inGame=true;
  isTurn=turnId===socket.id;
  cardCounts.clear(); unoPlayers.clear();
  players.forEach(p=>cardCounts.set(p.id,7));
  playSound('start'); stopDazzle();
  setOverlay(null); renderGame(); updatePlayerPanel();
  if(isTurn){showTurnBanner();playSound('turn');}
  document.getElementById('chat-messages').innerHTML='';
  chatUnread=0; updateChatBadge();
});
socket.on('haveCard',nums=>{
  hand=nums; renderGame();
  document.getElementById('uno-btn').style.display=hand.length===1?'':'none';
});
socket.on('cardCounts',counts=>{
  counts.forEach(({id,count})=>cardCounts.set(id,count));
  updatePlayerPanel();
});
socket.on('sendCard',({card,chosenColor})=>{
  cardOnBoard=card; boardChosenColor=chosenColor||null;
  const type=cardType(card);
  if(type==='Draw4') playSound('draw4');
  else if(type==='Skip') playSound('skip');
  else if(type==='Reverse') playSound('reverse');
  else playSound('play');
  renderGame();
});
socket.on('turnPlayer',id=>{
  currentTurnId=id; isTurn=id===socket.id;
  document.getElementById('turn-banner').style.display='none';
  if(isTurn){showTurnBanner();playSound('turn');}
  else hideUndoBtn(); // hide undo when it's no longer our turn
  updatePlayerPanel(); renderGame();
});
socket.on('playerDrew',({name})=>{showNotify(`${name} drew a card 🃏`,'info');playSound('draw');});
// unoAlert handled above
// unoShout handled above
socket.on('notify',({msg,type})=>showNotify(msg,type));
socket.on('playerLeft',({players,cardOnBoard:c,chosenColor:cc})=>{
  currentPlayers=players; cardOnBoard=c; boardChosenColor=cc; renderGame(); updatePlayerPanel();
});
socket.on('gameOver',({winner,winnerId,points,byDisconnect})=>{
  const iWon=winnerId===socket.id;
  document.getElementById('win-title').textContent=iWon?'🎉 You Win!':`${esc(winner)} Wins!`;
  document.getElementById('win-points').textContent=byDisconnect?'Opponent disconnected':`+${points} points`;
  document.getElementById('win-crown').style.display=iWon?'block':'none';
  document.getElementById('win-overlay').classList.add('active');
  document.getElementById('turn-banner').style.display='none';
  inGame=false; leaveVC();
  hideUndoBtn(); catchablePlayers.clear(); updateUnoCatchBar(); pendingWild=null;
  if(iWon){playSound('win');spawnConfetti();}else playSound('click');
});
socket.on('playerDisconnect',()=>{ showNotify('A player disconnected','error'); });

// ─── Reaction from other players ─────────────────────────────────────────────
socket.on('reaction',({fromName,fromPfp,key,x,y})=>{
  playSound('rxn');
  spawnFloatingReaction(key,x,y,fromName,fromPfp);
  // Also add to chat
  appendChatReaction(fromName,fromPfp,key,false);
});

// ═══════════════════════════════════════════
// UNO BUTTON
// ═══════════════════════════════════════════
document.getElementById('uno-btn').addEventListener('click',()=>{
  playSound('uno'); socket.emit('callUno',room);
  document.getElementById('uno-btn').style.display='none';
});

// ═══════════════════════════════════════════
// CANVAS INTERACTIONS
// ═══════════════════════════════════════════
function onInteract(e) {
  // Only call preventDefault when the browser allows it (not during scroll)
  if(e.cancelable) e.preventDefault();
  if(!room||cardOnBoard===null) return;
  const{X,Y}=getCanvasCoords(e);
  const dx=570,dy=195,dw=cdW/2,dh=cdH/2;
  if(X>=dx&&X<=dx+dw&&Y>=dy&&Y<=dy+dh){
    if(!isTurn){showNotify("Not your turn!",'error');return;}
    playSound('draw'); socket.emit('drawCard',[1,room]); return;
  }
  const ci=getCardAtPos(X,Y);
  if(ci!==-1){
    const cn=hand[ci];
    if(!isTurn){showNotify("Not your turn!",'error');return;}
    if(!canPlay(cn)){showNotify("Can't play that!",'error');return;}
    if(cardColor(cn)==='black'){pendingWild=cn;showColorPicker();}
    else{playSound('play');socket.emit('playCard',[cn,room,null]);}
  }
}
canvas.addEventListener('click',onInteract);
// Use touchstart instead of touchend — fires before scroll starts so cancelable=true
// Also register touchend as passive-safe fallback
canvas.addEventListener('touchstart', onInteract, {passive:false});
canvas.addEventListener('mousemove',e=>{
  const{X,Y}=getCanvasCoords(e),prev=hoveredCard;
  hoveredCard=getCardAtPos(X,Y); if(hoveredCard!==prev) renderHand();
},{passive:true});
canvas.addEventListener('mouseleave',()=>{hoveredCard=-1;renderHand();},{passive:true});

function getCardLayout(){
  const n=hand.length; if(!n)return[];
  const totalW=Math.min(n*70,860),startX=(1000-totalW)/2,spacing=n>1?totalW/n:0;
  return hand.map((_,i)=>({x:startX+i*spacing,y:408,w:cdW/2,h:cdH/2}));
}
function getCardAtPos(X,Y){
  if(Y<395||Y>595)return -1;
  const layout=getCardLayout();
  for(let i=layout.length-1;i>=0;i--){
    const{x,w}=layout[i],nx=i<layout.length-1?layout[i+1].x:x+w;
    if(X>=x&&X<=nx)return i;
  }
  return -1;
}

// ═══════════════════════════════════════════
// COLOR PICKER
// ═══════════════════════════════════════════
function showColorPicker(){document.getElementById('color-picker-overlay').classList.add('active');}
document.querySelectorAll('.color-btn').forEach(btn=>btn.addEventListener('click',()=>{
  const color=btn.dataset.color;
  document.getElementById('color-picker-overlay').classList.remove('active');
  if(pendingWild!==null){playSound('play');socket.emit('playCard',[pendingWild,room,color]);pendingWild=null;showUndoBtn();}
}));

// ═══════════════════════════════════════════
// UNDO BUTTON (for wild/draw4 cards)
// ═══════════════════════════════════════════
let undoTimer=null;

function showUndoBtn(){
  clearTimeout(undoTimer);
  const btn=document.getElementById('undo-play-btn');
  if(!btn) return;
  btn.classList.add('show');
  undoTimer=setTimeout(hideUndoBtn,8000);
}

function hideUndoBtn(){
  clearTimeout(undoTimer);
  const btn=document.getElementById('undo-play-btn');
  if(btn) btn.classList.remove('show');
}

document.getElementById('undo-play-btn').addEventListener('click',()=>{
  playSound('click');
  socket.emit('undoPlay',room);
  hideUndoBtn();
});


// ═══════════════════════════════════════════
// UNO CATCH
// ═══════════════════════════════════════════
const catchablePlayers=new Map(); // playerId -> playerName

socket.on('unoAlert',({id,name})=>{
  unoPlayers.add(id); showNotify(`⚠️ ${name} has ONE card!`,'warning'); playSound('uno');
  if(id!==socket.id){
    // Allow catching for 5 seconds
    catchablePlayers.set(id,name);
    updatePlayerPanel();
    updateUnoCatchBar();
    setTimeout(()=>{catchablePlayers.delete(id);updateUnoCatchBar();},5000);
  }
  updatePlayerPanel();
  setTimeout(()=>{unoPlayers.delete(id);updatePlayerPanel();},8000);
});

function updateUnoCatchBar(){
  const bar=document.getElementById('uno-catch-bar');
  if(!bar) return;
  if(catchablePlayers.size===0||!inGame){
    bar.classList.remove('visible');
    bar.innerHTML='';
    return;
  }
  bar.classList.add('visible');
  bar.innerHTML=[...catchablePlayers.entries()].map(([id,name])=>`
    <button class="catch-btn" data-catch="${id}">
      🎯 Catch ${esc(name.substring(0,10))}!
    </button>`).join('');
  bar.querySelectorAll('[data-catch]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const targetId=btn.dataset.catch;
      playSound('click');
      socket.emit('catchUno',{roomName:room,targetId});
      catchablePlayers.delete(targetId);
      updateUnoCatchBar();
    });
  });
}

socket.on('unoCaught',({caughtId,caughtName,catcherName})=>{
  showNotify(`🎯 ${catcherName} caught ${caughtName}! +2 cards!`,'warning');
  catchablePlayers.delete(caughtId);
  updateUnoCatchBar();
});

// When a player calls UNO, remove from catchable
socket.on('unoShout',({id,name})=>{
  unoPlayers.add(id); showNotify(`🔥 ${name} shouts UNO!`,'warning');
  catchablePlayers.delete(id);
  updatePlayerPanel(); updateUnoCatchBar();
  setTimeout(()=>{unoPlayers.delete(id);updatePlayerPanel();},8000);
});

// ═══════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════
function renderGame(){
  ctx.clearRect(0,0,1000,600);
  drawBg(); drawDeck(); drawBoardCard(); drawOpponents(); renderHand();
}
function drawBg(){
  const g=ctx.createRadialGradient(500,300,30,500,300,620);
  g.addColorStop(0,'rgba(10,8,40,.52)'); g.addColorStop(1,'rgba(5,4,20,.85)');
  ctx.fillStyle=g; ctx.fillRect(0,0,1000,600);
}
function rrect(x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}
function drawBoardCard(){
  if(cardOnBoard===null)return;
  const x=410,y=195,w=cdW/2,h=cdH/2;
  const gc=boardChosenColor||cardColor(cardOnBoard);
  const glow={red:'#ff4757',yellow:'#ffd700',green:'#2ed573',blue:'#339af0',black:'#a855f7'}[gc]||'#fff';
  ctx.save(); ctx.shadowBlur=50; ctx.shadowColor=glow;
  ctx.drawImage(cards,1+cdW*(cardOnBoard%14),1+cdH*Math.floor(cardOnBoard/14),cdW,cdH,x,y,w,h);
  if(boardChosenColor&&cardColor(cardOnBoard)==='black'){
    ctx.shadowBlur=0; ctx.beginPath(); ctx.arc(x+w-10,y+10,9,0,Math.PI*2);
    ctx.fillStyle=glow; ctx.fill(); ctx.strokeStyle='rgba(255,255,255,.6)'; ctx.lineWidth=2; ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle='rgba(200,210,255,.55)'; ctx.font='700 11px "Exo 2"'; ctx.textAlign='center';
  ctx.fillText('BOARD',x+w/2,y-10);
}
function drawDeck(){
  const x=568,y=195,w=cdW/2,h=cdH/2;
  ctx.save(); ctx.shadowBlur=isTurn?42:16; ctx.shadowColor=isTurn?'rgba(0,217,255,.85)':'rgba(124,111,255,.5)';
  ctx.drawImage(back,0,0,back.naturalWidth||240,back.naturalHeight||360,x,y,w,h);
  ctx.restore();
  ctx.fillStyle='rgba(200,210,255,.55)'; ctx.font='700 11px "Exo 2"'; ctx.textAlign='center';
  ctx.fillText(isTurn?'▼ DRAW':'DECK',x+w/2,y-10);
  if(isTurn){ctx.fillStyle='rgba(0,217,255,.7)';ctx.font='600 10px "Exo 2"';ctx.fillText('CLICK TO DRAW',x+w/2,y+h+14);}
}
function drawOpponents(){
  const others=currentPlayers.filter(p=>p.id!==socket.id);
  if(!others.length)return;
  const spacing=Math.min(160,900/others.length),startX=(1000-spacing*others.length)/2+spacing/2;
  others.forEach((p,i)=>{
    const cx=startX+i*spacing,cy=75,isTheirTurn=p.id===currentTurnId;
    ctx.save();
    ctx.shadowBlur=isTheirTurn?20:8; ctx.shadowColor=isTheirTurn?'rgba(0,230,118,.7)':'rgba(124,111,255,.3)';
    ctx.drawImage(back,0,0,back.naturalWidth||240,back.naturalHeight||360,cx-22,cy-18,44,66);
    ctx.restore();
    ctx.fillStyle='rgba(8,8,40,.75)'; rrect(cx-44,cy+52,88,24,9); ctx.fill();
    ctx.fillStyle=isTheirTurn?'#00e676':'rgba(210,220,255,.88)';
    ctx.font='600 10.5px "Exo 2"'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(p.name.substring(0,12),cx,cy+64); ctx.textBaseline='alphabetic';
  });
}
function renderHand(){
  // Clear only hand area
  ctx.clearRect(0,388,1000,212);
  const layout=getCardLayout(); if(!layout.length) return;
  ctx.save();
  ctx.fillStyle='rgba(5,5,25,.3)';
  rrect(10,394,980,200,13); ctx.fill();
  ctx.strokeStyle='rgba(140,160,255,.09)'; ctx.lineWidth=1; ctx.stroke();
  ctx.restore();
  layout.forEach(({x,y,w,h},i)=>{
    const cn=hand[i], isHov=hoveredCard===i, isPlay=canPlay(cn);
    const liftY=isHov?y-22:y;
    ctx.save();
    if(isTurn&&isPlay){ ctx.shadowBlur=isHov?46:20; ctx.shadowColor=glowCol(cn); }
    else { ctx.globalAlpha=.6; }
    ctx.drawImage(cards,1+cdW*(cn%14),1+cdH*Math.floor(cn/14),cdW,cdH,x,liftY,w,h);
    if(isTurn&&isPlay&&!isHov){ ctx.globalAlpha=.08; ctx.fillStyle='#fff'; ctx.fillRect(x,liftY,w,h); }
    ctx.restore();
  });
  if(isTurn){
    ctx.fillStyle='rgba(0,217,255,.5)'; ctx.font='600 10px "Exo 2"';
    ctx.textAlign='center'; ctx.fillText('↑ YOUR CARDS — TAP TO PLAY',500,400);
  }
}

// ═══════════════════════════════════════════
// PLAYER PANEL
// ═══════════════════════════════════════════
function updatePlayerPanel(){
  const list=document.getElementById('pp-list');
  if(!currentPlayers.length){list.innerHTML='';return;}
  list.innerHTML=currentPlayers.map(p=>{
    const count=cardCounts.get(p.id)??'?';
    const isMyTurn=p.id===currentTurnId, hasUno=unoPlayers.has(p.id);
    const isSpeaking=vcSpeaking.has(p.id);
    return `
      <div class="pp-player ${isMyTurn?'is-turn':''}">
        <div class="pp-pfp">${p.pfp?`<img src="${p.pfp}">`:'🎮'}</div>
        <div class="pp-info">
          <div class="pp-name">${esc(p.name)}${p.id===socket.id?' <span style="font-size:.52rem;color:var(--accent2)">(you)</span>':''}</div>
          <div>
            <span class="pp-cards ${hasUno?'uno-alert':''}">🃏 ${count}</span>
            ${hasUno?'<span class="pp-uno-badge">UNO!</span>':''}
          </div>
        </div>
        ${isSpeaking?'<div class="pp-speaking"></div>':''}
        ${isMyTurn?'<div class="pp-turn-arrow">▶</div>':''}
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// REACTIONS (Ludo King style)
// ═══════════════════════════════════════════
document.querySelectorAll('.rxn-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if(rxnCooldown||!room){return;}
    const key=btn.dataset.key;
    if(!REACTIONS[key]) return;
    rxnCooldown=true;
    setTimeout(()=>rxnCooldown=false, 1500); // 1.5s cooldown
    playSound('rxn');
    // Show locally immediately
    const x=30+Math.random()*40, y=50+Math.random()*30;
    spawnFloatingReaction(key,x,y,myName,myPfp);
    appendChatReaction(myName,myPfp,key,true);
    // Broadcast to others
    socket.emit('reaction',{key,roomName:room,x,y});
  });
});

function spawnFloatingReaction(key,xPct,yPct,fromName,fromPfp){
  const rxn=REACTIONS[key]; if(!rxn) return;
  const wrap=document.getElementById('floating-reactions');
  const el=document.createElement('div');
  el.className='float-reaction';
  el.style.left=`${xPct}%`;
  el.style.top=`${yPct}%`;
  // Name tag above the GIF
  el.innerHTML=`
    <div style="text-align:center;margin-bottom:4px;">
      <span style="background:rgba(0,0,0,.6);border-radius:8px;padding:2px 7px;font-size:.65rem;font-family:'Exo 2',sans-serif;color:#fff;">${esc(fromName)}</span>
    </div>
    <img src="${rxn.url}" alt="${key}" loading="lazy">
  `;
  wrap.appendChild(el);
  setTimeout(()=>el.remove(), 2900);
}

function appendChatReaction(fromName,fromPfp,key,isMine){
  const rxn=REACTIONS[key]; if(!rxn) return;
  const pfpHtml=fromPfp?`<img src="${fromPfp}">`:'💬';
  const el=document.getElementById('chat-messages');
  el.innerHTML+=`
    <div class="chat-msg ${isMine?'mine':''}">
      <div class="chat-msg-pfp">${pfpHtml}</div>
      <div class="chat-msg-bubble">
        ${!isMine?`<div class="chat-msg-name">${esc(fromName)}</div>`:''}
        <img src="${rxn.url}" class="chat-msg-gif" alt="${key}" loading="lazy">
      </div>
    </div>`;
  scrollChat();
  if(!chatOpen&&!isMine){chatUnread++;updateChatBadge();playSound('chat');}
}

// ═══════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════
document.getElementById('chat-toggle').addEventListener('click',()=>{
  playSound('click'); chatOpen=!chatOpen;
  document.getElementById('chat-body').classList.toggle('open',chatOpen);
  document.getElementById('chat-chevron').classList.toggle('open',chatOpen);
  if(chatOpen){chatUnread=0;updateChatBadge();scrollChat();}
});
document.getElementById('chat-send').addEventListener('click',sendChatMsg);
document.getElementById('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter')sendChatMsg();});

function sendChatMsg(){
  const input=document.getElementById('chat-input');
  const msg=input.value.trim(); if(!msg||!room)return;
  socket.emit('chat',{msg,roomName:room}); input.value='';
}
function updateChatBadge(){
  const badge=document.getElementById('chat-unread');
  badge.style.display=(!chatOpen&&chatUnread>0)?'flex':'none';
  badge.textContent=chatUnread;
}
function scrollChat(){
  const el=document.getElementById('chat-messages');
  setTimeout(()=>el.scrollTop=el.scrollHeight,50);
}
socket.on('chat',({id,name,pfp,msg})=>{
  const isMine=id===socket.id;
  const pfpHtml=pfp?`<img src="${pfp}">`:'💬';
  document.getElementById('chat-messages').innerHTML+=`
    <div class="chat-msg ${isMine?'mine':''}">
      <div class="chat-msg-pfp">${pfpHtml}</div>
      <div class="chat-msg-bubble">
        ${!isMine?`<div class="chat-msg-name">${esc(name)}</div>`:''}
        <div class="chat-msg-text">${esc(msg)}</div>
      </div>
    </div>`;
  scrollChat();
  if(!chatOpen&&!isMine){chatUnread++;updateChatBadge();playSound('chat');}
});

// ═══════════════════════════════════════════
// VOICE CHAT (WebRTC)
// ═══════════════════════════════════════════
const peers={};
let localStream=null, vcActive=false, vcMuted=false;
const vcSpeaking=new Set(), vcInRoom=new Map();

async function joinVC(){
  if(vcActive)return;
  try{
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    vcActive=true; startSpeakingDetection();
    socket.emit('vc-join',room);
    vcInRoom.set(socket.id,{name:myName,pfp:myPfp});
    updateVcBar(); document.getElementById('vc-btn').textContent='🔴 VC';
    showNotify('Joined voice chat 🎙️','success');
  }catch{ showNotify('Mic access denied!','error'); }
}
function leaveVC(){
  if(!vcActive)return;
  Object.values(peers).forEach(pc=>pc.close()); for(const k in peers) delete peers[k];
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  vcActive=false; vcMuted=false; vcInRoom.clear(); vcSpeaking.clear();
  if(room) socket.emit('vc-leave',room);
  updateVcBar(); document.getElementById('vc-btn').textContent='🎙️ VC';
  document.getElementById('vc-bar').style.display='none';
}
function muteVC(){
  if(!localStream)return; vcMuted=!vcMuted;
  localStream.getAudioTracks().forEach(t=>t.enabled=!vcMuted);
  document.getElementById('vc-mute-btn').textContent=vcMuted?'🔇 Unmute':'🎙️ Mute';
}
function updateVcBar(){
  const bar=document.getElementById('vc-bar');
  if(!vcActive&&vcInRoom.size===0){bar.style.display='none';return;}
  bar.style.display='flex';
  document.getElementById('vc-users-row').innerHTML=[...vcInRoom.entries()].map(([id,u])=>`
    <div class="vc-user-chip ${vcSpeaking.has(id)?'speaking':''}">
      <div class="vc-pfp">${u.pfp?`<img src="${u.pfp}">`:'🎙️'}</div>
      <span>${esc(u.name.substring(0,8))}</span>
    </div>`).join('');
}
function createPeer(peerId){
  if(peers[peerId])return peers[peerId];
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
  peers[peerId]=pc;
  pc.onicecandidate=e=>{if(e.candidate)socket.emit('vc-ice',{to:peerId,candidate:e.candidate});};
  pc.ontrack=e=>{const a=new Audio();a.srcObject=e.streams[0];a.autoplay=true;a.play().catch(()=>{});};
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  return pc;
}
socket.on('vc-user-joined',async({id,name})=>{
  const p=currentPlayers.find(pl=>pl.id===id);
  vcInRoom.set(id,{name,pfp:p?.pfp||null}); updateVcBar(); updatePlayerPanel();
  if(!vcActive)return;
  const pc=createPeer(id);
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
  socket.emit('vc-offer',{to:id,offer});
});
socket.on('vc-user-left',({id})=>{
  if(peers[id]){peers[id].close();delete peers[id];}
  vcInRoom.delete(id); vcSpeaking.delete(id); updateVcBar(); updatePlayerPanel();
});
socket.on('vc-offer',async({from,offer})=>{
  if(!vcActive)return;
  const pc=createPeer(from); await pc.setRemoteDescription(offer);
  const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
  socket.emit('vc-answer',{to:from,answer});
});
socket.on('vc-answer',async({from,answer})=>{await peers[from]?.setRemoteDescription(answer);});
socket.on('vc-ice',async({from,candidate})=>{try{await peers[from]?.addIceCandidate(candidate);}catch{}});
socket.on('vc-speaking',({id,speaking})=>{
  speaking?vcSpeaking.add(id):vcSpeaking.delete(id); updateVcBar(); updatePlayerPanel();
});
function startSpeakingDetection(){
  if(!localStream||!actx)return;
  try{
    const analyser=actx.createAnalyser(),source=actx.createMediaStreamSource(localStream);
    source.connect(analyser); analyser.fftSize=512;
    const data=new Uint8Array(analyser.frequencyBinCount); let wasSpeaking=false;
    setInterval(()=>{
      analyser.getByteFrequencyData(data);
      const avg=data.reduce((a,b)=>a+b,0)/data.length, isSpeaking=avg>12;
      if(isSpeaking!==wasSpeaking){
        wasSpeaking=isSpeaking; socket.emit('vc-speaking',{roomName:room,speaking:isSpeaking});
        isSpeaking?vcSpeaking.add(socket.id):vcSpeaking.delete(socket.id); updateVcBar();
      }
    },200);
  }catch{}
}
document.getElementById('vc-btn').addEventListener('click',()=>{initAudio();vcActive?leaveVC():joinVC();});
document.getElementById('vc-mute-btn').addEventListener('click',muteVC);
document.getElementById('vc-leave-btn').addEventListener('click',leaveVC);

// ═══════════════════════════════════════════
// HUD HELPERS
// ═══════════════════════════════════════════
function showTurnBanner(){
  const b=document.getElementById('turn-banner');
  b.style.display=''; b.style.animation='none'; void b.offsetWidth; b.style.animation='';
  setTimeout(()=>b.style.display='none',3000);
}
function showNotify(msg,type='info'){
  const el=document.getElementById('notify-banner');
  if(notifyTimer)clearTimeout(notifyTimer);
  el.className=`notify-banner ${type} show`; el.textContent=msg;
  notifyTimer=setTimeout(()=>el.classList.remove('show'),3400);
}

// ═══════════════════════════════════════════
// CONFETTI
// ═══════════════════════════════════════════
function spawnConfetti(){
  const wrap=document.getElementById('confetti-wrap'); wrap.innerHTML='';
  const colors=['#ff4757','#ffd700','#2ed573','#339af0','#a855f7','#00d9ff','#ff6b9d','#fff'];
  for(let i=0;i<80;i++){
    const p=document.createElement('div'); p.className='confetti-piece';
    const sz=5+Math.random()*9;
    p.style.cssText=`left:${10+Math.random()*80}%;top:${-10+Math.random()*20}%;background:${colors[Math.floor(Math.random()*colors.length)]};width:${sz}px;height:${sz*(.5+Math.random()*.8)}px;border-radius:${Math.random()>.5?'50%':'2px'};--mid-y:${100+Math.random()*80}px;--end-y:${220+Math.random()*80}px;animation-duration:${1.4+Math.random()*1.8}s;animation-delay:${Math.random()*.9}s;transform:rotate(${Math.random()*360}deg);`;
    wrap.appendChild(p);
  }
  ['🎉','🎊','✨','🎆'].forEach((emoji,i)=>{
    const p=document.createElement('div'); p.className='party-popper'; p.textContent=emoji;
    Object.assign(p.style,[{left:'5%',top:'10%'},{right:'5%',top:'10%'},{left:'5%',bottom:'10%'},{right:'5%',bottom:'10%'}][i],{animationDelay:`${i*.15}s`});
    wrap.appendChild(p);
    setTimeout(()=>{p.style.animation='none';void p.offsetWidth;p.style.animation='popper-pop .6s cubic-bezier(.34,1.56,.64,1) both';},800+i*200);
  });
}

// ═══════════════════════════════════════════
// IMAGE LOADS + KEYBOARD
// ═══════════════════════════════════════════
cards.onload=()=>{if(cardOnBoard!==null)renderGame();};
back.onload=()=>{if(cardOnBoard!==null)renderGame();};

document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
  if((e.key==='u'||e.key==='U')&&hand.length===1&&isTurn){playSound('uno');socket.emit('callUno',room);}
});

// Click room code to copy
document.getElementById('lobby-room-code').addEventListener('click',()=>{
  if(!room) return;
  navigator.clipboard.writeText(room).then(()=>{
    const el=document.getElementById('lobby-room-code');
    const orig=el.textContent; el.textContent='Copied!';
    setTimeout(()=>el.textContent=orig,1500);
  }).catch(()=>{});
});