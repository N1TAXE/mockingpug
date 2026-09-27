'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  posts: Array<{ id: string; title: string }>;
}

interface ListResponse {
  data: User[];
  meta: { total: number; page: number; limit: number };
}

const PAGE_SIZE = 10;

// Exercises the endpoint-driven mockingpug/next surface (mock/routes/user.json)
// against real fetch() handled by the catch-all Route Handler
// (app/api/[[...mock]]/route.ts): a `list` endpoint (paginated, custom
// dictionary `role`) and a `one` endpoint with an `include` that joins the
// internal `blogpost` table back as `user.posts`. `blogpost` has no route of
// its own — it's an internal table, used only through relations/includes.
export default function Home() {
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListResponse | null>(null);
  const [selected, setSelected] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    fetch(`/api/user?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setList(data);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  async function openUser(id: number) {
    const res = await fetch(`/api/user/${id}`);
    setSelected(await res.json());
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.meta.total / list.meta.limit)) : 1;

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ maxWidth: 720, textAlign: 'left' }}>
        <h1>mockingpug + Next.js example</h1>
        <p>
          Every request below hits a real <code>/api/user</code> App Router endpoint —{' '}
          <code>app/api/[[...mock]]/route.ts</code>, a catch-all Route Handler backed by{' '}
          <code>mockingpug/next</code>, generating data from <code>mock/tables/user.json</code> +{' '}
          <code>mock/tables/blogpost.json</code> and routing via <code>mock/routes/user.json</code>.
          Unlike the React/MSW examples, this is a real server endpoint, not a browser-only
          interception — check it with <code>curl</code> too.
        </p>

        {!list && <p>Loading...</p>}

        {list?.data.map((user) => (
          <div key={user.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #333' }}>
            <span>
              #{user.id} {user.name} <em>{user.role}</em>
            </span>
            <button type="button" onClick={() => openUser(user.id)}>View</button>
          </div>
        ))}

        {list && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span>Page {page} / {totalPages} ({list.meta.total} users)</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}

        {selected && (
          <div style={{ marginTop: 16, padding: 12, border: '1px solid #333', borderRadius: 6 }}>
            <h3>{selected.name} <em>{selected.role}</em></h3>
            <p>{selected.email}</p>
            <p>{selected.posts.length} posts (bare relation, resolved on read):</p>
            <ul>
              {selected.posts.slice(0, 5).map((post) => (
                <li key={post.id}>{post.title}</li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
