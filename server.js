const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// --- データベース接続設定 ---
// DATABASE_URL（Render）が存在する場合はPostgreSQL、なければローカル用SQLite（better-sqlite3）を使用
let dbHandler;

if (process.env.DATABASE_URL) {
  // 【Render環境】PostgreSQLを使用
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  dbHandler = {
    query: (text, params) => pool.query(text, params)
  };
} else {
  // 【PCローカル環境】SQLiteを使用
  const Database = require('better-sqlite3');
  const sqlite = new Database('sns.db');
  
  dbHandler = {
    query: async (text, params = []) => {
      // PostgreSQLの $1, $2 プレースホルダーを SQLite用の ? に変換
      let sql = text.replace(/\$\d+/g, '?');
      
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const rows = sqlite.prepare(sql).all(...params);
        return { rows };
      } else {
        const info = sqlite.prepare(sql).run(...params);
        return { rows: [], rowCount: info.changes };
      }
    }
  };
}

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

// DBテーブル初期化関数
async function initDB() {
  try {
    if (process.env.DATABASE_URL) {
      // PostgreSQL用テーブル作成
      await dbHandler.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL
        );
        CREATE TABLE IF NOT EXISTS posts (
          id SERIAL PRIMARY KEY,
          channel VARCHAR(255) NOT NULL,
          username VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          likes INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else {
      // SQLite用テーブル作成
      await dbHandler.query(`
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
    }
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}
initDB();

// タイムライン描画用ヘルパー関数
function renderTimeline(posts) {
  if (!posts || posts.length === 0) {
    return '<p style="color: #64748b; text-align: center;">このチャンネルにはまだ投稿がありません。</p>';
  }

  return posts.map(post => {
    const formattedContent = post.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #38bdf8;">$1</a>')
      .replace(/\n/g, '<br>');

    const formattedTime = new Date(post.created_at).toLocaleString('ja-JP');

    return `
      <div class="post" id="post-${post.id}">
        <div class="post-header">
          <span class="post-user">${post.username}</span>
          <span>${formattedTime}</span>
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
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    await dbHandler.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
    res.send('<p style="color: #4ade80;">アカウント作成成功！ <a href="/login" style="color: #38bdf8;">ログイン画面へ</a></p>');
  } catch (err) {
    res.send('<p style="color: #f87171;">そのユーザー名は既に使用されています。</p>');
  }
});

// ログイン
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await dbHandler.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    const user = result.rows[0];
    
    if (user) {
      req.session.user = { id: user.id, username: user.username };
      res.redirect('/');
    } else {
      res.send('<p style="color: #f87171;">ユーザー名またはパスワードが違います。<a href="/login" style="color: #38bdf8;">戻る</a></p>');
    }
  } catch (err) {
    res.send('<p style="color: #f87171;">エラーが発生しました。</p>');
  }
});

// ログアウト
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// タイムライン取得
app.get('/timeline', requireAuth, async (req, res) => {
  const channel = req.query.channel || 'General';
  try {
    const result = await dbHandler.query('SELECT * FROM posts WHERE channel = $1 ORDER BY id DESC', [channel]);
    res.send(renderTimeline(result.rows));
  } catch (err) {
    res.send('<p style="color: #f87171;">読み込みエラーが発生しました。</p>');
  }
});

// 投稿作成
app.post('/posts', requireAuth, async (req, res) => {
  const { channel, content } = req.body;
  const username = req.session.user.username;
  
  if (content && content.trim()) {
    await dbHandler.query('INSERT INTO posts (channel, username, content) VALUES ($1, $2, $3)', [channel, username, content]);
  }
  
  const result = await dbHandler.query('SELECT * FROM posts WHERE channel = $1 ORDER BY id DESC', [channel]);
  res.send(renderTimeline(result.rows));
});

// いいね機能
app.post('/posts/:id/like', requireAuth, async (req, res) => {
  const postId = req.params.id;
  await dbHandler.query('UPDATE posts SET likes = likes + 1 WHERE id = $1', [postId]);
  const result = await dbHandler.query('SELECT * FROM posts WHERE id = $1', [postId]);
  res.send(renderTimeline(result.rows));
});

// 削除機能
app.delete('/posts/:id', requireAuth, async (req, res) => {
  const postId = req.params.id;
  await dbHandler.query('DELETE FROM posts WHERE id = $1', [postId]);
  res.send('');
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});