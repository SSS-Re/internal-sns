const express = require('express');
const Database = require('better-sqlite3');
const session = require('express-session');
const path = require('path');

const app = express();
const db = new Database('sns.db');

// EJSテンプレートエンジンの設定
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

// ミドルウェア設定
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

// タイムライン描画用ヘルパー関数
function renderTimeline(posts) {
  if (posts.length === 0) {
    return '<p style="color: #64748b; text-align: center;">まだ投稿がありません。</p>';
  }

  return posts.map(post => {
    // 改行とURLのハイパーリンク化処理
    const formattedContent = post.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #38bdf8;">$1</a>')
      .replace(/\n/g, '<br>');

    return `
      <div class="post" id="post-${post.id}">
        <div class="post-header">
          <span class="post-user">${post.username}</span>
          <span>${post.created_at}</span>
          <button style="background:none; border:none; color:#f87171; cursor:pointer;" 
                  hx-delete="/posts/${post.id}" 
                  hx-target="#post-${post.id}" 
                  hx-swap="outerHTML">削除</button>
        </div>
        <div style="margin-bottom: 8px;">${formattedContent}</div>
        <button style="background:#334155; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;"
                hx-post="/posts/${post.id}/like" 
                hx-target="#post-${post.id}" 
                hx-swap="outerHTML">👍 いいね ${post.likes}</button>
      </div>
    `;
  }).join('');
}

// 認証チェックミドルウェア
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// --- ルーティング ---

// メイン画面
app.get('/', requireAuth, (req, res) => {
  res.render(path.join(__dirname, 'views', 'index.html'), {
    user: req.session.user
  });
});

// ログイン画面
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// 新規登録
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    stmt.run(username, password);
    res.send('<p style="color: #4ade80;">アカウント作成成功！ <a href="/login" style="color: #38bdf8;">ログイン画面へ</a></p>');
  } catch (err) {
    res.send('<p style="color: #f87171;">そのユーザー名は既に使用されています。</p>');
  }
});

// ログイン
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
  
  if (user) {
    req.session.user = { id: user.id, username: user.username };
    res.redirect('/');
  } else {
    res.send('<p style="color: #f87171;">ユーザー名またはパスワードが違います。<a href="/login" style="color: #38bdf8;">戻る</a></p>');
  }
});

// ログアウト
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// タイムライン取得
app.get('/timeline', requireAuth, (req, res) => {
  const channel = req.query.channel || 'General';
  const posts = db.prepare('SELECT * FROM posts WHERE channel = ? ORDER BY id DESC').all(channel);
  res.send(renderTimeline(posts));
});

// 投稿作成
app.post('/posts', requireAuth, (req, res) => {
  const { channel, content } = req.body;
  const username = req.session.user.username;
  
  if (content && content.trim()) {
    const stmt = db.prepare('INSERT INTO posts (channel, username, content) VALUES (?, ?, ?)');
    stmt.run(channel, username, content);
  }
  
  const posts = db.prepare('SELECT * FROM posts WHERE channel = ? ORDER BY id DESC').all(channel);
  res.send(renderTimeline(posts));
});

// いいね機能
app.post('/posts/:id/like', requireAuth, (req, res) => {
  const postId = req.params.id;
  db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(postId);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  
  res.send(renderTimeline([post]));
});

// 削除機能
app.delete('/posts/:id', requireAuth, (req, res) => {
  const postId = req.params.id;
  db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
  res.send('');
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});