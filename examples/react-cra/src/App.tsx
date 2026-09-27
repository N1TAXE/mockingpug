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

// Exercises the endpoint-driven mockingpug/react surface (src/mock/routes/user.json)
// intercepted by MSW: a `list` endpoint (paginated, custom dictionary `role`)
// and a `one` endpoint with an `include` that joins the internal `blogpost`
// table back as `user.posts`. `blogpost` has no route — it's an internal table,
// reached only through relations/includes.
function App() {
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
    <div id="app">
      <h1>mockingpug + CRA example</h1>
      <p>
        Every request below hits real <code>fetch('/api/user')</code> calls, intercepted by MSW
        with data generated from <code>src/mock/tables/user.json</code> +{' '}
        <code>src/mock/tables/blogpost.json</code> and routed via <code>src/mock/routes/user.json</code>.
        Open devtools' Network tab — the requests are real, only the responses are mocked.
      </p>

      {!list && <p>Loading...</p>}

      {list?.data.map((user) => (
        <div className="user-row" key={user.id}>
          <span>
            #{user.id} {user.name} <span className="role">{user.role}</span>
          </span>
          <button type="button" onClick={() => openUser(user.id)}>
            View
          </button>
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
          <p>{selected.posts.length} posts (include join from the internal blogpost table):</p>
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
