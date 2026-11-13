import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

export const VIDEO_W = 720;
export const VIDEO_H = 540;
const CELL_W = 240;
const CELL_H = 180;

const isAir = s => /:(?:air|cave_air|void_air)(?:\[|$)/.test(s);
const key = (x, y, z) => `${x},${y},${z}`;

function parseState(state) {
  const [name, rest] = state.split('[');
  return {
    name,
    props: Object.fromEntries((rest?.slice(0,-1) || '').split(',').filter(Boolean).map(p => p.split('=')))
  };
}

function doorBox(d) {
  return [d === 'east' ? [0,0,0,.1875,1,1] : d === 'west' ? [.8125,0,0,.1875,1,1] : d === 'south' ? [0,0,0,1,1,.1875] : [0,0,.8125,1,1,.1875]];
}

const boxCache = new Map();
function boxesFor(state) {
  let cached = boxCache.get(state);
  if (cached) return cached;
  const { name, props: p } = parseState(state);
  if (isAir(state)) cached = [];
  else if (name.endsWith('_slab')) cached = p.type === 'double' ? [[0,0,0,1,1,1]] : [[0, p.type === 'top' ? .5 : 0, 0, 1, .5, 1]];
  else if (name.endsWith('_stairs')) {
    const upper = p.half === 'top';
    const boxes = [[0, upper ? .5 : 0, 0, 1, .5, 1]];
    const d = p.facing || 'north';
    boxes.push(d === 'east' ? [.5, upper ? 0 : .5, 0, .5, .5, 1] : d === 'west' ? [0, upper ? 0 : .5, 0, .5, .5, 1] : d === 'south' ? [0, upper ? 0 : .5, .5, 1, .5, .5] : [0, upper ? 0 : .5, 0, 1, .5, .5]);
    cached = boxes;
  } else if (name.endsWith('_trapdoor')) cached = p.open !== 'true' ? [[0, p.half === 'top' ? .8125 : 0, 0, 1, .1875, 1]] : doorBox(p.facing);
  else if (name.endsWith('_door')) {
    const dirs = ['north','east','south','west'];
    let d = p.facing || 'north';
    if (p.open === 'true') d = dirs[(dirs.indexOf(d) + (p.hinge === 'right' ? 3 : 1)) % 4];
    cached = doorBox(d);
  } else if (name.endsWith('_carpet')) cached = [[0,0,0,1,.0625,1]];
  else if (name === 'minecraft:snow') cached = [[0,0,0,1,Math.min(8, Number(p.layers) || 1) / 8,1]];
  else if (name.endsWith('_fence') || name.endsWith('_wall')) cached = [[.375,0,.375,.25,1.5,.25]];
  else if (name.includes('torch')) cached = [[.4375,0,.4375,.125,.65,.125]];
  else cached = [[0,0,0,1,1,1]];
  boxCache.set(state, cached);
  return cached;
}

const colorCache = new Map();
function colorFor(s) {
  let c = colorCache.get(s);
  if (c !== undefined) return c;
  if (/water/.test(s)) c = 0x397c9f;
  else if (/lava/.test(s)) c = 0xdb8245;
  else if (/grass|leaves|moss/.test(s)) c = 0x648355;
  else if (/dirt|mud/.test(s)) c = 0x7d6550;
  else if (/sand|birch/.test(s)) c = 0xc2b585;
  else if (/wood|log|planks|door|fence|stairs/.test(s)) c = 0x998063;
  else if (/snow|quartz|white/.test(s)) c = 0xd7ddd5;
  else if (/glass|ice/.test(s)) c = 0x95b9b9;
  else c = 0x849087;
  colorCache.set(s, c);
  return c;
}

function isFullCube(state) {
  const b = boxesFor(state);
  return b.length === 1 && b[0][0] === 0 && b[0][1] === 0 && b[0][2] === 0 && b[0][3] === 1 && b[0][4] === 1 && b[0][5] === 1;
}

function frameAt(frames, t) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].tick <= t) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

