<div align="center">

```
██╗     ██╗   ██╗███╗   ██╗ ██████╗ 
██║     ██║   ██║████╗  ██║██╔═══██╗
██║     ██║   ██║██╔██╗ ██║██║   ██║
██║     ██║   ██║██║╚██╗██║██║   ██║
███████╗╚██████╔╝██║ ╚████║╚██████╔╝
╚══════╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ 
```

### ✦ Multiplayer UNO · Glass Edition ✦

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-2.5-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Optional-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-a855f7?style=for-the-badge)

<br>

> 🃏 **Real-time multiplayer UNO** — play with up to 10 friends in a room, with a glassmorphism UI, voice chat, reactions, and a live leaderboard.

</div>

---

## ✨ Features

- 🎮 **Up to 10 players** per room — auto room assignment
- 🔐 **Auth system** — register/login with profile pictures, or jump in as a Guest
- 🏆 **Live leaderboard** — win/loss tracking with win rate
- 💬 **In-game chat** — with animated GIF reactions
- 🎙️ **Voice chat** — WebRTC peer-to-peer audio
- 🌈 **Full UNO rules** — Skip, Reverse, Draw 2, Wild, Wild Draw 4
- 📱 **Mobile friendly** — touch support for phones and tablets
- 💾 **MongoDB or local file storage** — works with or without a database
- ✨ **Glass UI** — animated star background, glowing cards, confetti win screen

---

## 🚀 Getting Started

### 1. Clone the repo
```bash
git clone https://github.com/liravoss/Lunogame.git
cd Lunogame
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment (optional — for MongoDB)

Create a `.env` file in the root:
```env
MONGO_URL=mongodb+srv://youruser:yourpass@cluster.mongodb.net/luno
```

> Without `MONGO_URL`, the game uses local JSON file storage automatically.

### 4. Run the server
```bash
node server.js
```

Open your browser at **http://localhost:3000** 🎉

---

## 🗂️ Project Structure

```
Lunogame/
├── server.js        # Game server — Socket.io, REST API, room logic
├── main.js          # Client — canvas rendering, socket events, UI
├── index.html       # App shell
├── style.css        # Glassmorphism styles
├── data/            # Local user storage (auto-created, no MongoDB needed)
│   └── users.json
└── public/
    └── images/
        ├── deck.svg     # UNO card sprite sheet
        ├── uno.svg      # Card back
        └── mascot.png   # LUNO mascot
```

---

## 🌐 Deploying for Free (24/7)

| Service | Purpose | Free? |
|---|---|---|
| [Render](https://render.com) | Host the Node.js server | ✅ |
| [MongoDB Atlas](https://mongodb.com/atlas) | Database | ✅ 512MB |
| [UptimeRobot](https://uptimerobot.com) | Keep server alive | ✅ |

### Deploy to Render
1. Push code to GitHub
2. Go to Render → **New Web Service** → connect repo
3. Set **Build Command:** `npm install`
4. Set **Start Command:** `node server.js`
5. Add environment variable: `MONGO_URL = your_atlas_url`
6. Deploy ✅

Your game will be live at `https://your-app.onrender.com`

---

## 🎮 How to Play

1. **Register** or play as a **Guest**
2. You'll be auto-assigned to a room (up to 10 players)
3. The **host** starts the game when ready
4. Match the **color** or **number** of the top card
5. Can't play? **Draw a card** from the deck
6. Get down to **1 card?** Hit the **UNO** button!
7. First to empty their hand **wins** 🏆

---

## 🛠️ Tech Stack

- **Backend** — Node.js, Express, Socket.io
- **Frontend** — Vanilla JS, HTML5 Canvas
- **Database** — MongoDB (via Mongoose) or JSON file fallback
- **Voice Chat** — WebRTC (peer-to-peer)
- **Auth** — SHA-256 hashed passwords, session tokens
- **Fonts** — Exo 2, Orbitron (Google Fonts)

---

## 📜 License

MIT — feel free to fork, mod and host your own!

---

<div align="center">

Made with ❤️ · **LUNO** — Glass Edition

</div>