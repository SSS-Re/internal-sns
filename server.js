const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = 3000;

const db = new Database('sns.db');

// ログイン認証チェック用ミドルウェア
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// セッション設定
app.use(session({
  secret: 'secret-key-alh-sns',
  resave: false,
  saveUninitialized: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// DBテーブル初期化
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// メインページ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// チャンネル別 タイムライン取得（HTMX用）
app.get('/posts', (req, res) => {
  // クエリパラメータからチャンネルを取得（指定がなければ General）
  const channel = req.query.channel || 'General';
  
  const stmt = db.prepare('SELECT * FROM posts WHERE channel = ? ORDER BY id DESC');
  const posts = stmt.all(channel);
  
  res.send(renderFeedHtml(posts));
});

// 投稿機能（ログイン中のusernameを適用）
app.post('/posts', requireAuth, (req, res) => {
  const { channel, content } = req.body;
  const username = req.session.user.username;
  
  if (content.trim()) {
    const stmt = db.prepare('INSERT INTO posts (channel, username, content) VALUES (?, ?, ?)');
    stmt.run(channel, username, content);
  }
  
  // タイムラインの再読み込みレスポンス（既存処理）
  const posts = db.prepare('SELECT * FROM posts WHERE channel = ? ORDER BY id DESC').all(channel);
  res.send(renderTimeline(posts));
});

// いいね機能
app.post('/posts/:id/like', (req, res) => {
  const postId = parseInt(req.params.id);
  const updateStmt = db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?');
  const result = updateStmt.run(postId);

  if (result.changes > 0) {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
    res.send(`
      <button 
        hx-post="/posts/${post.id}/like" 
        hx-target="this" 
        hx-swap="outerHTML"
        style="background-color: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid #38bdf8; padding: 5px 12px; border-radius: 20px; font-size: 0.8rem; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
        👍 いいね <span>${post.likes}</span>
      </button>
    `);
  } else {
    res.status(404).send('');
  }
});

// 投稿削除機能
app.delete('/posts/:id', (req, res) => {
  const postId = parseInt(req.params.id);
  const stmt = db.prepare('DELETE FROM posts WHERE id = ?');
  stmt.run(postId);
  res.status(200).send('');
});

// URLを検出して target="_blank" 付きの <a> タグに変換するヘルパー関数
function formatContent(str) {
  // 1. まずHTML特殊文字をエスケープ（XSS対策）
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 2. URLを検出して別タブで開く <a> タグへ変換
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return escaped.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: underline;">${url}</a>`;
  });
}

// HTMLレンダリングヘルパー
function renderFeedHtml(postsList) {
  const templatePath = path.join(__dirname, 'views', 'feed.html');
  const template = fs.readFileSync(templatePath, 'utf8');

  if (postsList.length === 0) {
    return `<p style="color: #64748b; text-align: center; padding: 20px 0;">このチャンネルにはまだ投稿がありません。</p>`;
  }

  return postsList.map(post => {
    const timeStr = new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // エスケープ処理（USER名）
    const safeUser = post.user.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return template
      .replace(/{{ID}}/g, post.id)
      .replace('{{USER}}', safeUser)
      .replace('{{CREATED_AT}}', timeStr)
      .replace('{{CONTENT}}', formatContent(post.content)) // 改行＋URLリンク化を適用
      .replace('{{LIKES}}', post.likes);
  }).join('');
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// メイン画面（ログイン必須）
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// ログイン画面
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// アカウント新規登録
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    stmt.run(username, password);
    res.send('<p style="color: #4ade80;">アカウント作成成功！<a href="/login">ログイン画面へ</a></p>');
  } catch (err) {
    res.send('<p style="color: #f87171;">そのユーザー名は既に使用されています。</p>');
  }
});

// ログイン処理
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
  
  if (user) {
    req.session.user = { id: user.id, username: user.username };
    res.redirect('/');
  } else {
    res.send('<p style="color: #f87171;">ユーザー名またはパスワードが正しくありません。<a href="/login">戻る</a></p>');
  }
});

// ログアウト処理
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});