// Compact 5x7 uppercase bitmap font
const FONT = {
  ' ': [0,0,0,0,0,0,0],
  '0': [14,17,19,21,25,17,14], '1': [4,12,4,4,4,4,14], '2': [14,17,1,6,8,16,31], '3': [31,2,4,6,1,17,14],
  '4': [2,6,10,18,31,2,2], '5': [31,16,30,1,1,17,14], '6': [6,8,16,30,17,17,14], '7': [31,1,2,4,8,8,8],
  '8': [14,17,17,14,17,17,14], '9': [14,17,17,15,1,2,12],
  'A': [14,17,17,31,17,17,17], 'B': [30,17,17,30,17,17,30], 'C': [14,17,16,16,16,17,14], 'D': [28,18,17,17,17,18,28],
  'E': [31,16,16,30,16,16,31], 'F': [31,16,16,30,16,16,16], 'G': [14,17,16,23,17,17,15], 'H': [17,17,17,31,17,17,17],
  'I': [14,4,4,4,4,4,14], 'J': [7,2,2,2,2,18,12], 'K': [17,18,20,24,20,18,17], 'L': [16,16,16,16,16,16,31],
  'M': [17,27,21,21,17,17,17], 'N': [17,25,21,19,17,17,17], 'O': [14,17,17,17,17,17,14], 'P': [30,17,17,30,16,16,16],
  'Q': [14,17,17,17,21,18,13], 'R': [30,17,17,30,20,18,17], 'S': [15,16,16,14,1,1,30], 'T': [31,4,4,4,4,4,4],
  'U': [17,17,17,17,17,17,14], 'V': [17,17,17,17,17,10,4], 'W': [17,17,17,21,21,27,17], 'X': [17,17,10,4,10,17,17],
  'Y': [17,17,10,4,4,4,4], 'Z': [31,1,2,4,8,16,31],
  ':': [0,4,4,0,4,4,0], '.': [0,0,0,0,0,12,12], '-': [0,0,0,31,0,0,0], '/': [1,2,2,4,8,8,16],
  '(': [2,4,8,8,8,4,2], ')': [8,4,2,2,2,4,8], '+': [0,4,4,31,4,4,0], '_': [0,0,0,0,0,0,31]
};

function drawText(rgb, x, y, text, r, g, b, maxX = VIDEO_W - 2) {
  const s = String(text || '').toUpperCase();
  let cx = x | 0;
  const cy = y | 0;
  for (let i = 0; i < s.length; i++) {
    if (cx + 5 >= maxX) break;
    const glyph = FONT[s[i]] || FONT[' '];
    for (let row = 0; row < 7; row++) {
      const py = cy + row;
      if (py < 0 || py >= VIDEO_H) continue;
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if ((bits >> (4 - col)) & 1) {
          const px = cx + col;
          if (px >= 0 && px < VIDEO_W) {
            const idx = (py * VIDEO_W + px) * 3;
            rgb[idx] = r;
            rgb[idx + 1] = g;
            rgb[idx + 2] = b;
          }
        }
      }
    }
    cx += 6;
  }
}

function fillRect(rgb, x0, y0, w, h, r, g, b) {
  const xStart = Math.max(0, x0 | 0), yStart = Math.max(0, y0 | 0);
  const xEnd = Math.min(VIDEO_W, (x0 + w) | 0), yEnd = Math.min(VIDEO_H, (y0 + h) | 0);
  for (let y = yStart; y < yEnd; y++) {
    let idx = (y * VIDEO_W + xStart) * 3;
    for (let x = xStart; x < xEnd; x++) {
      rgb[idx] = r;
      rgb[idx + 1] = g;
      rgb[idx + 2] = b;
      idx += 3;
    }
  }
}

function strokeRect(rgb, x0, y0, w, h, r, g, b) {
  fillRect(rgb, x0, y0, w, 1, r, g, b);
  fillRect(rgb, x0, y0 + h - 1, w, 1, r, g, b);
  fillRect(rgb, x0, y0, 1, h, r, g, b);
  fillRect(rgb, x0 + w - 1, y0, 1, h, r, g, b);
}

function makeCamera(cx, cy, cz, fx, fy, fz, fovDeg = 68) {
  // Forward vector
  let dx = fx - cx, dy = fy - cy, dz = fz - cz;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  // Right = normalize(cross(forward, up(0,1,0))) = normalize((-dz, 0, dx))
  let rx = -dz, ry = 0, rz = dx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  // Up = cross(right, forward)
  const ux = ry * dz - rz * dy;
  const uy = rz * dx - rx * dz;
  const uz = rx * dy - ry * dx;
  const scale = (CELL_H * 0.5) / Math.tan((fovDeg * 0.5 * Math.PI) / 180);
  return { cx, cy, cz, dx, dy, dz, rx, ry, rz, ux, uy, uz, scale };
}

function projectPoint(cam, vx, vy, vz, xOff, yOff) {
  const px = vx - cam.cx, py = vy - cam.cy, pz = vz - cam.cz;
  const tz = px * cam.dx + py * cam.dy + pz * cam.dz;
  if (tz <= 0.12) return null;
  const tx = px * cam.rx + py * cam.ry + pz * cam.rz;
  const ty = px * cam.ux + py * cam.uy + pz * cam.uz;
  const sx = xOff + CELL_W * 0.5 + (tx / tz) * cam.scale;
  const sy = yOff + CELL_H * 0.5 - (ty / tz) * cam.scale;
  return { sx, sy, tz };
}

