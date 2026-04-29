// ─── RU-Smart | script.js ─────────────────────────────────────────────────────

// ─── DATA DE APRESENTAÇÃO ─────────────────────────────────────────────────────
// Para normalizar após a apresentação, altere PRESENTATION_DATE para null
const PRESENTATION_DATE = '2026-04-29'; // null = usa a data real do sistema
// ─────────────────────────────────────────────────────────────────────────────

const WS_HOST = location.hostname && location.hostname.length ? location.hostname : '10.194.200.43';
const WS_URL = `ws://${WS_HOST}:3000`; // se abrir por arquivo, usa o IP do seu PC
let ws = null;
let reconectarTimeout = null;

// ─── Níveis — pesos de voto e permissões ─────────────────────────────────────
const NIVEIS = [
  { nome: 'Faminto',      min: 0,   max: 20,  emoji: '🍽️',  cor: '#cd7f32', pesoVoto: 1,  podeSugerir: false },
  { nome: 'Frequentador', min: 21,  max: 50,  emoji: '🧑‍🍳',  cor: '#94a3b8', pesoVoto: 2,  podeSugerir: false },
  { nome: 'Veterano',     min: 51,  max: 100, emoji: '⭐',  cor: '#f59e0b', pesoVoto: 3,  podeSugerir: false },
  { nome: 'Lendário',     min: 101, max: 200, emoji: '🔥',  cor: '#ef4444', pesoVoto: 4,  podeSugerir: false },
  { nome: 'Marmiteiro',   min: 201, max: Infinity, emoji: '💎', cor: '#a78bfa', pesoVoto: 5, podeSugerir: true }
];

function getNivel(totalConsumidas) {
  return NIVEIS.find(n => totalConsumidas >= n.min && totalConsumidas <= n.max) || NIVEIS[0];
}

// ─── Toast System ─────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── WS Status UI ─────────────────────────────────────────────────────────────
function setWsStatus(connected) {
  const dot  = document.querySelector('.ws-dot');
  const text = document.querySelector('.ws-text');
  if (!dot) return;
  if (connected) {
    dot.classList.add('connected');
    if (text) text.textContent = 'Conectado';
  } else {
    dot.classList.remove('connected');
    if (text) text.textContent = 'Desconectado';
  }
}

// ─── Conexão WebSocket ────────────────────────────────────────────────────────
function conectarWS(onMessage, onOpen) {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    setWsStatus(true);
    showToast('Conectado ao servidor RU-Smart', 'success', 2500);
    if (typeof onOpen === 'function') onOpen(ws);
    if (reconectarTimeout) { clearTimeout(reconectarTimeout); reconectarTimeout = null; }
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (typeof onMessage === 'function') onMessage(data);
    } catch (e) { console.error('[WS] Erro ao parsear mensagem:', e); }
  };
  ws.onclose = () => {
    setWsStatus(false);
    reconectarTimeout = setTimeout(() => {
      showToast('Reconectando...', 'warning', 2000);
      conectarWS(onMessage, onOpen);
    }, 3000);
  };
  ws.onerror = (err) => { console.error('[WS] Erro:', err); setWsStatus(false); };
}

function enviarWS(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  } else {
    showToast('Sem conexão com o servidor', 'error');
  }
}

// ─── Helpers de Data ──────────────────────────────────────────────────────────
function formatarData(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

// Dias de amanhã a +7 (mínimo 1 dia de antecedência)
function getProximos7Dias() {
  const dias = [];
  const hojeStr = hojeLocal();
  const [hy, hm, hd] = hojeStr.split('-').map(Number);
  const hojeBase = new Date(hy, hm - 1, hd);
  for (let i = 1; i <= 7; i++) {
    const d = new Date(hojeBase);
    d.setDate(hojeBase.getDate() + i);
    const diaSemana = d.getDay();
    dias.push({
      iso: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
      num: d.getDate(),
      nome: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      ehSabado:  diaSemana === 6,
      ehDomingo: diaSemana === 0
    });
  }
  return dias;
}

// Retorna YYYY-MM-DD no horário local (ou data de apresentação se definida)
function hojeLocal() {
  if (typeof PRESENTATION_DATE !== 'undefined' && PRESENTATION_DATE) return PRESENTATION_DATE;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function agora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Semana ISO no formato "YYYY-Wxx" (para controle de sugestão a cada 2 semanas)
function semanaISO(dateStr) {
  let baseStr = dateStr;
  if (!baseStr && typeof PRESENTATION_DATE !== 'undefined' && PRESENTATION_DATE) baseStr = PRESENTATION_DATE;
  const d = baseStr ? new Date(baseStr + 'T12:00:00') : new Date();
  d.setHours(12, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── Badge de Nível ───────────────────────────────────────────────────────────
function badgeNivel(nomeNivel) {
  const nivel = NIVEIS.find(n => n.nome === nomeNivel) || NIVEIS[0];
  return `<span class="badge-nivel badge-custom" style="--nivel-cor:${nivel.cor}">${nivel.emoji} ${nivel.nome}</span>`;
}

// Versão compacta do badge (usada no ranking e nos agendamentos do admin)
function badgeNivelLight(nomeNivel) {
  const nivel = NIVEIS.find(n => n.nome === nomeNivel) || NIVEIS[0];
  return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.75rem;font-weight:700;color:${nivel.cor};">${nivel.emoji} ${nivel.nome}</span>`;
}

// ─── Streak Dots ──────────────────────────────────────────────────────────────
function renderStreakDots(streak) {
  let html = '';
  for (let i = 0; i < 12; i++) {
    html += `<div class="streak-dot ${i < streak ? 'filled' : ''}"></div>`;
  }
  return html;
}

// ─── Cuba helpers ─────────────────────────────────────────────────────────────
// faixas: 0 = vazia, 1 = 1-10%, 2 = 11-20%, ..., 10 = 91-100%
const FAIXA_LABELS = [
  '0% — Vazia',
  '1–10% — Crítico',
  '11–20% — Crítico',
  '21–30% — Baixo',
  '31–40% — Baixo',
  '41–50% — Médio',
  '51–60% — Médio',
  '61–70% — Normal',
  '71–80% — Normal',
  '81–90% — Cheio',
  '91–100% — Cheio'
];

function faixaLabel(faixas) {
  return FAIXA_LABELS[Math.min(Math.max(faixas, 0), 10)] || FAIXA_LABELS[0];
}

function faixaPct(faixas) {
  // Retorna o ponto médio de cada faixa para a barra de progresso
  const midpoints = [0, 5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
  return midpoints[Math.min(Math.max(faixas, 0), 10)] || 0;
}

function classeProgresso(faixas) {
  if (faixas >= 7) return 'fill-high';   // 61-100%
  if (faixas >= 4) return 'fill-mid';    // 31-60%
  return 'fill-low';                     // 0-30%
}

function formatCredito(val) {
  return `R$ ${Number(val).toFixed(2)}`;
}