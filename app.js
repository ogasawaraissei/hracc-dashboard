const state = {
  manifest: [],
  currentMeta: null,
  currentAccRows: [],
  currentHrRows: []
};

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initialize();
  } catch (error) {
    console.error(error);
    alert("初期化に失敗しました: " + error.message);
  }
});

async function initialize() {
  state.manifest = await loadManifest();

  populatePlayerSelect();
  populateDateSelect();
  populateSessionSelect();

  document.getElementById("playerSelect").addEventListener("change", handlePlayerChange);
  document.getElementById("dateSelect").addEventListener("change", handleDateChange);
  document.getElementById("sessionSelect").addEventListener("change", renderCurrentSelection);
  document.getElementById("reloadBtn").addEventListener("click", renderCurrentSelection);

  await renderCurrentSelection();
}

async function loadManifest() {
  const res = await fetch("manifest.json");
  if (!res.ok) {
    throw new Error("manifest.json を読み込めません");
  }
  return await res.json();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function populatePlayerSelect() {
  const select = document.getElementById("playerSelect");
  const players = uniqueSorted(state.manifest.map(item => item.player_id));

  select.innerHTML = players
    .map(playerId => `<option value="${playerId}">${playerId}</option>`)
    .join("");
}

function populateDateSelect() {
  const playerId = document.getElementById("playerSelect").value;
  const select = document.getElementById("dateSelect");

  const dates = uniqueSorted(
    state.manifest
      .filter(item => item.player_id === playerId)
      .map(item => item.date)
  );

  select.innerHTML = dates
    .map(date => `<option value="${date}">${date}</option>`)
    .join("");
}

function getSessionLabel(item) {
  const start = item.start_time || "----";
  const end = item.end_time || "----";
  return `${start}-${end}`;
}

function populateSessionSelect() {
  const playerId = document.getElementById("playerSelect").value;
  const date = document.getElementById("dateSelect").value;
  const select = document.getElementById("sessionSelect");

  const sessions = state.manifest.filter(item =>
    item.player_id === playerId && item.date === date
  );

  select.innerHTML = sessions
    .map((item, index) => `<option value="${index}">${getSessionLabel(item)}</option>`)
    .join("");
}

function handlePlayerChange() {
  populateDateSelect();
  populateSessionSelect();
  renderCurrentSelection();
}

function handleDateChange() {
  populateSessionSelect();
  renderCurrentSelection();
}

function getSelectedMeta() {
  const playerId = document.getElementById("playerSelect").value;
  const date = document.getElementById("dateSelect").value;
  const sessionIndex = Number(document.getElementById("sessionSelect").value || 0);

  const sessions = state.manifest.filter(item =>
    item.player_id === playerId && item.date === date
  );

  return sessions[sessionIndex] || null;
}

async function renderCurrentSelection() {
  const meta = getSelectedMeta();
  if (!meta) {
    clearDisplay();
    return;
  }

  state.currentMeta = meta;

  const [accText, hrText] = await Promise.all([
    loadText(meta.acc_file),
    loadText(meta.hr_file)
  ]);

  const accRows = parseCSV(accText).map(normalizeAccRow);
  const hrRows = parseCSV(hrText).map(normalizeHrRow);

  state.currentAccRows = accRows;
  state.currentHrRows = hrRows;

  renderSummary(meta, accRows, hrRows);
  renderMetaInfo(meta, accRows, hrRows);
  renderHRChart(hrRows);
  renderAccChart(accRows);
  renderScatter(accRows, hrRows);
}

async function loadText(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`ファイルを読み込めません: ${path}`);
  }
  return await res.text();
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(",");
    const row = {};
    headers.forEach((header, i) => {
      row[header] = (values[i] ?? "").trim();
    });
    return row;
  });
}

function normalizeAccRow(row) {
  return {
    timestamp: row.timestamp,
    t: toMillis(row.timestamp),
    acc_mag: Number(row.acc_mag)
  };
}

function normalizeHrRow(row) {
  return {
    timestamp: row.timestamp,
    t: toMillis(row.timestamp),
    heart_rate: Number(row.heart_rate)
  };
}

function toMillis(timestamp) {
  const t = new Date(timestamp).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function basicStats(values) {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    count += 1;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (count === 0) {
    return { mean: NaN, min: NaN, max: NaN };
  }

  return {
    mean: sum / count,
    min,
    max
  };
}

function correlation(x, y) {
  const pairs = x
    .map((v, i) => [v, y[i]])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));

  const n = pairs.length;
  if (n < 2) return NaN;

  const xs = pairs.map(p => p[0]);
  const ys = pairs.map(p => p[1]);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  return numerator / Math.sqrt(denomX * denomY);
}

function matchAccWithLatestHr(accRows, hrRows) {
  const result = [];
  if (accRows.length === 0 || hrRows.length === 0) return result;

  let j = 0;
  let latestHr = null;

  for (const acc of accRows) {
    while (j < hrRows.length && hrRows[j].t <= acc.t) {
      if (Number.isFinite(hrRows[j].heart_rate)) {
        latestHr = hrRows[j].heart_rate;
      }
      j += 1;
    }

    if (Number.isFinite(acc.acc_mag) && Number.isFinite(latestHr)) {
      result.push({
        timestamp: acc.timestamp,
        acc_mag: acc.acc_mag,
        heart_rate: latestHr
      });
    }
  }

  return result;
}