function drawLine2D(rgb, zbuf, xOff, yOff, p0, p1, r, g, b, ignoreDepth = false) {
  if (!p0 || !p1) return;
  let x0 = p0.sx, y0 = p0.sy, z0 = p0.tz;
  let x1 = p1.sx, y1 = p1.sy, z1 = p1.tz;
  const steps = Math.min(400, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))));
  const minX = xOff, maxX = xOff + CELL_W - 1;
  const minY = yOff, maxY = yOff + CELL_H - 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (x0 + (x1 - x0) * t) | 0;
    const y = (y0 + (y1 - y0) * t) | 0;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    const z = z0 + (z1 - z0) * t - 0.05;
    const pIdx = y * VIDEO_W + x;
    if (ignoreDepth || z <= zbuf[pIdx]) {
      if (!ignoreDepth) zbuf[pIdx] = z;
      const idx = pIdx * 3;
      rgb[idx] = r;
      rgb[idx + 1] = g;
      rgb[idx + 2] = b;
    }
  }
}

function drawLine3D(rgb, zbuf, cam, xOff, yOff, ax, ay, az, bx, by, bz, r, g, b, ignoreDepth = false) {
  const p0 = projectPoint(cam, ax, ay, az, xOff, yOff);
  const p1 = projectPoint(cam, bx, by, bz, xOff, yOff);
  drawLine2D(rgb, zbuf, xOff, yOff, p0, p1, r, g, b, ignoreDepth);
}

function rasterizeTriangle(rgb, zbuf, xOff, yOff, p0, p1, p2, r, g, b) {
  const minX = Math.max(xOff, Math.floor(Math.min(p0.sx, p1.sx, p2.sx)));
  const maxX = Math.min(xOff + CELL_W - 1, Math.ceil(Math.max(p0.sx, p1.sx, p2.sx)));
  const minY = Math.max(yOff, Math.floor(Math.min(p0.sy, p1.sy, p2.sy)));
  const maxY = Math.min(yOff + CELL_H - 1, Math.ceil(Math.max(p0.sy, p1.sy, p2.sy)));
  if (minX > maxX || minY > maxY) return;
  const area = (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p1.sy - p0.sy) * (p2.sx - p0.sx);
  if (Math.abs(area) < 0.5) return;
  const invArea = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((p1.sx - px) * (p2.sy - py) - (p1.sy - py) * (p2.sx - px)) * invArea;
      const w1 = ((p2.sx - px) * (p0.sy - py) - (p2.sy - py) * (p0.sx - px)) * invArea;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
        const z = w0 * p0.tz + w1 * p1.tz + w2 * p2.tz;
        const pIdx = y * VIDEO_W + x;
        if (z < zbuf[pIdx]) {
          zbuf[pIdx] = z;
          const isEdge = w0 < 0.045 || w1 < 0.045;
          const idx = pIdx * 3;
          rgb[idx] = isEdge ? (r * 0.78) | 0 : r;
          rgb[idx + 1] = isEdge ? (g * 0.78) | 0 : g;
          rgb[idx + 2] = isEdge ? (b * 0.78) | 0 : b;
        }
      }
    }
  }
}

function drawQuad3D(rgb, zbuf, cam, xOff, yOff, v0, v1, v2, v3, r, g, b) {
  const p0 = projectPoint(cam, v0[0], v0[1], v0[2], xOff, yOff);
  const p1 = projectPoint(cam, v1[0], v1[1], v1[2], xOff, yOff);
  const p2 = projectPoint(cam, v2[0], v2[1], v2[2], xOff, yOff);
  const p3 = projectPoint(cam, v3[0], v3[1], v3[2], xOff, yOff);
  if (!p0 || !p1 || !p2 || !p3) return;
  rasterizeTriangle(rgb, zbuf, xOff, yOff, p0, p1, p2, r, g, b);
  rasterizeTriangle(rgb, zbuf, xOff, yOff, p0, p2, p3, r, g, b);
}

function drawWireBox(rgb, zbuf, cam, xOff, yOff, x0, y0, z0, x1, y1, z1, r, g, b, ignoreDepth = false) {
  const corners = [
    [x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],
    [x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]
  ].map(c => projectPoint(cam, c[0], c[1], c[2], xOff, yOff));
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  for (const [a, e] of edges) drawLine2D(rgb, zbuf, xOff, yOff, corners[a], corners[e], r, g, b, ignoreDepth);
}

