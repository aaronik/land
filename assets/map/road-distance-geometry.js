'use strict';

// Routes only over geometry currently loaded by MapLibre. This is a measurement,
// not a navigation graph: crossings connect only when the source shares vertices.
const R = 6371008.8;
const radians = Math.PI / 180;
export function metersBetween(a, b) {
  const lat = (b[1] - a[1]) * radians, lng = (b[0] - a[0]) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(lng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= item[0]) break;
    heap[i] = heap[p]; i = p;
  }
  heap[i] = item;
}
function heapPop(heap) {
  const top = heap[0], last = heap.pop();
  if (heap.length) {
    let i = 0;
    while (2 * i + 1 < heap.length) {
      let c = 2 * i + 1;
      if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
      if (heap[c][0] >= last[0]) break;
      heap[i] = heap[c]; i = c;
    }
    heap[i] = last;
  }
  return top;
}

export function buildRoadGraph(features, maxSegments = 80000) {
  const nodes = [], edges = [], buckets = new Map(), seen = new Set();
  // Adjacent tile fragments can differ slightly at the seam. Merge only
  // vertices within 1.5 m, rather than joining nearby parallel roads.
  const first = features.find(f => f.geometry?.coordinates?.length)?.geometry;
  const lat0 = (first?.type === 'MultiLineString' ? first.coordinates[0]?.[0]?.[1] : first?.coordinates?.[0]?.[1]) || 41;
  const scaleX = 111195 * Math.cos(lat0 * radians), scaleY = 111195;
  const xy = point => [point[0] * scaleX, point[1] * scaleY];
  const nodeFor = point => {
    const [x, y] = xy(point), bx = Math.floor(x / 1.5), by = Math.floor(y / 1.5);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of buckets.get(`${bx + dx},${by + dy}`) || []) {
        const existing = nodes[id].xy;
        if (Math.hypot(x - existing[0], y - existing[1]) < 1.5) return id;
      }
    }
    const id = nodes.length;
    nodes.push({ point, xy: [x, y], edges: [] });
    const key = `${bx},${by}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(id);
    return id;
  };
  for (const feature of features) {
    const geometry = feature.geometry;
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (!a || !b || !a.every(Number.isFinite) || !b.every(Number.isFinite)) continue;
      const u = nodeFor(a), v = nodeFor(b);
      if (u === v) continue;
      const key = `${Math.min(u, v)},${Math.max(u, v)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (edges.length >= maxSegments) return { error: 'Too many roads loaded. Zoom in and try a shorter segment.' };
      const length = metersBetween(nodes[u].point, nodes[v].point);
      const id = edges.length;
      edges.push({ u, v, length });
      nodes[u].edges.push(id); nodes[v].edges.push(id);
    }
  }
  return { nodes, edges, scaleX, scaleY };
}

export function snapToRoad(graph, point, maxMeters = 50) {
  if (!graph.edges?.length) return null;
  const [x, y] = [point[0] * graph.scaleX, point[1] * graph.scaleY];
  let best = null;
  for (let id = 0; id < graph.edges.length; id++) {
    const edge = graph.edges[id], a = graph.nodes[edge.u].xy, b = graph.nodes[edge.v].xy;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    const distance = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
    if (distance < maxMeters && (!best || distance < best.distance)) {
      const p = graph.nodes[edge.u].point, q = graph.nodes[edge.v].point;
      best = { edge: id, t, point: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])], distance };
    }
  }
  return best;
}

export function shortestRoadPath(graph, start, end) {
  if (!start || !end) return null;
  const { nodes, edges } = graph, source = nodes.length, target = source + 1;
  const adjacency = id => {
    if (id === source || id === target) {
      const snap = id === source ? start : end, edge = edges[snap.edge];
      return [[edge.u, edge.length * snap.t], [edge.v, edge.length * (1 - snap.t)],
        ...(start.edge === end.edge ? [[id === source ? target : source, edge.length * Math.abs(start.t - end.t)]] : [])];
    }
    const list = nodes[id].edges.map(edgeId => {
      const edge = edges[edgeId]; return [edge.u === id ? edge.v : edge.u, edge.length];
    });
    for (const [snap, virtual] of [[start, source], [end, target]]) {
      const edge = edges[snap.edge];
      if (edge.u === id) list.push([virtual, edge.length * snap.t]);
      if (edge.v === id) list.push([virtual, edge.length * (1 - snap.t)]);
    }
    return list;
  };
  const dist = new Float64Array(target + 1).fill(Infinity), prev = new Int32Array(target + 1).fill(-1);
  const heap = [];
  dist[source] = 0; heapPush(heap, [0, source]);
  while (heap.length) {
    const [distance, id] = heapPop(heap);
    if (distance !== dist[id]) continue;
    if (id === target) break;
    for (const [neighbor, length] of adjacency(id)) {
      const next = distance + length;
      if (next < dist[neighbor]) { dist[neighbor] = next; prev[neighbor] = id; heapPush(heap, [next, neighbor]); }
    }
  }
  if (!Number.isFinite(dist[target])) return null;
  const path = [];
  for (let id = target; id !== -1; id = prev[id]) path.push(id === source ? start.point : id === target ? end.point : nodes[id].point);
  return { coordinates: path.reverse(), meters: dist[target] };
}
