// Where people came from: links such as https://example.com/?origin=newsletter count visits and sign-ups per day.
// Only daily totals (day, origin, count) are kept: nothing links an origin to a person, no cookie, no IP.

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_ORIGINS = 200; // against someone inventing thousands of origins: past this, new ones are not counted

/** "Spring Post" → "spring-post"; '' when it cannot be used. */
export function originName(raw) {
  const n = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-');
  return NAME.test(n) ? n : '';
}

export function createOrigins({ db, timeZone = process.env.TZ_ORIGINS || 'UTC', now = () => Date.now() }) {
  const day = (t = now()) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(t); // 2026-10-30
  const known = () => db.prepare('SELECT COUNT(DISTINCT origin) AS n FROM origins').get().n;
  // the column name cannot be a ? parameter, so each one gets its own fixed statement
  const sql = {
    visits: 'INSERT INTO origins (day, origin, visits) VALUES (?, ?, 1) ON CONFLICT (day, origin) DO UPDATE SET visits = visits + 1',
    signups: 'INSERT INTO origins (day, origin, signups) VALUES (?, ?, 1) ON CONFLICT (day, origin) DO UPDATE SET signups = signups + 1',
  };

  /** Adds 1 to `field` (visits | signups) today. Returns whether it counted. */
  function count(raw, field) {
    const origin = originName(raw);
    if (!origin || !Object.hasOwn(sql, field)) return false;
    const exists = db.prepare('SELECT 1 FROM origins WHERE origin = ? LIMIT 1').get(origin);
    if (!exists && known() >= MAX_ORIGINS) return false;
    db.prepare(sql[field]).run(day(), origin);
    return true;
  }

  /** For the admin page: per origin, the last `days` days and today, the ones with most sign-ups first. */
  function summary(days = 30) {
    const since = day(now() - (days - 1) * 86400000);
    const today = day();
    return db
      .prepare(
        `SELECT origin, SUM(visits) AS visits, SUM(signups) AS signups,
          SUM(CASE WHEN day = ? THEN visits ELSE 0 END) AS visitsToday,
          SUM(CASE WHEN day = ? THEN signups ELSE 0 END) AS signupsToday
        FROM origins WHERE day >= ? GROUP BY origin ORDER BY signups DESC, visits DESC`,
      )
      .all(today, today, since)
      .map((o) => ({ ...o }));
  }

  return { count, summary };
}