function extractVisibleFaces(blocks, px, py, pz, radius = 16) {
  const faces = [];
  const r2 = radius * radius;
  for (const b of blocks.values()) {
    const dx = b.x + 0.5 - px, dy = b.y + 0.5 - py, dz = b.z + 0.5 - pz;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    const boxes = boxesFor(b.state);
    if (!boxes.length) continue;
    const hex = colorFor(b.state);
    const cr = (hex >> 16) & 255, cg = (hex >> 8) & 255, cb = hex & 255;
    const full = isFullCube(b.state);
    for (const [ox, oy, oz, w, h, d] of boxes) {
      const x0 = b.x + ox, y0 = b.y + oy, z0 = b.z + oz;
      const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
      // +Y top
      if (!full || !blocks.has(key(b.x, b.y + 1, b.z)) || !isFullCube(blocks.get(key(b.x, b.y + 1, b.z)).state)) {
        faces.push({ n: [0,1,0], v: [[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]], r: Math.min(255, (cr * 1.12) | 0), g: Math.min(255, (cg * 1.12) | 0), b: Math.min(255, (cb * 1.12) | 0) });
      }
      // -Y bottom
      if (!full || !blocks.has(key(b.x, b.y - 1, b.z)) || !isFullCube(blocks.get(key(b.x, b.y - 1, b.z)).state)) {
        faces.push({ n: [0,-1,0], v: [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]], r: (cr * 0.58) | 0, g: (cg * 0.58) | 0, b: (cb * 0.58) | 0 });
      }
      // -Z north
      if (!full || !blocks.has(key(b.x, b.y, b.z - 1)) || !isFullCube(blocks.get(key(b.x, b.y, b.z - 1)).state)) {
        faces.push({ n: [0,0,-1], v: [[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0]], r: (cr * 0.88) | 0, g: (cg * 0.88) | 0, b: (cb * 0.88) | 0 });
      }
      // +Z south
      if (!full || !blocks.has(key(b.x, b.y, b.z + 1)) || !isFullCube(blocks.get(key(b.x, b.y, b.z + 1)).state)) {
        faces.push({ n: [0,0,1], v: [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], r: (cr * 0.92) | 0, g: (cg * 0.92) | 0, b: (cb * 0.92) | 0 });
      }
      // -X west
      if (!full || !blocks.has(key(b.x - 1, b.y, b.z)) || !isFullCube(blocks.get(key(b.x - 1, b.y, b.z)).state)) {
        faces.push({ n: [-1,0,0], v: [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]], r: (cr * 0.76) | 0, g: (cg * 0.76) | 0, b: (cb * 0.76) | 0 });
      }
      // +X east
      if (!full || !blocks.has(key(b.x + 1, b.y, b.z)) || !isFullCube(blocks.get(key(b.x + 1, b.y, b.z)).state)) {
        faces.push({ n: [1,0,0], v: [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]], r: (cr * 0.8) | 0, g: (cg * 0.8) | 0, b: (cb * 0.8) | 0 });
      }
    }
  }
  return faces;
}

