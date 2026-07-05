import { useEffect, useState } from 'react';
import './App.css';

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

// Exercises the full mockingpug/react feature set against real fetch() calls
// intercepted by MSW: paginated list, custom dictionary (`role`), bare
// relation (`user.posts` -> blogpost, resolved at read time), field-level
// relation (`blogpost.author` -> user.id), GET by id, POST create, DELETE.
function App() {
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
    <div id="app">
      <h1>mockingpug + CRA example</h1>
      <p>
        Every request below hits real <code>fetch('/api/user')</code> calls, intercepted by MSW
        with data generated from <code>src/mock/api/user/schema.json</code> +{' '}
        <code>src/mock/api/blogpost/schema.json</code>. Open devtools' Network tab — the requests are
        real, only the responses are mocked.
      </p>

      <form className="toolbar" onSubmit={createUser}>
        <input
          placeholder="New user name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">Create</button>
      </form>

      {!list && <p>Loading...</p>}

      {list?.data.map((user) => (
        <div className="user-row" key={user.id}>
          <span>
            #{user.id} {user.name} <span className="role">{user.role}</span>
          </span>
          <span>
            <button type="button" onClick={() => openUser(user.id)}>
              View
            </button>{' '}
            <button type="button" onClick={() => deleteUser(user.id)}>
              Delete
            </button>
          </span>
        </div>
      ))}

      {list && (
        <div className="pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>
          <span>
            Page {page} / {totalPages} ({list.meta.total} users)
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}

      {selected && (
        <div className="detail">
          <h3>
            {selected.name} <span className="role">{selected.role}</span>
          </h3>
          <p>{selected.email}</p>
          <p>{selected.posts.length} posts (bare relation, resolved on read):</p>
          <ul>
            {selected.posts.slice(0, 5).map((post) => (
              <li key={post.id}>{post.title}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
