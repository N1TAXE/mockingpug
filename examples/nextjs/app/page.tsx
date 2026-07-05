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

// Exercises the full mockingpug/next feature set against real fetch() calls
// handled by the catch-all Route Handler (app/api/[[...mock]]/route.ts):
// paginated list, custom dictionary (`role`), bare relation (`user.posts`),
// field-level relation (`blogpost.author`), GET by id, POST create, DELETE.
export default function Home() {
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListResponse | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [newName, setNewName] = useState('');

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

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newName) return;
    await fetch('/api/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, email: `${newName}@example.com` }),
    });
    setNewName('');
    setPage(1);
    const res = await fetch(`/api/user?page=1&limit=${PAGE_SIZE}`);
    setList(await res.json());
  }

  async function deleteUser(id: number) {
    await fetch(`/api/user/${id}`, { method: 'DELETE' });
    setSelected(null);
    const res = await fetch(`/api/user?page=${page}&limit=${PAGE_SIZE}`);
    setList(await res.json());
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.meta.total / list.meta.limit)) : 1;

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ maxWidth: 720, textAlign: 'left' }}>
        <h1>mockingpug + Next.js example</h1>
        <p>
          Every request below hits a real <code>/api/user</code> App Router endpoint —{' '}
          <code>app/api/[[...mock]]/route.ts</code>, a catch-all Route Handler backed by{' '}
          <code>mockingpug/next</code>, generating data from <code>mock/api/user/schema.json</code> +{' '}
          <code>mock/api/blogpost/schema.json</code>. Unlike the React/MSW examples, this is a real server
          endpoint, not a browser-only interception — check it with <code>curl</code> too.
        </p>

        <form onSubmit={createUser} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            placeholder="New user name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit">Create</button>
        </form>

        {!list && <p>Loading...</p>}

        {list?.data.map((user) => (
          <div key={user.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #333' }}>
            <span>
              #{user.id} {user.name} <em>{user.role}</em>
            </span>
            <span>
              <button type="button" onClick={() => openUser(user.id)}>View</button>{' '}
              <button type="button" onClick={() => deleteUser(user.id)}>Delete</button>
            </span>
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