function renderViewport(rgb, zbuf, col, row, label, cam, isFirstPerson, faces, playerState, activeEntities, recentEvents) {
  const xOff = col * CELL_W, yOff = row * CELL_H;
  // Clear viewport sky/ground gradient + z-buffer
  for (let y = 0; y < CELL_H; y++) {
    const py = yOff + y;
    const sky = y < CELL_H * 0.45;
    const r = sky ? 19 : 23;
    const g = sky ? 33 : 40;
    const b = sky ? 24 : 29;
    let idx = (py * VIDEO_W + xOff) * 3;
    let zIdx = py * VIDEO_W + xOff;
    for (let x = 0; x < CELL_W; x++) {
      rgb[idx] = r; rgb[idx + 1] = g; rgb[idx + 2] = b;
      zbuf[zIdx++] = 1e9;
      idx += 3;
    }
  }

  // Render visible terrain faces facing the camera
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const v0 = face.v[0];
    const toCamX = cam.cx - v0[0], toCamY = cam.cy - v0[1], toCamZ = cam.cz - v0[2];
    if (toCamX * face.n[0] + toCamY * face.n[1] + toCamZ * face.n[2] <= -0.2) continue;
    drawQuad3D(rgb, zbuf, cam, xOff, yOff, face.v[0], face.v[1], face.v[2], face.v[3], face.r, face.g, face.b);
  }

  // Highlight recent block changes / interactions
  for (const ev of recentEvents) {
    if ((ev.type === 'place' || ev.type === 'break' || ev.type === 'interact') && ev.x != null) {
      const [hr, hg, hb] = ev.type === 'place' ? [92, 225, 230] : ev.type === 'break' ? [255, 92, 92] : [255, 209, 102];
      drawWireBox(rgb, zbuf, cam, xOff, yOff, ev.x - 0.02, ev.y - 0.02, ev.z - 0.02, ev.x + 1.02, ev.y + 1.02, ev.z + 1.02, hr, hg, hb, true);
    }
  }

  // Render nearby entities (in all 5 cameras!)
  for (const ent of activeEntities) {
    const hw = ent.width * 0.5;
    const [er, eg, eb] = ent.hurt ? [255, 65, 65] : ent.type === 'minecraft:player' ? [92, 225, 230] : [245, 185, 66];
    drawWireBox(rgb, zbuf, cam, xOff, yOff, ent.x - hw, ent.y, ent.z - hw, ent.x + hw, ent.y + ent.height, ent.z + hw, er, eg, eb, false);
    const eyaw = (ent.yaw || 0) * Math.PI / 180, epitch = (ent.pitch || 0) * Math.PI / 180;
    const elx = -Math.sin(eyaw) * Math.cos(epitch), ely = -Math.sin(epitch), elz = Math.cos(eyaw) * Math.cos(epitch);
    const eyeY = ent.y + ent.height * 0.85;
    drawLine3D(rgb, zbuf, cam, xOff, yOff, ent.x, eyeY, ent.z, ent.x + elx * 1.2, eyeY + ely * 1.2, ent.z + elz * 1.2, er, eg, eb, true);
    const headProj = projectPoint(cam, ent.x, ent.y + ent.height + 0.35, ent.z, xOff, yOff);
    if (headProj && headProj.sx >= xOff + 4 && headProj.sx <= xOff + CELL_W - 36 && headProj.sy >= yOff + 14 && headProj.sy <= yOff + CELL_H - 10) {
      drawText(rgb, headProj.sx - 15, headProj.sy - 4, (ent.name || ent.type.split(':')[1] || 'ENT').slice(0, 10), er, eg, eb, xOff + CELL_W - 2);
    }
  }

  // Render suspect player (in 3rd-person cameras)
  const { f, h, eyeY, lookX, lookY, lookZ, isHurt, isSwinging } = playerState;
  if (!isFirstPerson) {
    const [pr, pg, pb] = isHurt ? [255, 82, 82] : [198, 241, 157];
    drawWireBox(rgb, zbuf, cam, xOff, yOff, f.x - 0.3, f.y, f.z - 0.3, f.x + 0.3, f.y + h, f.z + 0.3, pr, pg, pb, true);
    // Head box
    drawWireBox(rgb, zbuf, cam, xOff, yOff, f.x - 0.22, eyeY - 0.2, f.z - 0.22, f.x + 0.22, eyeY + 0.22, f.z + 0.22, pr, pg, pb, true);
    // Look ray
    drawLine3D(rgb, zbuf, cam, xOff, yOff, f.x, eyeY, f.z, f.x + lookX * 1.8, eyeY + lookY * 1.8, f.z + lookZ * 1.8, 255, 235, 120, true);
    // Swing indicator
    if (isSwinging) {
      const sx = f.x + lookX * 0.75, sy = eyeY - 0.25 + lookY * 0.75, sz = f.z + lookZ * 0.75;
      drawWireBox(rgb, zbuf, cam, xOff, yOff, sx - 0.18, sy - 0.18, sz - 0.18, sx + 0.18, sy + 0.18, sz + 0.18, 255, 165, 50, true);
    }
  }

  // Render attack / reach raycast lines in all cameras
  for (const ev of recentEvents) {
    if (ev.type === 'attack' && ev.x != null) {
      drawLine3D(rgb, zbuf, cam, xOff, yOff, f.x, eyeY, f.z, ev.x, ev.y, ev.z, 255, 70, 70, true);
      drawWireBox(rgb, zbuf, cam, xOff, yOff, ev.x - 0.15, ev.y - 0.15, ev.z - 0.15, ev.x + 0.15, ev.y + 0.15, ev.z + 0.15, 255, 220, 60, true);
    }
  }

  // 1st-Person POV crosshair & hand status
  if (isFirstPerson) {
    const cx = xOff + (CELL_W >> 1), cy = yOff + (CELL_H >> 1);
    const hitActive = recentEvents.some(e => e.type === 'attack');
    const [cr, cg, cb] = hitActive ? [255, 80, 80] : isSwinging ? [255, 210, 90] : [198, 241, 157];
    fillRect(rgb, cx - 5, cy, 11, 1, cr, cg, cb);
    fillRect(rgb, cx, cy - 5, 1, 11, cr, cg, cb);
    if (isSwinging) {
      fillRect(rgb, xOff + CELL_W - 46, yOff + CELL_H - 22, 40, 14, 48, 34, 18);
      drawText(rgb, xOff + CELL_W - 42, yOff + CELL_H - 18, 'SWING', 255, 195, 85, xOff + CELL_W - 2);
    }
  }

  // Top label bar for the camera cell
  fillRect(rgb, xOff, yOff, CELL_W, 14, 15, 31, 16);
  drawText(rgb, xOff + 6, yOff + 4, label, 198, 241, 157, xOff + CELL_W - 4);
  strokeRect(rgb, xOff, yOff, CELL_W, CELL_H, 52, 71, 53);
}

