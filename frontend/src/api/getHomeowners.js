// src/api/getHomeowners.js
import api from "./index"; // your axios instance

let cached = null;
let inFlight = null;

export default function getHomeowners() {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = api.get("/homeowners/").then(({ data }) => {
    cached = Array.isArray(data) ? data : data?.results || [];
    return cached;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
