#!/usr/bin/env python3
"""copy-chats.py SRC_DB SRC_CLAUDE DST_DB DST_CLAUDE CHANNEL...

Copies chosen chats of one Iridium into another, as content to test with (kumo, 2026-11-24): each
channel's messages, members, read places and what was given to its agents, and its agents' own
records (Claude's transcripts). Only the rows of the channels and sessions named: nothing of
logins, passkeys, apps, devices, secrets, permissions, pushes or memories is read. The Iridium
written to must be stopped. Other harnesses' records (pi, Codex, dsh) are not copied: said.
"""
import glob, os, shutil, sqlite3, sys

# Never copied, whatever their columns.
NEVER = {"secrets", "secret_uses", "logins", "web_sessions", "apps", "devices", "permissions", "push_rules", "push_subscriptions", "invites", "machines", "allow_rules", "outbox", "memories", "meta", "usage", "public_links", "assignments", "roles", "session_roles", "channel_scripts", "script_runs", "sqlite_sequence"}

def main():
    src_db, src_claude, dst_db, dst_claude, *channels = sys.argv[1:]
    src = sqlite3.connect(f"file:{src_db}?mode=ro", uri=True)
    dst = sqlite3.connect(dst_db, timeout=10)
    ver = lambda c: c.execute("select value from meta where key='schema'").fetchone() if "meta" in tables(c) else None
    sessions = set(channels)
    for ch in channels:
        for (m,) in src.execute("select member from channel_members where channel=?", (ch,)):
            if m.startswith("agent:"):
                sessions.add(m[6:])
    print(f"{len(channels)} channels, {len(sessions)} sessions")
    for t in sorted(tables(src) & tables(dst)):
        if t in NEVER or t.startswith("channel_fts"):
            continue
        cols = [c for c in columns(src, t) if c in columns(dst, t)]
        keys = [(k, ids) for k, ids in (("channel", channels), ("session", sessions), ("id", channels if t == "channels" else None)) if k in cols and ids]
        if not keys:
            continue
        k, ids = keys[0]
        q = ",".join("?" * len(ids))
        rows = src.execute(f"select {','.join(cols)} from {t} where {k} in ({q})", list(ids)).fetchall()
        if not rows:
            continue
        dst.executemany(f"insert or replace into {t} ({','.join(cols)}) values ({','.join('?' * len(cols))})", rows)
        print(f"  {t}: {len(rows)} rows")
    dst.commit()
    for s in sorted(sessions):
        found = glob.glob(os.path.join(src_claude, "projects", "*", s + ".jsonl"))
        if not found:
            print(f"  no Claude record for {s[:8]} (another harness: not copied)")
            continue
        for f in found:
            to = os.path.join(dst_claude, "projects", os.path.basename(os.path.dirname(f)))
            os.makedirs(to, exist_ok=True)
            shutil.copy2(f, to)
            print(f"  record {s[:8]}: {os.path.getsize(f) // 1024} KB")

tables = lambda c: {r[0] for r in c.execute("select name from sqlite_master where type='table'")}
columns = lambda c, t: [r[1] for r in c.execute(f"pragma table_info({t})")]
main()