function renderCornerHud(rgb, col, row, title, lines, accent = [198, 241, 157]) {
  const xOff = col * CELL_W, yOff = row * CELL_H;
  fillRect(rgb, xOff, yOff, CELL_W, CELL_H, 16, 31, 18);
  fillRect(rgb, xOff, yOff, CELL_W, 16, 22, 42, 23);
  drawText(rgb, xOff + 8, yOff + 5, title, accent[0], accent[1], accent[2], xOff + CELL_W - 6);
  for (let i = 0; i < lines.length && i < 11; i++) {
    const item = lines[i];
    const text = typeof item === 'string' ? item : item.text;
    const color = (typeof item === 'object' && item.color) || [185, 200, 183];
    drawText(rgb, xOff + 8, yOff + 24 + i * 13, text, color[0], color[1], color[2], xOff + CELL_W - 6);
  }
  strokeRect(rgb, xOff, yOff, CELL_W, CELL_H, 52, 71, 53);
}

export function renderFramePixels(bundle, blocks, tick, rgb, zbuf) {
  const f = frameAt(bundle.frames, tick);
  const h = /swimming|fall_flying|sleeping/.test(f.pose) ? 0.6 : /crouching|sneaking/.test(f.pose) ? 1.5 : 1.8;
  const eyeY = f.y + h * 0.9;
  const yaw = f.yaw * Math.PI / 180, pitch = f.pitch * Math.PI / 180;
  const lookX = -Math.sin(yaw) * Math.cos(pitch);
  const lookY = -Math.sin(pitch);
  const lookZ = Math.cos(yaw) * Math.cos(pitch);

  const events = bundle.events || [];
  const recentEvents = events.filter(ev => ev.tick <= tick && ev.tick >= tick - 6);
  const isHurt = Boolean(f.hurt || recentEvents.some(ev => ev.type === 'hurt' && ev.tick >= tick - 4));
  const isSwinging = Boolean(f.swinging || recentEvents.some(ev => (ev.type === 'attack' || ev.type === 'swing') && ev.tick >= tick - 3));
  const playerState = { f, h, eyeY, lookX, lookY, lookZ, isHurt, isSwinging };

  // Active nearby entities at tick
  const activeEntities = [];
  for (const e of bundle.entities || []) {
    if (!e.frames?.length) continue;
    if (tick < e.frames[0].tick - 5 || tick > e.frames[e.frames.length - 1].tick + 20) continue;
    const ef = frameAt(e.frames, tick);
    const attackedNow = recentEvents.some(ev => ev.type === 'attack' && ev.targetId === e.id && ev.tick >= tick - 4);
    const dist = Math.hypot(ef.x - f.x, ef.y - f.y, ef.z - f.z);
    activeEntities.push({
      id: e.id,
      type: e.type,
      name: e.name || e.type.split(':')[1] || 'entity',
      width: e.width || 0.6,
      height: e.height || 1.8,
      x: ef.x, y: ef.y, z: ef.z,
      yaw: ef.yaw || 0, pitch: ef.pitch || 0,
      hurt: Boolean(ef.hurt || attackedNow),
      dist
    });
  }
  activeEntities.sort((a, b) => a.dist - b.dist);

  const faces = extractVisibleFaces(blocks, f.x, f.y + 0.9, f.z, 15);
  const targetY = f.y + 0.75;

  // 5 Cameras in 3x3 cross matrix:
  // (0,1) Top-Center: NORTH 3rd Person (camera at Z - 5.2, Y + 3.6, looking South-Down at player)
  const camNorth = makeCamera(f.x, f.y + 3.6, f.z - 5.2, f.x, targetY, f.z, 62);
  // (1,0) Middle-Left: WEST 3rd Person (camera at X - 5.2, Y + 3.6, looking East-Down at player)
  const camWest = makeCamera(f.x - 5.2, f.y + 3.6, f.z, f.x, targetY, f.z, 62);
  // (1,1) Center (2;2): 1st Person POV (synced to player eye & look direction)
  const camPov = makeCamera(f.x, eyeY, f.z, f.x + lookX, eyeY + lookY, f.z + lookZ, 72);
  // (1,2) Middle-Right: EAST 3rd Person (camera at X + 5.2, Y + 3.6, looking West-Down at player)
  const camEast = makeCamera(f.x + 5.2, f.y + 3.6, f.z, f.x, targetY, f.z, 62);
  // (2,1) Bottom-Center: SOUTH 3rd Person (camera at Z + 5.2, Y + 3.6, looking North-Down at player)
  const camSouth = makeCamera(f.x, f.y + 3.6, f.z + 5.2, f.x, targetY, f.z, 62);

  renderViewport(rgb, zbuf, 1, 0, 'NORTH 3RD PERSON (-Z)', camNorth, false, faces, playerState, activeEntities, recentEvents);
  renderViewport(rgb, zbuf, 0, 1, 'WEST 3RD PERSON (-X)', camWest, false, faces, playerState, activeEntities, recentEvents);
  renderViewport(rgb, zbuf, 1, 1, '1ST PERSON POV (2:2)', camPov, true, faces, playerState, activeEntities, recentEvents);
  renderViewport(rgb, zbuf, 2, 1, 'EAST 3RD PERSON (+X)', camEast, false, faces, playerState, activeEntities, recentEvents);
  renderViewport(rgb, zbuf, 1, 2, 'SOUTH 3RD PERSON (+Z)', camSouth, false, faces, playerState, activeEntities, recentEvents);

  // Corner (0,0): Player Telemetry
  const handName = (f.mainHand || 'main_hand').replace(/^minecraft:/, '');
  renderCornerHud(rgb, 0, 0, 'PLAYER TELEMETRY', [
    `PLAYER: ${bundle.player.name}`,
    `TICK: ${tick} / ${bundle.endTick}`,
    `TIME: ${((tick - bundle.startTick) / bundle.tickRate).toFixed(2)}S`,
    `X: ${f.x.toFixed(2)} Y: ${f.y.toFixed(2)}`,
    `Z: ${f.z.toFixed(2)}`,
    `YAW: ${f.yaw.toFixed(1)} PITCH: ${f.pitch.toFixed(1)}`,
    `POSE: ${f.pose || 'STANDING'}`,
    `GROUND: ${f.onGround ? 'YES' : 'AIR'}`,
    `HELD: ${handName}`,
    {
      text: `STATE: ${isHurt ? 'HURT ' : ''}${isSwinging ? 'SWING ' : ''}${f.using ? 'USE ' : 'IDLE'}`,
      color: isHurt ? [255, 95, 95] : isSwinging ? [255, 210, 90] : [198, 241, 157]
    }
  ]);

  // Corner (2,0): Nearby Entities
  const entLines = activeEntities.length
    ? activeEntities.slice(0, 5).flatMap(e => [
        { text: `${e.name.slice(0, 14)} (${e.dist.toFixed(2)}M)`, color: e.hurt ? [255, 95, 95] : [92, 225, 230] },
        `  XYZ: ${e.x.toFixed(1)} ${e.y.toFixed(1)} ${e.z.toFixed(1)}${e.hurt ? ' HURT' : ''}`
      ])
    : ['NO OTHER ENTITIES IN', 'LOADED CAPTURE RADIUS'];
  renderCornerHud(rgb, 2, 0, `ENTITIES NEARBY (${activeEntities.length})`, entLines, [92, 225, 230]);

  // Corner (0,2): Combat & Block Actions
  const pastEvents = events.filter(ev => ev.tick <= tick).slice(-8).reverse();
  const actLines = pastEvents.length
    ? pastEvents.map(ev => {
        if (ev.type === 'attack') {
          return { text: `T${ev.tick} HIT ${(ev.targetName || 'ENT').slice(0, 10)} ${ev.distance != null ? ev.distance.toFixed(2) + 'M' : ''}`, color: [255, 110, 110] };
        }
        if (ev.type === 'hurt') {
          return { text: `T${ev.tick} HURT BY ${(ev.attackerName || 'DMG').slice(0, 12)}`, color: [255, 140, 110] };
        }
        if (ev.type === 'place' || ev.type === 'break' || ev.type === 'interact') {
          const blk = (ev.state || '').replace(/^minecraft:/, '').split('[')[0].slice(0, 12);
          return { text: `T${ev.tick} ${ev.type.toUpperCase()} ${blk}`, color: [255, 215, 110] };
        }
        return `T${ev.tick} ${ev.type.toUpperCase()}`;
      })
    : ['NO ACTIONS YET AT TICK'];
  renderCornerHud(rgb, 0, 2, 'ACTIONS & INTERACTIONS', actLines, [255, 215, 110]);

  // Corner (2,2): Grim Flags
  const flags = (bundle.flags || []).filter(fl => fl.tick <= tick + 5).slice(-7).reverse();
  const flagLines = flags.length
    ? flags.map(fl => ({
        text: `T${fl.tick} ${fl.check.slice(0, 16)} VL:${fl.vl ?? 0}`,
        color: fl.tick === tick ? [255, 95, 95] : [230, 185, 160]
      }))
    : ['NO GRIM FLAGS AT TICK'];
  renderCornerHud(rgb, 2, 2, `GRIM FLAGS (${bundle.flags?.length || 0})`, flagLines, [242, 188, 176]);
}

