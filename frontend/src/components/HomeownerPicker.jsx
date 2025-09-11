// src/components/HomeownerPicker.jsx
import { useEffect, useState } from "react";
import { getHomeownersOnce } from "@/lib/homeowners";

export default function HomeownerPicker({ onSelect }) {
  const [list, setList] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    let mounted = true;

    getHomeownersOnce({ signal: ac.signal })
      .then((data) => { if (mounted) setList(data); })
      .catch((e) => { if (e.name !== "CanceledError") setErr("Failed to load homeowners."); });

    return () => { mounted = false; ac.abort(); };
  }, []);

  if (err) return <div className="text-red-500">{err}</div>;
  return (
    <select onChange={e => onSelect(list.find(h => h.id === Number(e.target.value)))}>
      <option value="">Select homeowner…</option>
      {list.map(h => <option key={h.id} value={h.id}>{h.name || h.full_name}</option>)}
    </select>
  );
}
