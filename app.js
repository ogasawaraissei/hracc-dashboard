const state = {
  manifest: [],
  currentMeta: null,
  currentRows: []
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
    .map((item, index) => {
      const label = getSessionLabel(item);
      return `<option value="${index}">${label}</option>`;
    })
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

  const csvText = await loadText(meta.file);
  const rows = parseCSV(csvText).map(normalizeRow);

  state.currentRows = rows;

  renderSummary(meta, rows);
  renderMetaInfo(meta, rows);
  renderHRChart(rows);
  renderAccChart(rows);
  renderScatter(rows);
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

function normalizeRow(row) {
  const accX = Number(row.acc_x);
  const accY = Number(row.acc_y);
  const accZ = Number(row.acc_z);
  const heartRate = Number(row.heart_rate);

  return {
    timestamp: row.timestamp,
    player_id: row.player_id,
    player_name: row.player_name,
    date: row.date,
    acc_x: accX,
    acc_y: accY,
    acc_z: accZ,
    heart_rate: heartRate,
    acc_mag: Math.sqrt(accX ** 2 + accY ** 2 + accZ ** 2)
  };
}

function basicStats(values) {
  const valid = values.filter(v => Number.isFinite(v));
  if (valid.length === 0) {
    return { mean: NaN, min: NaN, max: NaN };
  }

  const sum = valid.reduce((a, b) => a + b, 0);
  return {
    mean: sum / valid.length,
    min: Math.min(...valid),
    max: Math.max(...valid)
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

function renderSummary(meta, rows) {
  const heartRates = rows.map(r => r.heart_rate);
  const accMags = rows.map(r => r.acc_mag);

  const hrStats = basicStats(heartRates);
  const accStats = basicStats(accMags);
  const corr = correlation(accMags, heartRates);

  const cards = [
    { label: "選手ID", value: meta.player_id },
    { label: "日付", value: meta.date },
    { label: "データ点数", value: rows.length.toString() },
    { label: "平均心拍", value: Number.isFinite(hrStats.mean) ? `${hrStats.mean.toFixed(1)} bpm` : "-" },
    { label: "最大心拍", value: Number.isFinite(hrStats.max) ? `${hrStats.max.toFixed(1)} bpm` : "-" },
    { label: "平均加速度", value: Number.isFinite(accStats.mean) ? accStats.mean.toFixed(3) : "-" },
    { label: "最大加速度", value: Number.isFinite(accStats.max) ? accStats.max.toFixed(3) : "-" },
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

function renderMetaInfo(meta, rows) {
  const first = rows[0]?.timestamp || "-";
  const last = rows[rows.length - 1]?.timestamp || "-";

  const html = `
    <div><strong>CSV:</strong> <code>${meta.file}</code></div>
    <div><strong>選手ID:</strong> ${meta.player_id}</div>
    <div><strong>選手名:</strong> ${meta.player_name || `Player${meta.player_id}`}</div>
    <div><strong>日付:</strong> ${meta.date}</div>
    <div><strong>時間帯:</strong> ${meta.start_time || "-"} - ${meta.end_time || "-"}</div>
    <div><strong>セッション種別:</strong> ${meta.session_type || "-"}</div>
    <div><strong>先頭時刻:</strong> ${first}</div>
    <div><strong>末尾時刻:</strong> ${last}</div>
  `;

  document.getElementById("metaInfo").innerHTML = html;
}

function renderHRChart(rows) {
  const x = rows.map(r => r.timestamp);
  const y = rows.map(r => r.heart_rate);

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

function renderAccChart(rows) {
  const x = rows.map(r => r.timestamp);
  const y = rows.map(r => r.acc_mag);

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

function renderScatter(rows) {
  const x = rows.map(r => r.acc_mag);
  const y = rows.map(r => r.heart_rate);
  const text = rows.map(r => `${r.timestamp}<br>${r.player_id}`);

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