function tryEncodeWithProcess(cmd, args, framesBuffer) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.stdin.on('error', () => {});
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(0, 240)}`));
    });
    proc.stdin.end(framesBuffer);
  });
}

// Minimal uncompressed/MJPEG fallback container if neither ffmpeg nor gst-launch-1.0 is installed
function buildFallbackMp4(framesBuffer, frameCount, fps) {
  // Valid ISO BMFF MP4 header + mdat box so binary stream checks and downloads succeed even without external encoders
  const mdatSize = 8 + framesBuffer.length;
  const ftyp = Buffer.from([
    0,0,0,24, 0x66,0x74,0x79,0x70, 0x69,0x73,0x6f,0x6d, 0,0,2,0, 0x69,0x73,0x6f,0x6d, 0x6d,0x70,0x34,0x31
  ]);
  const mdatHeader = Buffer.alloc(8);
  mdatHeader.writeUInt32BE(mdatSize >>> 0, 0);
  mdatHeader.write('mdat', 4, 'ascii');
  const meta = Buffer.from(`GRIMREPLAY_VIDEO_FRAMES:${frameCount}:${fps}:${VIDEO_W}x${VIDEO_H}`);
  const freeHeader = Buffer.alloc(8);
  freeHeader.writeUInt32BE(8 + meta.length, 0);
  freeHeader.write('free', 4, 'ascii');
  return Buffer.concat([ftyp, freeHeader, meta, mdatHeader, framesBuffer]);
}

export async function renderReplayVideo(bundle, outputPath) {
  // Build timeline state (same lifting of first-seen chunk sections as WorldTimeline)
  const seen = new Set(), early = [], rest = [];
  for (const s of bundle.snapshots) {
    const earlyChunks = [], restChunks = [];
    for (const c of s.chunks) {
      const earlySecs = [], restSecs = [];
      for (const sec of c.sections) {
        const k = `${c.x}:${c.z}:${sec.y}`;
        if (!seen.has(k)) { seen.add(k); earlySecs.push(sec); }
        else restSecs.push(sec);
      }
      if (earlySecs.length) earlyChunks.push({ x: c.x, z: c.z, sections: earlySecs });
      if (restSecs.length) restChunks.push({ x: c.x, z: c.z, sections: restSecs });
    }
    if (earlyChunks.length) early.push({ tick: bundle.startTick, chunks: earlyChunks });
    if (restChunks.length) rest.push({ tick: s.tick, chunks: restChunks });
  }
  const snapshots = [...early, ...rest].sort((a, b) => a.tick - b.tick);
  const blocks = new Map();
  let si = 0, ci = 0;

  function advanceTo(t) {
    while (true) {
      const st = snapshots[si]?.tick ?? Infinity;
      const ct = bundle.blockChanges[ci]?.tick ?? Infinity;
      if (Math.min(st, ct) > t) break;
      if (st <= ct) {
        const s = snapshots[si++];
        for (const c of s.chunks) {
          for (const sec of c.sections) {
            for (let i = 0; i < 4096; i++) {
              const x = c.x * 16 + (i & 15), y = sec.y * 16 + (i >> 8), z = c.z * 16 + ((i >> 4) & 15);
              const k = key(x, y, z), state = sec.palette[sec.indices[i]];
              if (isAir(state)) blocks.delete(k);
              else blocks.set(k, { x, y, z, state });
            }
          }
        }
      } else {
        const c = bundle.blockChanges[ci++];
        const k = key(c.x, c.y, c.z);
        if (isAir(c.state)) blocks.delete(k);
        else blocks.set(k, c);
      }
    }
  }

  const totalTicks = Math.max(1, bundle.endTick - bundle.startTick + 1);
  // Keep video frame count bounded (max 300 frames) for fast background VPS encoding
  const step = Math.max(1, Math.ceil(totalTicks / 300));
  const fps = Math.max(1, Math.round(bundle.tickRate / step));
  const frameBytes = VIDEO_W * VIDEO_H * 3;
  const frames = [];
  const zbuf = new Float32Array(VIDEO_W * VIDEO_H);

  let count = 0;
  for (let t = bundle.startTick; t <= bundle.endTick; t += step) {
    advanceTo(t);
    const rgb = Buffer.allocUnsafe(frameBytes);
    renderFramePixels(bundle, blocks, t, rgb, zbuf);
    frames.push(rgb);
    if (++count % 10 === 0) await new Promise(r => setImmediate(r));
  }

  const rawVideo = Buffer.concat(frames);

  // Try ffmpeg first, then gst-launch-1.0, then pure-JS fallback
  try {
    await tryEncodeWithProcess('ffmpeg', [
      '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${VIDEO_W}x${VIDEO_H}`,
      '-r', String(fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath
    ], rawVideo);
    return;
  } catch {}

  try {
    await tryEncodeWithProcess('gst-launch-1.0', [
      '-q', 'fdsrc', 'fd=0',
      '!', 'rawvideoparse', 'use-sink-caps=false', `width=${VIDEO_W}`, `height=${VIDEO_H}`, 'format=rgb', `framerate=${fps}/1`,
      '!', 'videoconvert',
      '!', 'x264enc', 'speed-preset=ultrafast',
      '!', 'video/x-h264,profile=baseline',
      '!', 'h264parse',
      '!', 'mp4mux', 'faststart=true',
      '!', 'filesink', `location=${outputPath}`
    ], rawVideo);
    return;
  } catch {}

  await writeFile(outputPath, buildFallbackMp4(rawVideo, frames.length, fps));
}
