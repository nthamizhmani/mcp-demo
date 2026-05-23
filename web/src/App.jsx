import { useEffect, useRef, useState } from 'react';

const API = 'http://localhost:3000';
const AGENT = 'http://localhost:3001';

export default function App() {
  const [movies, setMovies] = useState([]);
  const [yearFilter, setYearFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ title: '', director: '', year: '', rating: '' });

  // Chat state
  const [chatHistory, setChatHistory] = useState([]); // [{role: 'user'|'assistant', text, trace?}]
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState(null);
  const chatEndRef = useRef(null);

  async function sendChat(e) {
    e.preventDefault();
    const userText = chatInput.trim();
    if (!userText || chatBusy) return;

    setChatError(null);
    setChatBusy(true);
    setChatInput('');

    const newHistory = [...chatHistory, { role: 'user', text: userText }];
    setChatHistory(newHistory);

    try {
      const messages = newHistory.map((m) => ({ role: m.role, content: m.text }));
      const res = await fetch(`${AGENT}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setChatHistory([
        ...newHistory,
        { role: 'assistant', text: body.reply, trace: body.trace ?? [] },
      ]);
      load(yearFilter); // refresh table in case the agent modified data
    } catch (e) {
      setChatError(e.message);
    } finally {
      setChatBusy(false);
    }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, chatBusy]);

  async function load(year) {
    setLoading(true);
    setError(null);
    try {
      const url = year ? `${API}/movies?year=${encodeURIComponent(year)}` : `${API}/movies`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMovies(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addMovie(e) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${API}/movies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          director: form.director,
          year: Number(form.year),
          rating: form.rating === '' ? null : Number(form.rating),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setForm({ title: '', director: '', year: '', rating: '' });
      load(yearFilter);
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteMovie(id) {
    setError(null);
    try {
      const res = await fetch(`${API}/movies/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load(yearFilter);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main>
      <h1>Movies</h1>
      <p className="subtitle">Data served from <code>http://localhost:3000</code></p>

      <section className="filter">
        <label>
          Filter by year:{' '}
          <input
            type="number"
            placeholder="e.g. 2019"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
          />
        </label>
        <button onClick={() => load(yearFilter)}>Apply</button>
        <button
          onClick={() => {
            setYearFilter('');
            load();
          }}
        >
          Clear
        </button>
      </section>

      {error && <div className="error">Error: {error}</div>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Director</th>
              <th>Year</th>
              <th>Rating</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {movies.map((m) => (
              <tr key={m.id}>
                <td>{m.title}</td>
                <td>{m.director}</td>
                <td>{m.year}</td>
                <td>{m.rating ?? '—'}</td>
                <td>
                  <button className="danger" onClick={() => deleteMovie(m.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {movies.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">No movies match.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <section className="add">
        <h2>Add a movie</h2>
        <form onSubmit={addMovie}>
          <input
            required
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            required
            placeholder="Director"
            value={form.director}
            onChange={(e) => setForm({ ...form, director: e.target.value })}
          />
          <input
            required
            type="number"
            placeholder="Year"
            value={form.year}
            onChange={(e) => setForm({ ...form, year: e.target.value })}
          />
          <input
            type="number"
            step="0.1"
            placeholder="Rating (optional)"
            value={form.rating}
            onChange={(e) => setForm({ ...form, rating: e.target.value })}
          />
          <button type="submit">Add</button>
        </form>
      </section>

      <section className="chat">
        <h2>Chat with the catalog</h2>
        <p className="hint">
          Ask in natural language. The agent calls the same API as the table above.
        </p>
        <div className="chat-log">
          {chatHistory.length === 0 && (
            <p className="empty">
              Try: <em>"What movies from 2019 do we have?"</em> or{' '}
              <em>"Add Interstellar (2014) directed by Christopher Nolan, rating 8.6."</em>
            </p>
          )}
          {chatHistory.map((msg, i) => (
            <div key={i} className={`msg msg-${msg.role}`}>
              <div className="msg-role">{msg.role === 'user' ? 'You' : 'Claude'}</div>
              <div className="msg-text">{msg.text || <em>(no text)</em>}</div>
              {msg.trace && msg.trace.length > 0 && (
                <details className="trace">
                  <summary>{msg.trace.length} tool call{msg.trace.length === 1 ? '' : 's'}</summary>
                  {msg.trace.map((t, j) => (
                    <pre key={j}>
                      → {t.name}({JSON.stringify(t.input)}){'\n'}
                      ← {JSON.stringify(t.output).slice(0, 400)}
                    </pre>
                  ))}
                </details>
              )}
            </div>
          ))}
          {chatBusy && <div className="msg msg-assistant"><em>thinking…</em></div>}
          <div ref={chatEndRef} />
        </div>
        {chatError && <div className="error">Error: {chatError}</div>}
        <form onSubmit={sendChat} className="chat-input">
          <input
            placeholder="Ask about movies…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={chatBusy}
          />
          <button type="submit" disabled={chatBusy || !chatInput.trim()}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
