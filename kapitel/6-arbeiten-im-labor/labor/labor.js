(() => {
  const canvas = document.getElementById("lab");
  const ctx = canvas.getContext("2d");
  const observeEl = document.getElementById("observe");
  const SUBSTANCES = window.SUBSTANCES;
  const TOOLS = window.TOOLS;

  const MAX = 6000;
  const MAX_PER_GLASS = 900;
  const ROOM = 22;
  const TEMP_MAX = 4000;
  const LETTERS = "ABCDEF";

  const state = {
    particles: [],
    bonds: [],
    nextId: 1,
    selected: "A",
    selectedTo: null,
    tool: "pointer",
    pointer: { x: 0, y: 0, down: false },
    magnetGrab: [],
    magnetJob: null,
    stir: null,
    filter: null,
    funnelOn: null,
    decant: null,
    distill: null,
    extractWait: null,
    cache: {},
    sayUntil: 0,
    sayText: "",
    t: 0,
    W: 800,
    H: 500,
  };

  const vessels = {};
  vessels.A = makeVessel("A", "Becherglas A");

  function makeVessel(id, label) {
    return {
      id,
      label,
      x: 0,
      y: 0,
      w: 156,
      h: 214,
      temp: ROOM,
      heating: false,
      thermo: false,
      tilt: 0,
    };
  }

  function vesselList() {
    return Object.values(vessels);
  }

  function vesselIds() {
    return Object.keys(vessels);
  }

  function inner(v) {
    const tilt = v.tilt || 0;
    return {
      left: v.x + 14 + tilt * 18,
      right: v.x + v.w - 14 + tilt * 8,
      top: v.y + 28,
      bottom: v.y + v.h - 10,
    };
  }

  function layout() {
    const W = state.W;
    const H = state.H;
    const ids = vesselIds();
    const n = Math.max(1, ids.length);
    const w = Math.min(150, (W - 28) / (n + 0.35));
    const h = Math.min(228, H * 0.58);
    const gap = Math.max(18, Math.min(36, (W - n * w) / (n + 1)));
    const total = n * w + (n - 1) * gap;
    let x0 = Math.max(12, (W - total) / 2);
    const y = H * 0.24;
    ids.forEach((id) => {
      const v = vessels[id];
      const old = { x: v.x, y: v.y, w: v.w, h: v.h };
      v.x = x0;
      v.y = y;
      v.w = w;
      v.h = h;
      if (old.w) relocateParticles(id, old, v);
      x0 += w + gap;
    });
  }

  function relocateParticles(id, oldV, newV) {
    if (!oldV.w || oldV.w < 8) return;
    particlesIn(id).forEach((p) => {
      p.x = newV.x + ((p.x - oldV.x) / oldV.w) * newV.w;
      p.y = newV.y + ((p.y - oldV.y) / oldV.h) * newV.h;
    });
  }

  function addVessel() {
    if (vesselIds().length >= 6) {
      say("Kein Platz mehr für ein weiteres Glas — zuerst eines leeren.", 2.8);
      return null;
    }
    const id = LETTERS[vesselIds().length];
    vessels[id] = makeVessel(id, `Becherglas ${id}`);
    layout();
    return id;
  }

  function ensureTarget(from) {
    if (state.selectedTo && state.selectedTo !== from && vessels[state.selectedTo]) {
      return state.selectedTo;
    }
    const empty = vesselIds().find((id) => id !== from && particlesIn(id).length === 0);
    if (empty) return empty;
    return addVessel();
  }

  function specOf(p) {
    return SUBSTANCES[p.type];
  }

  function inVessel(v, x, y) {
    const b = inner(v);
    return x >= b.left - 8 && x <= b.right + 8 && y >= v.y - 20 && y <= b.bottom + 12;
  }

  function vesselAt(x, y) {
    for (const v of vesselList()) {
      if (inVessel(v, x, y)) return v.id;
    }
    return null;
  }

  function particlesIn(id) {
    const c = state.cache[id];
    if (c) return c.all;
    return state.particles.filter((p) => p.vessel === id);
  }

  function rebuildCache() {
    const cache = {};
    vesselIds().forEach((id) => {
      cache[id] = { all: [], liquids: [], solids: [], types: Object.create(null), surfaceY: 0 };
    });
    state.particles.forEach((p) => {
      const c = cache[p.vessel];
      if (!c) return;
      c.all.push(p);
      c.types[p.type] = true;
      if (p.phase === "liquid" || p.phase === "dissolved") c.liquids.push(p);
      else if (p.phase === "solid" || p.phase === "char") c.solids.push(p);
    });
    state.cache = cache;
  }

  function liquidTop(id) {
    const v = vessels[id];
    if (!v) return 0;
    const c = state.cache[id];
    if (c && c.surfaceY) return c.surfaceY;
    const b = inner(v);
    const liquids = (c && c.liquids) || particlesIn(id).filter((p) => p.phase === "liquid" || p.phase === "dissolved");
    const area = Math.max(1, (b.right - b.left) * 0.55);
    const fill = liquids.reduce((s, p) => s + p.r * p.r, 0) / area;
    const h = Math.min(b.bottom - b.top - 8, 18 + fill * 140);
    return b.bottom - h;
  }

  function say(text, sec) {
    state.sayText = text;
    state.sayUntil = state.t + (sec || 3.2);
    observeEl.textContent = text;
  }

  function spawnParticle(type, vessel, x, y, extras) {
    const inGlass = particlesIn(vessel).length;
    if (inGlass >= MAX_PER_GLASS || state.particles.length >= MAX) {
      say("Dieses Glas ist voll — zuerst etwas entfernen oder in ein neues Glas filtrieren.", 2.5);
      return null;
    }
    const spec = SUBSTANCES[type];
    const p = {
      id: state.nextId++,
      type,
      vessel,
      x,
      y,
      vx: (Math.random() - 0.5) * 20,
      vy: Math.random() * 8,
      r: spec.r * (0.88 + Math.random() * 0.24),
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 1.2,
      phase: spec.phase,
      seed: Math.random() * 1000,
      dissolve: 0,
      adsorbedTo: null,
      offX: 0,
      offY: 0,
      ...extras,
    };
    state.particles.push(p);
    const c = state.cache[vessel];
    if (c) {
      c.all.push(p);
      c.types[type] = true;
      if (p.phase === "liquid" || p.phase === "dissolved") c.liquids.push(p);
      else if (p.phase === "solid" || p.phase === "char") c.solids.push(p);
    }
    return p;
  }

  function bond(a, b, k) {
    const rest = Math.hypot(a.x - b.x, a.y - b.y);
    state.bonds.push({ a: a.id, b: b.id, rest: Math.max(rest, a.r + b.r), k: k || 48 });
  }

  function addSubstance(type, vesselId, amountScale, quiet) {
    const spec = SUBSTANCES[type];
    const v = vessels[vesselId];
    if (!spec || !v) return;
    if (spec.mixture) {
      spec.mixture.forEach((part) => addSubstance(part.type, vesselId, part.scale, true));
      if (!quiet) say(`${spec.name} ins ${v.label} gegeben — Fetttröpfchen im Wasser (Emulsion).`, 2.4);
      return;
    }
    const b = inner(v);
    const n = Math.round(spec.count * (amountScale || 1));
    const clusterN = spec.cluster || 1;
    let made = 0;
    while (made < n) {
      const take = Math.min(clusterN, n - made);
      const cx = b.left + 16 + Math.random() * (b.right - b.left - 32);
      const liquidish = spec.phase === "liquid" || spec.phase === "dissolved";
      const cy = liquidish
        ? b.top + (b.bottom - b.top) * 0.42 + Math.random() * (b.bottom - b.top) * 0.42
        : b.top + 24 + Math.random() * 70;
      const group = [];
      for (let i = 0; i < take; i++) {
        let px = cx;
        let py = cy;
        if (spec.id === "salt" && take >= 4) {
          const col = i % 3;
          const row = Math.floor(i / 3);
          px = cx + (col - 1) * spec.r * 1.85;
          py = cy + row * spec.r * 1.85;
        } else if (take > 1) {
          const ang = (i / take) * Math.PI * 2 - Math.PI / 2;
          const rad = spec.r * 1.2;
          px = cx + Math.cos(ang) * rad;
          py = cy + Math.sin(ang) * rad;
        }
        const p = spawnParticle(type, vesselId, px, py);
        if (!p) return;
        if (spec.shape === "crystal") p.rot = 0;
        group.push(p);
      }
      if (take > 1) {
        for (let i = 0; i < group.length; i++) {
          bond(group[i], group[(i + 1) % group.length], spec.id === "sugar" ? 70 : 55);
          if (take > 3 && i + 2 < group.length) bond(group[i], group[i + 2], 36);
        }
      }
      made += take;
    }
    if (!quiet) say(`${spec.name} ins ${v.label} gegeben.`, 1.6);
  }

  function findP(id) {
    return state.particles.find((p) => p.id === id);
  }

  function breakBondsOf(id) {
    state.bonds = state.bonds.filter((b) => b.a !== id && b.b !== id);
  }

  function solventPresent(p) {
    const spec = specOf(p);
    if (!spec.solubleIn.length) return false;
    const types = state.cache[p.vessel] && state.cache[p.vessel].types;
    if (!types) return false;
    return spec.solubleIn.some((t) => types[t]);
  }

  function solventPower(soluteType, solventType) {
    if (soluteType === "sugar" && solventType === "alcohol") return 1;
    if (soluteType === "fat" && solventType === "gasoline") return 1.15;
    return 1.35;
  }

  function remainingDissolveSlots(vesselId, soluteType) {
    const spec = SUBSTANCES[soluteType];
    if (!spec || !spec.solubleIn.length) return 0;
    let cap = 0;
    let used = 0;
    particlesIn(vesselId).forEach((q) => {
      if (q.type === soluteType && q.phase === "dissolved") used++;
      if (
        (q.phase === "liquid" || q.phase === "dissolved") &&
        spec.solubleIn.includes(q.type)
      ) {
        cap += solventPower(soluteType, q.type);
      }
    });
    return cap - used;
  }

  function updateDissolve(p, dt, v) {
    const spec = specOf(p);
    if (p.phase === "dissolved") return;
    if (!spec.solubleIn.length) return;
    if (!solventPresent(p)) return;
    if (remainingDissolveSlots(p.vessel, p.type) <= 0) {
      if (state.t >= state.sayUntil && spec.id === "sugar") {
        say("Zu wenig Lösungsmittel — nicht aller Zucker löst sich. Mehr Alkohol oder Wasser nachfüllen.", 3);
      }
      return;
    }
    const stir = state.stir && state.stir.vessel === p.vessel ? 2.6 : 1;
    const heat = 0.7 + (v.temp - ROOM) / 90;
    const types = state.cache[p.vessel] && state.cache[p.vessel].types;
    const alcOnly = !!(types && types.alcohol && !types.water);
    p.dissolve += dt * 0.55 * stir * heat * (alcOnly ? 0.7 : 1);
    if (p.dissolve > 1) {
      if (remainingDissolveSlots(p.vessel, p.type) <= 0) return;
      p.phase = "dissolved";
      p.r = Math.max(2.4, spec.r * 0.55);
      breakBondsOf(p.id);
      if (spec.id === "sugar") {
        const inAlc = types && types.alcohol && !types.water;
        const inWater = types && types.water && !types.alcohol;
        say(
          inAlc
            ? "Zuckerklümpchen zerfallen — der Zucker löst sich im Alkohol."
            : inWater
              ? "Zuckerklümpchen zerfallen — der Zucker löst sich im Wasser."
              : "Zuckerklümpchen zerfallen — der Zucker löst sich.",
          3
        );
      }
      if (spec.id === "salt") say("Salzkristalle zerfallen — das Salz löst sich im Wasser.", 3);
      if (spec.id === "fat") say("Fett löst sich im Benzin — die gelbe Schicht ist der Extrakt.", 3.2);
    }
  }

  function updateMelt(p, v) {
    const spec = specOf(p);
    if (p.phase === "dissolved" || p.phase === "gas" || p.phase === "char") return;
    const canMelt = spec.melt != null && (spec.boil == null || spec.melt < spec.boil);
    if (v.temp >= spec.melt && p.phase === "solid" && canMelt) {
      p.phase = "liquid";
      p.r = spec.liquidR || Math.max(2.8, spec.r * 0.48);
      if (spec.decompose) p.caramel = true;
      breakBondsOf(p.id);
      if (spec.id === "wax") say("Wachs schmilzt — kleine flüssige Teilchen. Beim Abkühlen wird es wieder fest.", 3.2);
      else if (spec.id === "sugar") say("Zucker schmilzt und karamellisiert — kleine flüssige Teilchen.", 3.2);
      else if (spec.melt >= 100) say(`${spec.name} schmilzt bei ${spec.melt} °C.`, 2.8);
    } else if (
      spec.phase === "solid" &&
      p.phase === "liquid" &&
      !p.charred &&
      v.temp < spec.melt - 8
    ) {
      p.phase = "solid";
      if (!p.caramel) p.r = spec.r;
    }
  }

  function toChar(p) {
    p.phase = "char";
    p.stuck = true;
    p.caramel = false;
    p.charred = true;
    p.r = 2.3;
    p.vx = 0;
    p.vy = 0;
    breakBondsOf(p.id);
  }

  function updateDecompose(dt) {
    vesselList().forEach((v) => {
      const cand = particlesIn(v.id).filter((p) => {
        const spec = specOf(p);
        if (!spec.decompose || p.phase === "char" || p.phase === "gas") return false;
        return v.temp >= spec.decompose;
      });
      if (!cand.length) return;
      v.charAcc = (v.charAcc || 0) + dt * Math.min(10, 2 + cand.length * 0.1);
      while (v.charAcc >= 1 && cand.length) {
        v.charAcc -= 1;
        toChar(cand.pop());
      }
      say("Zucker zersetzt sich — schwarze Kruste am Boden. Das geht nicht zurück, der Rest klebt fest.", 3.6);
    });
  }

  function charLayerHeight(id) {
    const n = particlesIn(id).filter((p) => p.phase === "char").length;
    if (!n) return 0;
    return Math.min(26, 5 + n * 0.7);
  }

  function drawCharLayer(v) {
    const h = charLayerHeight(v.id);
    if (h <= 0) return;
    const b = inner(v);
    const cx = (b.left + b.right) / 2;
    ctx.fillStyle = "rgba(12,8,6,.94)";
    ctx.beginPath();
    ctx.ellipse(cx, b.bottom - h * 0.22, (b.right - b.left) * 0.48, h * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(6,4,3,.88)";
    ctx.beginPath();
    ctx.ellipse(cx, b.bottom - 1.5, (b.right - b.left) * 0.46, Math.max(3.5, h * 0.28), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateCharStick() {
    vesselIds().forEach((id) => {
      const v = vessels[id];
      const layer = charLayerHeight(id);
      if (!v || layer <= 0) return;
      const b = inner(v);
      particlesIn(id).forEach((p) => {
        if (p.phase === "gas" || p.phase === "char") return;
        if (p.phase === "liquid" && (p.type === "water" || p.type === "alcohol")) return;
        if (p.y > b.bottom - layer - p.r * 0.6) {
          p.stuck = true;
          p.vx = 0;
          p.vy = 0;
        }
      });
    });
  }

  function boilingKind(id) {
    const list = particlesIn(id).filter((p) => {
      if (p.phase !== "liquid") return false;
      const spec = specOf(p);
      if (spec.decompose || spec.boil == null) return false;
      return true;
    });
    if (!list.length) return null;
    let best = null;
    list.forEach((p) => {
      const bp = specOf(p).boil;
      if (!best || bp < best.bp) best = { type: p.type, bp, name: specOf(p).name };
    });
    return best;
  }

  function boilOff(id, kind, dt) {
    const v = vessels[id];
    const cand = particlesIn(id).filter((p) => p.type === kind.type && p.phase === "liquid");
    v.boilAcc = (v.boilAcc || 0) + dt * Math.min(14, 2.2 + cand.length * 0.05);
    while (v.boilAcc >= 1 && cand.length) {
      v.boilAcc -= 1;
      const p = cand.pop();
      p.phase = "gas";
      p.vy = -40 - Math.random() * 30;
      p.r = specOf(p).r * 1.35;
      if (state.distill && state.distill.from === id) {
        p.vessel = "vapor";
        p.pathT = 0;
      }
    }
    if (kind.type === "alcohol") {
      say(
        state.distill && state.distill.from === id
          ? "Alkohol siedet — Dampf geht in den Kühler, Temperatur bleibt bei 78 °C."
          : "Alkohol siedet und dampft in die Luft (78 °C).",
        2.8
      );
    } else if (kind.type === "water") {
      say(
        state.distill && state.distill.from === id
          ? "Wasser siedet — Dampf geht in den Kühler, Temperatur bleibt bei 100 °C."
          : "Wasser siedet und dampft in die Luft (100 °C).",
        2.8
      );
    } else if (kind.type === "gasoline") {
      say(
        state.distill && state.distill.from === id
          ? "Benzin siedet — Dampf geht in den Kühler, Fett bleibt zurück."
          : "Benzin verdampft — das Fett bleibt als Fleck zurück.",
        3.2
      );
    } else say(`${kind.name} siedet bei ${kind.bp} °C — die Temperatur bleibt stehen.`, 2.8);
  }

  function crystallizeIfDry(id) {
    const list = particlesIn(id);
    const liquid = list.filter((p) => p.phase === "liquid").length;
    if (liquid > 3) return;
    list.forEach((p) => {
      if (p.phase === "dissolved" && (p.type === "salt" || p.type === "sugar")) {
        p.phase = "solid";
        p.r = specOf(p).r;
        p.dissolve = 0;
      }
      if (p.phase === "dissolved" && p.type === "fat") {
        p.phase = "liquid";
        p.r = specOf(p).r;
      }
    });
  }

  function updateHeat(dt) {
    vesselList().forEach((v) => {
      if (v.heating) {
        const boil = boilingKind(v.id);
        if (boil && v.temp >= boil.bp - 0.5) {
          v.temp = boil.bp;
          boilOff(v.id, boil, dt);
        } else {
          let rate = 14 + Math.max(0, v.temp) * 0.12;
          if (v.temp > 120) rate = 8 + (v.temp - 120) * 0.03;
          v.temp = Math.min(TEMP_MAX, v.temp + dt * rate);
        }
      } else if (v.temp > ROOM) {
        v.temp += (ROOM - v.temp) * dt * 0.18;
        if (v.temp < ROOM + 0.3) v.temp = ROOM;
      }
      crystallizeIfDry(v.id);
    });
  }

  function distillPair() {
    if (!state.distill) return null;
    const a = vessels[state.distill.from];
    const b = vessels[state.distill.to];
    if (!a || !b) return null;
    return { a, b };
  }

  function distillPath(t) {
    const pair = distillPair();
    if (!pair) return { x: 0, y: 0, condensing: true };
    const { a, b } = pair;
    const x0 = a.x + a.w * 0.55;
    const y0 = a.y + 8;
    const x1 = a.x + a.w * 0.55;
    const y1 = a.y - 52;
    const x2 = b.x + b.w * 0.45;
    const y2 = b.y - 52;
    const x3 = b.x + b.w * 0.45;
    const y3 = b.y + 24;
    const pts = [
      [x0, y0],
      [x1, y1],
      [x2, y2],
      [x3, y3],
    ];
    const seg = Math.min(2.999, t * 3);
    const i = Math.floor(seg);
    const f = seg - i;
    return {
      x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
      y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      condensing: i >= 2,
    };
  }

  function updateVapor(dt) {
    state.particles.forEach((p) => {
      if (p.phase !== "gas") return;
      if (p.vessel === "vapor") {
        p.pathT = (p.pathT || 0) + dt * 0.55;
        const pos = distillPath(Math.min(1, p.pathT));
        p.x = pos.x + (Math.random() - 0.5) * 6;
        p.y = pos.y + (Math.random() - 0.5) * 6;
        if (pos.condensing || p.pathT >= 1) {
          p.phase = "liquid";
          p.vessel = state.distill ? state.distill.to : "A";
          p.r = specOf(p).r;
          p.vx = 0;
          p.vy = 20;
          say(`Dampf wird im Kühler wieder flüssig — Destillat in ${vessels[p.vessel]?.label || "Becherglas B"}.`, 3);
        }
        return;
      }
      p.vy -= 80 * dt;
      p.y += p.vy * dt;
      if (p.y < vessels[p.vessel]?.y - 80 || p.y < 8) {
        p.dead = true;
        say("Dampf entweicht. Gelöste Feststoffe bleiben zurück (Eindampfen).", 3);
      }
    });
    state.particles = state.particles.filter((p) => !p.dead);
  }

  function updateAdsorb() {
    const byVessel = {};
    state.particles.forEach((p) => {
      if (!byVessel[p.vessel]) byVessel[p.vessel] = [];
      byVessel[p.vessel].push(p);
    });
    Object.values(byVessel).forEach((list) => {
      const coals = list.filter((p) => specOf(p).adsorbs);
      if (!coals.length) return;
      list.forEach((p) => {
        const spec = specOf(p);
        if (!spec.adsorbedBy.includes("charcoal")) return;
        if (p.adsorbedTo) {
          const host = findP(p.adsorbedTo);
          if (!host) {
            p.adsorbedTo = null;
            return;
          }
          p.x = host.x + p.offX;
          p.y = host.y + p.offY;
          p.vessel = host.vessel;
          p.vx = host.vx;
          p.vy = host.vy;
          return;
        }
        coals.forEach((c) => {
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < c.r + 16) {
            p.adsorbedTo = c.id;
            p.offX = (p.x - c.x) * 0.4;
            p.offY = (p.y - c.y) * 0.4;
            p.phase = "solid";
            say("Tinte bleibt an der Aktivkohle hängen (Adsorbieren).", 3);
          }
        });
      });
    });
  }

  function updateMagnet(dt) {
    const job = state.magnetJob;
    if (!job) return;
    job.t += dt;
    const from = vessels[job.from];
    const to = vessels[job.to];
    if (!from || !to) {
      state.magnetJob = null;
      return;
    }
    if (job.phase === "attract") {
      job.x = from.x + from.w * 0.5;
      job.y = from.y - 8;
      particlesIn(job.from).forEach((p) => {
        if (!specOf(p).magnetic) return;
        p.vx += ((job.x - p.x) * 16 - p.vx) * dt * 6;
        p.vy += ((job.y + 20 - p.y) * 16 - p.vy) * dt * 6;
        if (Math.hypot(p.x - job.x, p.y - (job.y + 18)) < 26 && !state.magnetGrab.includes(p.id)) {
          state.magnetGrab.push(p.id);
          p.vessel = "magnet";
        }
      });
      if (job.t > 1.7) {
        particlesIn(job.from).forEach((p) => {
          if (!specOf(p).magnetic) return;
          if (!state.magnetGrab.includes(p.id)) state.magnetGrab.push(p.id);
          p.vessel = "magnet";
        });
        job.phase = "carry";
        job.t = 0;
        if (state.magnetGrab.length) say("Eisenpulver klebt am Magnet — Aluminium bleibt liegen.", 3);
        else say("Kein magnetischer Stoff in diesem Glas.", 2.4);
      }
    } else if (job.phase === "carry") {
      const tx = to.x + to.w * 0.5;
      const ty = to.y - 8;
      job.x += (tx - job.x) * Math.min(1, dt * 4);
      job.y += (ty - job.y) * Math.min(1, dt * 4);
      if (job.t > 1.15) {
        state.magnetGrab.forEach((id) => {
          const p = findP(id);
          if (!p) return;
          p.vessel = job.to;
          p.x = to.x + to.w * 0.5 + (Math.random() - 0.5) * 28;
          p.y = to.y + 40;
          p.vy = 30;
        });
        state.magnetGrab = [];
        state.magnetJob = null;
        if (job.hadIron !== false) say(`Eisen liegt in ${to.label}.`, 2.6);
      }
    }
    state.magnetGrab.forEach((id, i) => {
      const p = findP(id);
      if (!p || !job) return;
      p.x = job.x + Math.cos(i * 1.1) * 8;
      p.y = job.y + 22 + Math.sin(i * 1.1) * 8;
      p.vx = 0;
      p.vy = 0;
      p.vessel = "magnet";
    });
  }

  function funnelAnchor() {
    const id = (state.filter && state.filter.to) || state.funnelOn;
    const v = vessels[id];
    if (!v) return null;
    return { x: v.x + v.w * 0.5, y: v.y - 6, v };
  }

  function updateStir(dt) {
    if (!state.stir) return;
    state.stir.t -= dt;
    if (state.stir.t <= 0) {
      state.stir = null;
      return;
    }
    const v = vessels[state.stir.vessel];
    const b = inner(v);
    const cx = (b.left + b.right) / 2;
    const cy = (liquidTop(v.id) + b.bottom) / 2;
    particlesIn(v.id).forEach((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      p.vx += -dy * 6 * dt * 18;
      p.vy += dx * 6 * dt * 18;
    });
  }

  function updateFilter(dt) {
    if (!state.filter) return;
    const f = state.filter;
    f.t += dt;
    const from = f.from;
    const to = f.to;
    const anchor = funnelAnchor();
    const funnelX = anchor ? anchor.x : 0;
    const funnelY = anchor ? anchor.y + 14 : 0;
    if (!f.started) {
      f.started = true;
      state.funnelOn = to;
      particlesIn(from).forEach((p) => {
        p.vessel = "transit";
        p.pass = canPassFilter(p);
      });
    }
    const moving = state.particles.filter((p) => p.vessel === "transit");
    moving.forEach((p) => {
      p.x += (funnelX - p.x) * dt * 3.2;
      p.y += (funnelY - p.y) * dt * 2.4;
      if (Math.hypot(p.x - funnelX, p.y - funnelY) < 22) {
        if (p.pass) {
          p.vessel = to;
          p.x = vessels[to].x + vessels[to].w * 0.5 + (Math.random() - 0.5) * 30;
          p.y = vessels[to].y + 40;
          p.vy = 40;
        } else {
          p.vessel = "funnel";
          p.x = funnelX + (Math.random() - 0.5) * 18;
          p.y = funnelY + 10 + Math.random() * 24;
        }
      }
    });
    if (f.t > 2.8 || moving.length === 0) {
      state.particles.forEach((p) => {
        if (p.vessel === "transit") p.vessel = p.pass ? to : "funnel";
      });
      state.filter = null;
      const n = state.particles.filter((p) => p.vessel === "funnel").length;
      if (!n) state.funnelOn = null;
      say(
        n
          ? `Filtrat in ${vessels[to].label}. Rückstand im Filter — Filter antippen: neues Glas für den Rückstand.`
          : `Alles ist durch den Filter in ${vessels[to].label} gelaufen.`,
        3.5
      );
    }
  }

  function canPassFilter(p) {
    if (p.adsorbedTo || p.stuck || p.phase === "char") return false;
    if (p.phase === "dissolved" || p.phase === "liquid" || p.phase === "gas") return true;
    return !!specOf(p).passesFilter;
  }

  function updateDecant(dt) {
    if (!state.decant) return;
    const d = state.decant;
    d.t += dt;
    const from = vessels[d.from];
    const to = vessels[d.to];
    from.tilt = Math.min(0.9, d.t * 1.4);
    const targetX = to.x + 20;
    const targetY = to.y + 36;
    particlesIn(from.id).forEach((p) => {
      if (!canDecant(p, from.id)) return;
      p.vessel = "transit";
      p.x += (targetX - p.x) * dt * 2.5;
      p.y += (targetY - p.y) * dt * 1.6;
    });
    state.particles.forEach((p) => {
      if (p.vessel !== "transit") return;
      p.x += (targetX - p.x) * dt * 2.5;
      p.y += (targetY - p.y) * dt * 1.6;
      if (Math.hypot(p.x - targetX, p.y - targetY) < 36) {
        p.vessel = to.id;
        p.vy = 30;
      }
    });
    if (d.t > 2.6) {
      state.particles.forEach((p) => {
        if (p.vessel === "transit") p.vessel = to.id;
      });
      from.tilt = 0;
      const extracted = d.mode === "extract";
      state.decant = null;
      say(
        extracted
          ? `Extrakt in ${to.label} — gelbe Schicht (Fett in Benzin). Die wässrige Milch bleibt zurück. Benzin erhitzen: Fettfleck.`
          : "Flüssigkeit (und was schwimmt) wurde abgegossen — Dekantieren.",
        3.4
      );
    }
  }

  function canDecant(p, fromId) {
    if (state.decant && state.decant.mode === "extract") return canExtract(p);
    if (p.phase === "char" || p.stuck) return false;
    if (p.phase === "liquid" || p.phase === "dissolved" || p.phase === "gas") return true;
    const spec = specOf(p);
    if (spec.density < 0.5) return true;
    if (p.phase === "liquid" && spec.density < 1) return true;
    const top = liquidTop(fromId);
    if (spec.density < 1 && p.y < top + 14) return true;
    return false;
  }

  function canExtract(p) {
    if (p.stuck || p.phase === "char" || p.phase === "gas") return false;
    if (p.type === "gasoline") return true;
    if (p.type === "fat" && p.phase === "dissolved") return true;
    return false;
  }

  function vesselHasType(id, type) {
    const types = state.cache[id] && state.cache[id].types;
    if (types && types[type]) return true;
    return particlesIn(id).some((p) => p.type === type);
  }

  function mixesInVessel(p, vesselId) {
    const spec = specOf(p);
    const partners = spec.mixesWith;
    if (!partners || !partners.length) return false;
    if (p.phase !== "liquid" && p.phase !== "dissolved") return false;
    const types = state.cache[vesselId] && state.cache[vesselId].types;
    if (!types) return false;
    return partners.some((t) => types[t]);
  }

  function mixDensity(p, vesselId) {
    const spec = specOf(p);
    const types = state.cache[vesselId] && state.cache[vesselId].types;
    const gasD = SUBSTANCES.gasoline ? SUBSTANCES.gasoline.density : 0.74;
    if (p.phase === "dissolved") {
      if (spec.solubleIn && spec.solubleIn.includes("gasoline") && types && types.gasoline) return gasD;
      return 1;
    }
    if (mixesInVessel(p, vesselId)) {
      if (p.type === "gasoline" || (spec.mixesWith && spec.mixesWith.includes("gasoline"))) return gasD;
      return 1;
    }
    if (spec.emulsifyIn && types && spec.emulsifyIn.some((t) => types[t])) {
      if (!(types.gasoline && spec.solubleIn && spec.solubleIn.includes("gasoline") && p.phase === "dissolved")) {
        return 1;
      }
    }
    return spec.density;
  }

  function brownianStrength(p, temp) {
    const tK = Math.min(3.2, 0.45 + temp / 70);
    if (p.phase === "solid") return 0.2 * tK;
    if (p.phase === "gas") return 10 * tK;
    return 5.5 * tK;
  }

  function applyPhysics(dt) {
    const g = 1400;
    state.particles.forEach((p) => {
      if (p.vessel === "magnet" || p.vessel === "vapor" || p.vessel === "transit") return;
      if (p.adsorbedTo) return;
      const v = vessels[p.vessel];
      if (!v) {
        if (p.vessel === "funnel") {
          p.vy += g * 0.2 * dt;
          p.vx *= 0.88;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const fx = funnelAnchor()?.x ?? p.x;
          const fy = (funnelAnchor()?.y ?? p.y) + 18;
          p.x += (fx - p.x) * dt * 2;
          p.y = Math.min(fy + 48, Math.max(fy, p.y));
          return;
        }
        return;
      }
      const b = inner(v);
      if (p.phase === "char" || p.stuck) {
        const layer = p.phase === "char" ? charLayerHeight(v.id) : 0;
        p.vx = 0;
        p.vy = 0;
        if (p.x < b.left + p.r) p.x = b.left + p.r;
        if (p.x > b.right - p.r) p.x = b.right - p.r;
        p.y = Math.min(b.bottom - p.r * 0.45, Math.max(b.bottom - (layer || 8) - p.r, p.y));
        if (p.y > b.bottom - p.r * 0.45) p.y = b.bottom - p.r * 0.45;
        return;
      }
      const liquidish = p.phase === "liquid" || p.phase === "dissolved";
      const dens = specOf(p).density;

      if (p.phase === "gas") {
        p.vy -= 110 * dt;
      } else {
        p.vy += g * dt;
      }

      const drag = p.phase === "gas" ? 1.2 : liquidish ? 2.2 : 0.7;
      p.vx *= Math.max(0, 1 - drag * dt);
      p.vy *= Math.max(0, 1 - drag * dt);

      const brown = brownianStrength(p, v.temp);
      p.vx += (Math.random() - 0.5) * brown * (liquidish ? 0.7 : 1);
      if (!liquidish) p.vy += (Math.random() - 0.5) * brown * 0.25;
      else if (v.temp > 80) p.vy -= Math.random() * (v.temp - 80) * 0.12;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;

      if (p.x < b.left + p.r) {
        p.x = b.left + p.r;
        p.vx *= -0.15;
      }
      if (p.x > b.right - p.r) {
        p.x = b.right - p.r;
        p.vx *= -0.15;
      }
      if (p.y > b.bottom - p.r) {
        p.y = b.bottom - p.r;
        if (p.vy > 0) p.vy = 0;
        p.vx *= 0.85;
      }
      if (p.y < b.top + p.r && p.phase !== "gas") {
        p.y = b.top + p.r;
        p.vy *= 0.1;
      }

      if (p.phase === "solid" && dens < 1) {
        const surface = state.cache[v.id] && state.cache[v.id].surfaceY;
        if (surface && p.y > surface - p.r) {
          p.y = surface - p.r;
          if (p.vy > 0) p.vy *= -0.2;
        }
      }

      updateDissolve(p, dt, v);
      updateMelt(p, v);
    });
  }

  function settleLiquids(dt) {
    const stirring = state.stir && state.stir.vessel;
    vesselIds().forEach((id) => {
      const v = vessels[id];
      const c = state.cache[id];
      if (!v || !c || !c.liquids.length) {
        if (c && v) c.surfaceY = inner(v).bottom;
        return;
      }
      if (stirring === id) return;
      const b = inner(v);
      const cols = Math.max(6, Math.floor((b.right - b.left) / 7));
      const colW = (b.right - b.left) / cols;
      const heights = new Float32Array(cols);
      const hot = v.temp > 90;
      const k = Math.min(1, dt * (hot ? 4 : 10));
      c.liquids.sort((a, b) => mixDensity(b, id) - mixDensity(a, id));
      c.liquids.forEach((p) => {
        if (p.phase !== "liquid" && p.phase !== "dissolved") return;
        let col = Math.floor((p.x - b.left) / colW);
        if (col < 0) col = 0;
        if (col >= cols) col = cols - 1;
        const target = b.bottom - p.r - heights[col];
        p.y += (target - p.y) * k;
        if (p.y > b.bottom - p.r) p.y = b.bottom - p.r;
        if (p.y < b.top + p.r) p.y = b.top + p.r;
        heights[col] += p.r * 1.45;
      });
      let maxH = 0;
      for (let i = 0; i < cols; i++) if (heights[i] > maxH) maxH = heights[i];
      c.surfaceY = b.bottom - maxH;
    });
  }

  function solveBonds(dt) {
    const map = new Map(state.particles.map((p) => [p.id, p]));
    state.bonds = state.bonds.filter((bond) => {
      const a = map.get(bond.a);
      const b = map.get(bond.b);
      if (!a || !b) return false;
      if (a.phase === "dissolved" || b.phase === "dissolved") return false;
      if (a.phase === "liquid" && b.phase === "liquid" && specOf(a).id === "wax") return false;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist > bond.rest * 3.6) return false;
      const diff = dist - bond.rest;
      const f = (diff * bond.k) * dt * 0.08;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x += nx * f;
      a.y += ny * f;
      b.x -= nx * f;
      b.y -= ny * f;
      a.vx += nx * f * 8;
      a.vy += ny * f * 8;
      b.vx -= nx * f * 8;
      b.vy -= ny * f * 8;
      return true;
    });
  }

  function collide() {
    const cell = 18;
    const grid = new Map();
    const key = (x, y) => x + ":" + y;
    const solids = [];
    state.particles.forEach((p) => {
      if (p.phase !== "solid" || p.adsorbedTo || p.stuck) return;
      if (p.vessel === "vapor" || p.vessel === "transit" || p.vessel === "funnel" || p.vessel === "magnet") return;
      solids.push(p);
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      const k = key(cx, cy);
      let bucket = grid.get(k);
      if (!bucket) {
        bucket = [];
        grid.set(k, bucket);
      }
      bucket.push(p);
    });
    for (let i = 0; i < solids.length; i++) {
      const a = solids[i];
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(key(cx + ox, cy + oy));
          if (!bucket) continue;
          for (let j = 0; j < bucket.length; j++) {
            const b = bucket[j];
            if (b.id <= a.id || a.vessel !== b.vessel) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const min = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min || d2 === 0) continue;
            const dist = Math.sqrt(d2);
            const overlap = (min - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
          }
        }
      }
    }
  }

  function autoObserve() {
    if (state.t < state.sayUntil) return;
    const id = state.selected;
    const v = vessels[id];
    if (!v) return;
    const list = particlesIn(id);
    if (!list.length) {
      observeEl.textContent = `${v.label} ist leer. Stoff rechts antippen, um Teilchen einzufüllen.`;
      return;
    }
    const names = {};
    list.forEach((p) => {
      const n = specOf(p).name;
      names[n] = names[n] || { n, solid: 0, liq: 0, dis: 0, gas: 0, char: 0 };
      if (p.phase === "char") names[n].char++;
      else if (p.phase === "solid") names[n].solid++;
      else if (p.phase === "dissolved") names[n].dis++;
      else if (p.phase === "gas") names[n].gas++;
      else names[n].liq++;
    });
    const bits = Object.values(names).map((x) => {
      const st = [];
      if (x.solid) st.push("fest");
      if (x.liq) st.push("flüssig");
      if (x.dis) st.push("gelöst");
      if (x.gas) st.push("gasförmig");
      if (x.char) st.push("zersetzt");
      return `${x.n} (${st.join(", ")})`;
    });
    const extra = [];
    if (v.heating) extra.push("Brenner an — nochmals Brenner tippen = aus");
    if (state.distill) extra.push("Destillation aufgebaut");
    if (state.particles.some((p) => p.vessel === "funnel")) extra.push("Rückstand im Filter — Filter tippen");
    observeEl.textContent = `${v.label}, ${Math.round(v.temp)} °C: ${bits.join(" · ")}${extra.length ? " — " + extra.join(", ") : ""}`;
  }

  function drawParticle(p) {
    const spec = specOf(p);
    if (p.phase === "char") {
      ctx.fillStyle = "#16110c";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.5, p.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const liquidish = p.phase === "liquid" || p.phase === "dissolved" || p.phase === "gas";
    if (liquidish || p.caramel) {
      ctx.globalAlpha = p.phase === "gas" ? 0.32 : p.phase === "dissolved" ? 0.72 : 0.82;
      ctx.fillStyle = p.caramel ? "#c56a18" : spec.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.phase === "gas") ctx.globalAlpha = 0.32;
    else if (p.phase === "dissolved") ctx.globalAlpha = 0.72;
    else if (p.phase === "liquid" && (p.type === "water" || p.type === "alcohol")) ctx.globalAlpha = 0.78;
    const r = p.r;
    if (spec.shape === "crystal") {
      roundedPoly(r * 1.6, r * 1.6, 4, 1.4, spec.color, spec.stroke);
    } else if (spec.shape === "grain") {
      blob(r, 5, p.seed, spec.color, spec.stroke);
    } else if (spec.shape === "flake") {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.2, r * 0.7, 0, 0, Math.PI * 2);
      fillStroke(spec.color, spec.stroke);
    } else if (spec.shape === "foam") {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      fillStroke(spec.color, spec.stroke);
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = "#ddd";
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.2, r * 0.28, 0, Math.PI * 2);
      ctx.arc(r * 0.25, r * 0.15, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else if (spec.shape === "chunk") {
      blob(r, 6, p.seed, spec.color, spec.stroke);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      fillStroke(spec.color, spec.stroke);
      ctx.globalAlpha *= 0.35;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function fillStroke(fill, stroke) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
  }

  function blob(r, n, seed, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.78 + ((Math.sin(seed + i * 2.1) + 1) / 2) * 0.45);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(fill, stroke);
  }

  function roundedPoly(w, h, n, radius, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * w * 0.55;
      const y = Math.sin(a) * h * 0.55;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(fill, stroke);
  }

  function drawBench() {
    const W = state.W;
    const H = state.H;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#c5d6e0");
    g.addColorStop(0.55, "#d9e4ea");
    g.addColorStop(0.55, "#b08958");
    g.addColorStop(1, "#8c6233");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    for (let y = 12; y < H * 0.55; y += 28) {
      for (let x = 8; x < W; x += 46) {
        ctx.fillRect(x, y, 42, 24);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,.08)";
    ctx.fillRect(0, H * 0.55, W, 10);
  }

  function beakerPath(v) {
    const { x, y, w, h } = v;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 18);
    ctx.lineTo(x + 18, y + h - 8);
    ctx.quadraticCurveTo(x + w / 2, y + h + 4, x + w - 18, y + h - 8);
    ctx.lineTo(x + w - 8, y + 18);
    ctx.closePath();
  }

  function drawBeaker(v) {
    const { x, y, w, h } = v;
    ctx.save();
    if (v.tilt) {
      ctx.translate(x + w, y + h);
      ctx.rotate(-v.tilt * 0.45);
      ctx.translate(-(x + w), -(y + h));
    }
    ctx.fillStyle = "rgba(0,0,0,.12)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h - 2, w * 0.42, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    const glass = ctx.createLinearGradient(x, y, x + w, y);
    glass.addColorStop(0, "rgba(255,255,255,.38)");
    glass.addColorStop(0.2, "rgba(170,205,225,.22)");
    glass.addColorStop(0.85, "rgba(170,205,225,.18)");
    glass.addColorStop(1, "rgba(255,255,255,.4)");
    ctx.fillStyle = glass;
    beakerPath(v);
    ctx.fill();
    ctx.strokeStyle =
      state.selected === v.id ? "#0e7ab4" : state.selectedTo === v.id ? "#e36b1e" : "rgba(40,70,90,.55)";
    ctx.lineWidth = state.selected === v.id || state.selectedTo === v.id ? 3 : 1.5;
    ctx.stroke();

    ctx.strokeStyle = "rgba(40,70,90,.28)";
    ctx.lineWidth = 1;
    const b = inner(v);
    for (let i = 1; i <= 4; i++) {
      const yy = b.bottom - (b.bottom - b.top) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(b.left + 6, yy);
      ctx.lineTo(b.left + 18, yy);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(x + 10, y + 8, w - 20, 10);
    ctx.strokeStyle = "rgba(40,70,90,.4)";
    ctx.strokeRect(x + 10, y + 8, w - 20, 10);

    ctx.fillStyle = state.selected === v.id ? "#0e7ab4" : state.selectedTo === v.id ? "#b84f0f" : "#33444c";
    ctx.font = "700 13px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(v.label, x + w / 2, y + h + 22);
    if (state.selected === v.id || state.selectedTo === v.id) {
      const mark = state.selected === v.id ? "1" : "2";
      ctx.beginPath();
      ctx.arc(x + w - 8, y + 4, 11, 0, Math.PI * 2);
      ctx.fillStyle = mark === "1" ? "#0e7ab4" : "#e36b1e";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 12px Segoe UI";
      ctx.fillText(mark, x + w - 8, y + 8);
    }
    ctx.restore();
  }

  function drawBurner(v) {
    if (!v.heating) return;
    const x = v.x + v.w / 2;
    const y = v.y + v.h + 8;
    ctx.fillStyle = "#3a3f48";
    ctx.fillRect(x - 16, y + 18, 32, 10);
    ctx.fillRect(x - 6, y + 4, 12, 16);
    const t = state.t;
    for (let i = 0; i < 7; i++) {
      const ox = (i - 3) * 4;
      const h = 16 + Math.sin(t * 14 + i) * 6;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = i % 2 ? "#ffd36a" : "#ff7a18";
      ctx.beginPath();
      ctx.moveTo(x + ox - 3, y + 4);
      ctx.quadraticCurveTo(x + ox, y + 4 - h, x + ox + 3, y + 4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#1a2428";
    ctx.font = "700 11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Brenner aus", x, y + 44);
  }

  function burnerHit(v, px, py) {
    if (!v.heating) return false;
    const x = v.x + v.w / 2;
    const y = v.y + v.h + 28;
    return Math.hypot(px - x, py - y) < 52;
  }

  function drawThermo(v) {
    if (!v.thermo) return;
    const x = v.x + v.w - 22;
    const top = v.y + 36;
    const bot = v.y + v.h - 28;
    ctx.strokeStyle = "#8aa0aa";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
    ctx.fillStyle = v.temp > 800 ? "#f4e19c" : "#d94c3d";
    ctx.beginPath();
    ctx.arc(x, bot + 6, 6, 0, Math.PI * 2);
    ctx.fill();
    const frac = Math.max(0, Math.min(1, Math.log10(1 + v.temp) / Math.log10(1 + TEMP_MAX)));
    ctx.strokeStyle = v.temp > 800 ? "#f4e19c" : "#d94c3d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, bot);
    ctx.lineTo(x, bot - (bot - top) * frac);
    ctx.stroke();
    ctx.fillStyle = v.temp >= 400 ? "#b84f0f" : "#1a2428";
    ctx.font = "700 14px Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(v.temp)} °C`, x + 10, top + 8);
  }

  function drawFunnel() {
    const residue = state.particles.some((p) => p.vessel === "funnel") || state.filter;
    if (!residue) return;
    const a = funnelAnchor();
    if (!a) return;
    const fx = a.x;
    const fy = a.y;
    ctx.fillStyle = "rgba(180,210,225,.55)";
    ctx.strokeStyle = "rgba(40,70,90,.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx - 36, fy);
    ctx.lineTo(fx + 36, fy);
    ctx.lineTo(fx + 7, fy + 44);
    ctx.lineTo(fx + 7, fy + 72);
    ctx.lineTo(fx - 7, fy + 72);
    ctx.lineTo(fx - 7, fy + 44);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#b84f0f";
    ctx.font = "700 11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Filter", fx, fy - 8);
  }

  function drawDistill() {
    const pair = distillPair();
    if (!pair) return;
    const { a, b } = pair;
    ctx.strokeStyle = "rgba(80,120,150,.7)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x + a.w * 0.55, a.y + 10);
    ctx.lineTo(a.x + a.w * 0.55, a.y - 52);
    ctx.lineTo(b.x + b.w * 0.45, b.y - 52);
    ctx.lineTo(b.x + b.w * 0.45, b.y + 18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(61,155,233,.55)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w * 0.45 - 30, b.y - 40);
    ctx.lineTo(b.x + b.w * 0.45 + 4, b.y + 4);
    ctx.stroke();
    ctx.fillStyle = "#0e7ab4";
    ctx.font = "700 12px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Kühler", b.x + b.w * 0.45 - 48, b.y - 18);
  }

  function drawMagnetIcon(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.4);
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(-10, -28, 20, 22);
    ctx.fillStyle = "#3a5fcd";
    ctx.fillRect(-10, -8, 20, 22);
    ctx.fillStyle = "#ddd";
    ctx.fillRect(-4, -28, 8, 42);
    ctx.restore();
  }

  function drawMagnet() {
    if (state.magnetJob) drawMagnetIcon(state.magnetJob.x, state.magnetJob.y);
  }

  function drawStir() {
    if (!state.stir) return;
    const v = vessels[state.stir.vessel];
    if (!v) return;
    const b = inner(v);
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.t * 8);
    ctx.strokeStyle = "rgba(180,220,230,.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.lineTo(0, 36);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    drawBench();
    drawDistill();
    vesselList().forEach(drawBeaker);
    drawFunnel();
    drawStir();
    const ids = vesselIds();
    const byVessel = {};
    ids.forEach((id) => {
      byVessel[id] = [];
    });
    const outside = [];
    state.particles.forEach((p) => {
      if (byVessel[p.vessel]) byVessel[p.vessel].push(p);
      else outside.push(p);
    });
    ids.forEach((id) => {
      const v = vessels[id];
      const list = byVessel[id];
      list.sort((a, b) => a.y - b.y);
      ctx.save();
      beakerPath(v);
      ctx.clip();
      drawCharLayer(v);
      list.forEach(drawParticle);
      ctx.restore();
    });
    outside.sort((a, b) => a.y - b.y);
    outside.forEach(drawParticle);
    vesselList().forEach(drawBurner);
    vesselList().forEach(drawThermo);
    drawMagnet();
    ctx.fillStyle = "rgba(26,36,40,.55)";
    ctx.font = "600 12px Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText(toolTip(), 14, 22);
  }

  function toolTip() {
    const src = vessels[state.selected];
    const dst = vessels[state.selectedTo];
    if (dst && src) {
      return `${src.label} → ${dst.label}. Jetzt Werkzeug links tippen (z. B. Filtrieren).`;
    }
    if (src) {
      return `${src.label} gewählt. Stoff rechts einfüllen — oder Werkzeug: Filter/Destillieren erzeugt ein zweites Glas.`;
    }
    return "Becherglas antippen, dann Stoff oder Werkzeug wählen.";
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    state.t += dt;
    rebuildCache();
    updateHeat(dt);
    updateDecompose(dt);
    updateStir(dt);
    updateExtractWait(dt);
    updateFilter(dt);
    updateDecant(dt);
    updateVapor(dt);
    applyPhysics(dt);
    settleLiquids(dt);
    solveBonds(dt);
    collide();
    updateCharStick();
    updateAdsorb();
    updateMagnet(dt);
    autoObserve();
    render();
    requestAnimationFrame(loop);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.W = rect.width;
    state.H = rect.height;
    layout();
  }

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] || e.changedTouches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  function selectVessel(id) {
    if (state.selected && state.selected !== id && !state.selectedTo) {
      state.selectedTo = id;
      say(`${vessels[state.selected].label} → ${vessels[id].label}. Jetzt links ein Werkzeug tippen.`, 3);
      return;
    }
    state.selected = id;
    state.selectedTo = null;
  }

  function dumpFunnel(dest) {
    if (!vessels[dest]) return;
    let n = 0;
    const v = vessels[dest];
    state.particles.forEach((p) => {
      if (p.vessel !== "funnel") return;
      p.vessel = dest;
      p.x = v.x + v.w * 0.5 + (Math.random() - 0.5) * 28;
      p.y = v.y + 40;
      p.vy = 40;
      n++;
    });
    if (n) {
      state.funnelOn = null;
      state.selected = dest;
      state.selectedTo = null;
      say(`Rückstand in ${v.label} (neues Glas).`, 2.8);
    }
  }

  function dumpResidueToNewGlass() {
    if (!state.particles.some((p) => p.vessel === "funnel")) return false;
    const dest = addVessel();
    if (!dest) return false;
    dumpFunnel(dest);
    return true;
  }

  function onDown(e) {
    const pos = pointerPos(e);
    state.pointer.x = pos.x;
    state.pointer.y = pos.y;
    state.pointer.down = true;

    for (const v of vesselList()) {
      if (burnerHit(v, pos.x, pos.y)) {
        v.heating = false;
        say("Brenner aus.", 1.8);
        syncToolButtons();
        return;
      }
    }

    const a = funnelAnchor();
    if (a && state.particles.some((p) => p.vessel === "funnel") && Math.hypot(pos.x - a.x, pos.y - a.y - 20) < 44) {
      dumpResidueToNewGlass();
      return;
    }

    const hit = vesselAt(pos.x, pos.y);
    if (hit) selectVessel(hit);
  }

  function onMove(e) {
    const pos = pointerPos(e);
    state.pointer.x = pos.x;
    state.pointer.y = pos.y;
  }

  function onUp() {
    state.pointer.down = false;
  }

  function needSource() {
    if (!state.selected || !vessels[state.selected]) {
      say("Zuerst ein Becherglas antippen.", 2.2);
      return null;
    }
    return state.selected;
  }

  function toggleHeat(id) {
    if (state.t - (state.lastHeatToggle || 0) < 0.15) return;
    state.lastHeatToggle = state.t;
    const v = vessels[id];
    if (!v) return;
    v.heating = !v.heating;
    if (v.heating && !v.thermo) v.thermo = true;
    const others = vesselList().filter((x) => x.heating && x.id !== v.id);
    let msg;
    if (v.heating && state.distill && state.distill.from !== id) {
      msg = `Brenner unter ${v.label}. Der Kühler hängt an ${vessels[state.distill.from].label} — hier dampft es in die Luft.`;
    } else if (v.heating) {
      msg = "Brenner an. Nochmals «Brenner aus» oder die Flamme antippen.";
    } else if (others.length) {
      msg = `Brenner unter ${v.label} aus. Achtung: unter ${others.map((x) => x.label).join(", ")} brennt es noch.`;
    } else {
      msg = "Brenner aus — die Temperatur sinkt.";
    }
    say(msg, 3.4);
    syncToolButtons();
  }

  function startFilter(from, to) {
    if (!to || from === to) return;
    if (state.filter) return;
    state.filter = { from, to, t: 0 };
    state.funnelOn = to;
    say(`Filter über ${vessels[to].label} — Filtrat läuft in das neue Glas. Filter antippen: Rückstand in ein weiteres Glas.`, 3.6);
  }

  function startDistill(from, to) {
    if (!to || from === to) return;
    if (state.distill && state.distill.from === from && state.distill.to === to) {
      state.distill = null;
      say("Destillations-Apparatur abgebaut.", 2.2);
      return;
    }
    state.distill = { from, to };
    vessels[from].thermo = true;
    say(`Destillation: ${vessels[from].label} → ${vessels[to].label}. Jetzt Brenner unter ${vessels[from].label}.`, 4);
  }

  function startMagnet(from, to) {
    if (!to || from === to) return;
    state.magnetGrab = [];
    state.magnetJob = { from, to, t: 0, phase: "attract", x: 0, y: 0 };
    say("Magnet holt Eisen aus dem Glas …", 2.2);
  }

  function startDecant(from, to) {
    if (!to || from === to) return;
    state.decant = { from, to, t: 0 };
  }

  function startExtract(from, to) {
    if (!to || from === to) return;
    if (!vesselHasType(from, "gasoline")) {
      say("Zuerst Benzin zur Milch geben. Benzin mischt sich nicht mit Wasser — darin löst sich das Fett.", 3.8);
      return false;
    }
    state.stir = { vessel: from, t: 2.5 };
    state.extractWait = { from, to, t: 2.6 };
    say("Rühren … das Fett wechselt ins Benzin. Danach kommt die gelbe Schicht ins neue Glas.", 3.5);
    return true;
  }

  function updateExtractWait(dt) {
    if (!state.extractWait) return;
    state.extractWait.t -= dt;
    if (state.extractWait.t > 0) return;
    const { from, to } = state.extractWait;
    state.extractWait = null;
    if (!vessels[from] || !vessels[to]) return;
    state.decant = { from, to, t: 0, mode: "extract" };
  }

  function emptyVessel(id) {
    state.particles = state.particles.filter((p) => p.vessel !== id);
    state.bonds = state.bonds.filter((b) => findP(b.a) && findP(b.b));
    say(`${vessels[id].label} geleert.`, 1.8);
  }

  function runTool(id) {
    state.tool = id;
    syncToolButtons();
    if (id === "pointer") return;
    const from = needSource();
    if (!from) return;
    if (id === "stir") {
      state.stir = { vessel: from, t: 2.4 };
      if (vesselHasType(from, "fat") && vesselHasType(from, "gasoline")) {
        say("Rühren: das Fett wechselt vom Wasser ins Benzin (Extrahieren).", 2.8);
      } else {
        say("Rühren mischt und beschleunigt das Lösen.", 2.2);
      }
      return;
    }
    if (id === "heat") {
      toggleHeat(from);
      return;
    }
    if (id === "thermo") {
      vessels[from].thermo = !vessels[from].thermo;
      return;
    }
    if (id === "empty") {
      emptyVessel(from);
      return;
    }
    if (id === "filter") {
      const to = addVessel();
      if (!to) return;
      state.selectedTo = to;
      startFilter(from, to);
      return;
    }
    if (id === "extract") {
      if (!vesselHasType(from, "gasoline")) {
        say("Zuerst Benzin zur Milch geben. Benzin mischt sich nicht mit Wasser — darin löst sich das Fett.", 3.8);
        return;
      }
      const to = addVessel();
      if (!to) return;
      state.selectedTo = to;
      startExtract(from, to);
      return;
    }
    const to = ensureTarget(from);
    if (!to) return;
    state.selectedTo = to;
    if (id === "distill") startDistill(from, to);
    else if (id === "magnet") startMagnet(from, to);
    else if (id === "decant") startDecant(from, to);
  }

  function resetAll() {
    state.particles = [];
    state.bonds = [];
    state.magnetGrab = [];
    state.magnetJob = null;
    state.stir = null;
    state.filter = null;
    state.funnelOn = null;
    state.decant = null;
    state.distill = null;
    state.extractWait = null;
    vesselIds().forEach((id) => {
      if (id !== "A") delete vessels[id];
    });
    if (!vessels.A) vessels.A = makeVessel("A", "Becherglas A");
    vessels.A.temp = ROOM;
    vessels.A.heating = false;
    vessels.A.thermo = false;
    vessels.A.tilt = 0;
    state.selected = "A";
    state.selectedTo = null;
    state.tool = "pointer";
    layout();
    syncToolButtons();
    say("Labor geleert. Becherglas wählen, Stoff einfüllen, dann Werkzeug.", 3);
  }

  function startScenario(key) {
    resetAll();
    document.getElementById("intro").classList.add("hidden");
    if (key === "free") return;
    if (key === "salt") {
      addSubstance("sand", "A");
      addSubstance("salt", "A");
      addSubstance("water", "A");
      say("Steinsalz. Glas A wählen, dann Filtrieren — ein Auffangglas entsteht von selbst.", 5);
    } else if (key === "float") {
      addSubstance("sand", "A");
      addSubstance("styrofoam", "A");
      addSubstance("water", "A");
      say("Styropor schwimmt, Sand sinkt. Glas wählen, dann Dekantieren.", 4.5);
    } else if (key === "magnet") {
      addSubstance("iron", "A");
      addSubstance("alu", "A");
      addSubstance("sand", "A");
      say("Glas A wählen, dann Magnet — Eisen wandert in ein neues Glas.", 4);
    } else if (key === "distill") {
      addSubstance("water", "A");
      addSubstance("alcohol", "A");
      const to = ensureTarget("A");
      state.selectedTo = to;
      startDistill("A", to);
      say("Apparatur steht. Brenner tippen: zuerst 78 °C (Alkohol), später 100 °C (Wasser).", 5.5);
    } else if (key === "adsorb") {
      addSubstance("water", "A");
      addSubstance("ink", "A");
      addSubstance("charcoal", "A");
      say("Aktivkohle bindet Tinte. Danach Filtrieren — das Filtrat wird heller.", 5);
    } else if (key === "extract") {
      addSubstance("milk", "A");
      addSubstance("gasoline", "A");
      say("Milch + Benzin. Glas wählen, rühren oder Extrahieren — das Fett geht in die gelbe Benzinschicht.", 5.5);
    }
  }

  function syncToolButtons() {
    const heating = !!(vessels[state.selected] && vessels[state.selected].heating);
    document.querySelectorAll(".tool").forEach((btn) => {
      const id = btn.dataset.tool;
      btn.classList.toggle("active", id === state.tool);
      btn.classList.toggle("lit", id === "heat" && heating);
      if (id === "heat") {
        const name = btn.querySelector(".tool-name");
        if (name) name.textContent = heating ? "Brenner aus" : "Brenner";
      }
    });
  }

  function fmtTemp(t) {
    if (t == null || Number.isNaN(t)) return "—";
    if (t >= 2500) return "sehr hoch";
    return `${t} °C`;
  }

  function densityLabel(spec) {
    if (spec.mixture) return "ca. 1 (wie Wasser)";
    if (spec.density == null) return "—";
    const n = String(spec.density).replace(".", ",");
    if (spec.density === 1) return `${n} (wie Wasser)`;
    if (spec.density < 1) return `${n} — leichter als Wasser`;
    return `${n} — schwerer als Wasser`;
  }

  function meltLabel(spec) {
    if (spec.mixture) return "— (Gemisch)";
    if (spec.melt == null) return "—";
    if (spec.boil != null && spec.melt === spec.boil) return "schmilzt nicht";
    return fmtTemp(spec.melt);
  }

  function boilLabel(spec) {
    if (spec.mixture) return "Wasseranteil ca. 100 °C";
    if (spec.decompose) return `zersetzt sich (ca. ${spec.decompose} °C), verdampft nicht`;
    if (spec.boil == null) return "verdampft nicht";
    if (spec.melt != null && spec.melt === spec.boil) return "kein klarer Siedepunkt / zersetzt sich";
    return fmtTemp(spec.boil);
  }

  function solubility(spec, solvent) {
    if (spec.mixture) {
      if (solvent === "water") return "Emulsion: Fett ist als Tröpfchen drin, nicht echt gelöst";
      if (solvent === "alcohol") return "nein (das Fett nicht)";
      return "das Fett ja, das Wasser nein";
    }
    if (spec.id === solvent) return "ist das Lösungsmittel";
    if ((spec.solubleIn || []).includes(solvent)) {
      if (spec.id === "sugar" && solvent === "alcohol") return "ja, wenn genug Alkohol da ist";
      return "ja";
    }
    if ((spec.mixesWith || []).includes(solvent)) return "vermischt sich vollständig";
    if ((spec.emulsifyIn || []).includes(solvent)) return "nein — nur als Tröpfchen (Emulsion)";
    if (spec.phase === "liquid" && solvent === "water") return "nein — eigene Schicht";
    return "nein";
  }

  function specialNotes(spec) {
    const bits = [];
    if (spec.mixture) bits.push("Gemisch (Emulsion), kein Reinstoff.");
    if (spec.adsorbs) bits.push("Bindet Farbstoffe an der Oberfläche (Adsorbieren).");
    if ((spec.adsorbedBy || []).includes("charcoal")) bits.push("Haftet an Aktivkohle.");
    if (spec.magnetic) bits.push("Wird vom Magneten angezogen.");
    if (spec.passesFilter === false) bits.push("Bleibt im Filter (Rückstand).");
    if (spec.density != null && spec.density < 0.5) bits.push("Schwimmt immer oben auf Wasser.");
    else if (spec.phase === "solid" && spec.density != null && spec.density < 1) bits.push("Schwimmt auf Wasser.");
    else if (spec.phase === "solid" && spec.density != null && spec.density > 1.05) bits.push("Sinkt in Wasser.");
    if (spec.decompose) bits.push("Beim starken Erhitzen schwarze Kruste — nicht rückgängig.");
    if ((spec.solubleIn || []).includes("gasoline")) bits.push("Lässt sich mit Benzin extrahieren.");
    if (spec.hint) bits.push(spec.hint);
    return bits.join(" ");
  }

  function substanceRows(spec) {
    return [
      ["Schmelzpunkt", meltLabel(spec)],
      ["Siedepunkt", boilLabel(spec)],
      ["Dichte", densityLabel(spec)],
      ["Löslichkeit in Wasser", solubility(spec, "water")],
      ["Löslichkeit in Alkohol", solubility(spec, "alcohol")],
      ["Löslichkeit in Benzin", solubility(spec, "gasoline")],
      ["Magnetisch", spec.magnetic ? "ja" : spec.mixture ? "nein" : "nein"],
      ["Besonderes", specialNotes(spec)],
    ];
  }

  function closeFactsheet() {
    const el = document.getElementById("factsheet");
    if (!el) return;
    el.classList.add("hidden");
    el.hidden = true;
  }

  function openFactsheet(id) {
    const spec = SUBSTANCES[id];
    const el = document.getElementById("factsheet");
    if (!spec || !el) return;
    document.getElementById("factTitle").textContent = spec.name;
    document.getElementById("factShort").textContent = spec.short || "";
    const sw = document.getElementById("factSwatch");
    sw.style.background = spec.color || "#ccc";
    sw.style.borderColor = spec.stroke || "#999";
    const list = document.getElementById("factList");
    list.innerHTML = "";
    substanceRows(spec).forEach(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      list.appendChild(dt);
      list.appendChild(dd);
    });
    el.classList.remove("hidden");
    el.hidden = false;
    document.getElementById("factClose").focus();
  }

  function buildUI() {
    const tools = document.getElementById("tools");
    tools.innerHTML = `<div class="col-title">Werkzeuge</div>`;
    TOOLS.forEach((t) => {
      const b = document.createElement("button");
      b.className = "tool" + (t.id === "pointer" ? " active" : "");
      b.dataset.tool = t.id;
      b.type = "button";
      b.innerHTML = `<span class="ico">${t.icon}</span><span class="tool-name">${t.name}</span>`;
      b.addEventListener("click", () => runTool(t.id));
      tools.appendChild(b);
    });

    const shelf = document.getElementById("shelf");
    shelf.innerHTML = `<div class="col-title">Stoffe</div>`;
    Object.values(SUBSTANCES).forEach((s) => {
      const wrap = document.createElement("div");
      wrap.className = "jar-wrap";
      const b = document.createElement("button");
      b.className = "jar" + (s.extra ? " extra" : "");
      b.type = "button";
      b.title = s.hint || s.name;
      b.innerHTML = `<span class="swatch" style="background:${s.color};border-color:${s.stroke}"></span><span><span class="nm">${s.name}</span><span class="sub">${s.short || ""}</span></span>`;
      b.addEventListener("click", () => {
        const id = state.selected || "A";
        if (!vessels[id]) return;
        addSubstance(s.id, id);
        observeEl.textContent = s.hint;
      });
      const info = document.createElement("button");
      info.className = "jar-info";
      info.type = "button";
      info.title = `Eigenschaften von ${s.name}`;
      info.setAttribute("aria-label", `Eigenschaften von ${s.name}`);
      info.textContent = "i";
      info.addEventListener("click", (e) => {
        e.stopPropagation();
        openFactsheet(s.id);
      });
      wrap.appendChild(b);
      wrap.appendChild(info);
      shelf.appendChild(wrap);
    });

    const bar = document.getElementById("examples");
    const chips = [
      ["free", "Frei"],
      ["salt", "Steinsalz"],
      ["float", "Schwimmen"],
      ["magnet", "Magnet"],
      ["distill", "Destillieren"],
      ["extract", "Extrahieren"],
      ["adsorb", "Adsorbieren"],
    ];
    chips.forEach(([k, n]) => {
      const c = document.createElement("button");
      c.className = "chip";
      c.type = "button";
      c.textContent = n;
      c.addEventListener("click", () => startScenario(k));
      bar.appendChild(c);
    });

    document.getElementById("btnReset").addEventListener("click", resetAll);
    document.getElementById("btnHelp").addEventListener("click", () => {
      document.getElementById("intro").classList.remove("hidden");
    });
    document.getElementById("intro").addEventListener("click", (e) => {
      const start = e.target.closest("[data-start]");
      if (start) startScenario(start.dataset.start);
      else if (e.target.id === "intro") document.getElementById("intro").classList.add("hidden");
    });

    const sheet = document.getElementById("factsheet");
    document.getElementById("factClose").addEventListener("click", closeFactsheet);
    sheet.addEventListener("click", (e) => {
      if (e.target.id === "factsheet") closeFactsheet();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeFactsheet();
    });
  }

  window.addEventListener("resize", resize);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  buildUI();
  resize();
  const start = new URLSearchParams(location.search).get("start");
  if (start) startScenario(start);
  requestAnimationFrame(loop);
})();
