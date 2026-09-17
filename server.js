const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

const db = new Database('sns.db');

// テーブル初期化（channel カラムを追加）
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    content TEXT NOT NULL,
    channel TEXT DEFAULT 'General',
    likes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
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

// 新規投稿処理
app.post('/posts', (req, res) => {
  const { user, content, channel } = req.body;
  const targetChannel = channel || 'General';

  if (content && content.trim() !== '') {
    const stmt = db.prepare('INSERT INTO posts (user, content, channel) VALUES (?, ?, ?)');
    stmt.run(user || "匿名社員", content, targetChannel);
  }
  
  // 投稿されたチャンネルのタイムラインのみを再取得して返却
  const posts = db.prepare('SELECT * FROM posts WHERE channel = ? ORDER BY id DESC').all(targetChannel);
  res.send(renderFeedHtml(posts));
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