function renderSummary(meta, accRows, hrRows) {
  const accValues = accRows.map(r => r.acc_mag);
  const hrValues = hrRows.map(r => r.heart_rate);
  const matched = matchAccWithLatestHr(accRows, hrRows);

  const accStats = basicStats(accValues);
  const hrStats = basicStats(hrValues);
  const corr = correlation(
    matched.map(r => r.acc_mag),
    matched.map(r => r.heart_rate)
  );

  const cards = [
    { label: "選手ID", value: meta.player_id || "-" },
    { label: "日付", value: meta.date || "-" },
    { label: "加速度点数", value: accRows.length.toString() },
    { label: "心拍点数", value: hrRows.length.toString() },
    { label: "平均加速度", value: Number.isFinite(accStats.mean) ? accStats.mean.toFixed(3) : "-" },
    { label: "最大加速度", value: Number.isFinite(accStats.max) ? accStats.max.toFixed(3) : "-" },
    { label: "平均心拍", value: Number.isFinite(hrStats.mean) ? `${hrStats.mean.toFixed(1)} bpm` : "-" },
    { label: "最大心拍", value: Number.isFinite(hrStats.max) ? `${hrStats.max.toFixed(1)} bpm` : "-" },
    { label: "相関", value: Number.isFinite(corr) ? corr.toFixed(3) : "-" }
  ];

  const container = document.getElementById("summaryCards");
  container.innerHTML = cards.map(card => `
    <div class="summary-card">
      <div class="label">${card.label}</div>
      <div class="value">${card.value}</div>
    </div>
  `).join("");
}

function renderMetaInfo(meta, accRows, hrRows) {
  const accFirst = accRows[0]?.timestamp || "-";
  const accLast = accRows[accRows.length - 1]?.timestamp || "-";
  const hrFirst = hrRows[0]?.timestamp || "-";
  const hrLast = hrRows[hrRows.length - 1]?.timestamp || "-";

  const html = `
    <div><strong>選手ID:</strong> ${meta.player_id || "-"}</div>
    <div><strong>選手名:</strong> ${meta.player_name || "-"}</div>
    <div><strong>日付:</strong> ${meta.date || "-"}</div>
    <div><strong>時間帯:</strong> ${meta.start_time || "-"} - ${meta.end_time || "-"}</div>
    <div><strong>セッション種別:</strong> ${meta.session_type || "-"}</div>
    <div><strong>加速度CSV:</strong> <code>${meta.acc_file || "-"}</code></div>
    <div><strong>心拍CSV:</strong> <code>${meta.hr_file || "-"}</code></div>
    <div><strong>加速度先頭時刻:</strong> ${accFirst}</div>
    <div><strong>加速度末尾時刻:</strong> ${accLast}</div>
    <div><strong>心拍先頭時刻:</strong> ${hrFirst}</div>
    <div><strong>心拍末尾時刻:</strong> ${hrLast}</div>
  `;

  document.getElementById("metaInfo").innerHTML = html;
}

function renderHRChart(hrRows) {
  const x = hrRows.map(r => r.timestamp);
  const y = hrRows.map(r => r.heart_rate);

  Plotly.newPlot("hrChart", [
    {
      x,
      y,
      type: "scatter",
      mode: "lines",
      name: "Heart Rate"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "Time" },
    yaxis: { title: "Heart Rate (bpm)" }
  }, {
    responsive: true
  });
}

function renderAccChart(accRows) {
  const x = accRows.map(r => r.timestamp);
  const y = accRows.map(r => r.acc_mag);

  Plotly.newPlot("accChart", [
    {
      x,
      y,
      type: "scatter",
      mode: "lines",
      name: "Acceleration Magnitude"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "Time" },
    yaxis: { title: "Acceleration Magnitude" }
  }, {
    responsive: true
  });
}

function renderScatter(accRows, hrRows) {
  const matched = matchAccWithLatestHr(accRows, hrRows);

  const x = matched.map(r => r.acc_mag);
  const y = matched.map(r => r.heart_rate);
  const text = matched.map(r => r.timestamp);

  Plotly.newPlot("scatterChart", [
    {
      x,
      y,
      text,
      type: "scatter",
      mode: "markers",
      name: "HR vs ACC"
    }
  ], {
    margin: { t: 20 },
    xaxis: { title: "Acceleration Magnitude" },
    yaxis: { title: "Heart Rate (bpm)" }
  }, {
    responsive: true
  });
}

function clearDisplay() {
  document.getElementById("summaryCards").innerHTML = "";
  document.getElementById("metaInfo").innerHTML = "";

  ["hrChart", "accChart", "scatterChart"].forEach(id => {
    Plotly.purge(id);
    document.getElementById(id).innerHTML = "";
  });
}
