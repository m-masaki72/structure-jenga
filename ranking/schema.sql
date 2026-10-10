-- 限界モードのスコア。status: pending（未検証）/ verified / rejected
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  day TEXT NOT NULL,
  seed INTEGER NOT NULL,
  player TEXT NOT NULL,
  name TEXT NOT NULL,
  claimed INTEGER NOT NULL,
  score INTEGER,
  actions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TEXT NOT NULL,
  created_day TEXT NOT NULL,
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (level, status, day, score);
CREATE INDEX IF NOT EXISTS scores_pending ON scores (status, id);
CREATE INDEX IF NOT EXISTS scores_player ON scores (player, created_day);
