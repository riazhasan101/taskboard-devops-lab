import { useEffect, useState, useCallback } from 'react';

const api = async (path, opts) => {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (!r.ok && r.status !== 204) throw new Error(r.status);
  return r.status === 204 ? null : r.json();
};

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setTasks(await api('/tasks')); setErr(''); } catch { setErr('API unreachable'); }
  }, []);
  const ping = useCallback(async () => {
    try { setInfo(await api('/info')); } catch { setInfo(null); }
  }, []);

  useEffect(() => { load(); ping(); const t = setInterval(ping, 2000); return () => clearInterval(t); }, [load, ping]);

  const add = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await api('/tasks', { method: 'POST', body: JSON.stringify({ title }) });
    setTitle(''); load();
  };
  const toggle = async (t) => { await api('/tasks/' + t.id, { method: 'PATCH', body: JSON.stringify({ done: !t.done }) }); load(); };
  const del = async (t) => { await api('/tasks/' + t.id, { method: 'DELETE' }); load(); };

  return (
    <main>
      <h1>Taskboard</h1>
      <section className="info">
        {info
          ? <>served by <b>{info.pod}</b> · version <b>{info.version}</b> · total hits <b>{info.hits ?? 'n/a (redis down)'}</b></>
          : <span className="bad">backend unreachable</span>}
      </section>
      {err && <p className="bad">{err}</p>}
      <form onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" />
        <button>Add</button>
      </form>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            <label className={t.done ? 'done' : ''}>
              <input type="checkbox" checked={t.done} onChange={() => toggle(t)} /> {t.title}
            </label>
            <button className="x" onClick={() => del(t)}>✕</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
