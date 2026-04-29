// ─── RU-Smart | server.js ─────────────────────────────────────────────────────
const WebSocket = require('ws');
const fs  = require('fs');
const path = require('path');
const http = require('http');

const PORT      = 3000;
const HOST      = '0.0.0.0';
const DB_PATH   = path.join(__dirname, 'data.json');
const PRECO_ALMOCO = 2.50;
const PRECO_JANTA  = 2.00;
const BONUS_STREAK = 2.50;

// ─── DATA DE APRESENTAÇÃO ─────────────────────────────────────────────────────
// Para normalizar após a apresentação, altere PRESENTATION_DATE para null
const PRESENTATION_DATE = '2026-04-29'; // null = usa a data real do sistema
// ─────────────────────────────────────────────────────────────────────────────

const NIVEIS = [
  { nome: 'Faminto',      min: 0,   max: 20,  pesoVoto: 1,  podeSugerir: false },
  { nome: 'Frequentador', min: 21,  max: 50,  pesoVoto: 2,  podeSugerir: false },
  { nome: 'Veterano',     min: 51,  max: 100, pesoVoto: 3,  podeSugerir: false },
  { nome: 'Lendário',     min: 101, max: 200, pesoVoto: 4,  podeSugerir: false },
  { nome: 'Marmiteiro',   min: 201, max: Infinity, pesoVoto: 5, podeSugerir: true }
];

function getNivel(total) {
  return NIVEIS.find(n => total >= n.min && total <= n.max) || NIVEIS[0];
}

// ─── DB ───────────────────────────────────────────────────────────────────────
function lerDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch(e) { console.error('[DB] Erro:', e.message); return null; }
}
function salvarDB(db) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8'); }
  catch(e) { console.error('[DB] Erro ao salvar:', e.message); }
}

// ─── Data helpers (fuso local via string aritmética) ──────────────────────────
function hojeStr() {
  if (PRESENTATION_DATE) return PRESENTATION_DATE;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function amanhaStr() {
  const base = PRESENTATION_DATE ? new Date(PRESENTATION_DATE + 'T12:00:00') : new Date();
  base.setDate(base.getDate() + 1);
  return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
}
function ehDomingo(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d).getDay() === 0;
}
function ehSabado(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d).getDay() === 6;
}
// Semana ISO no formato "YYYY-Wxx" para controle de sugestão a cada 2 semanas
function semanaISO(dateStr) {
  const base = dateStr || PRESENTATION_DATE || null;
  const d = base ? new Date(base + 'T12:00:00') : new Date();
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const y1 = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-W${String(Math.ceil((((d - y1) / 86400000) + 1) / 7)).padStart(2,'0')}`;
}
function formatCredito(val) {
  return `R$ ${Number(val).toFixed(2)}`;
}
function atualizarHistorico(db, data, turno) {
  if (!db.historicoSemanal) db.historicoSemanal = [];
  const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  let entry = db.historicoSemanal.find(h => h.data === data);
  if (!entry) {
    const [y,m,d] = data.split('-').map(Number);
    entry = { data, diaSemana: dias[new Date(y,m-1,d).getDay()], almocos: 0, jantas: 0 };
    db.historicoSemanal.push(entry);
  }
  if (turno === 'almoco') entry.almocos++; else entry.jantas++;
}

// ─── HTTP (serve /public) ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end('Forbidden'); return; }
  const ext = path.extname(filePath);
  const ct = { '.html':'text/html;charset=utf-8', '.css':'text/css', '.js':'application/javascript', '.json':'application/json' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': ct[ext] || 'text/plain' });
    res.end(data);
  });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });
const clientes = new Set();

function broadcast(msg, exceto=null) {
  const json = JSON.stringify(msg);
  clientes.forEach(c => { if (c!==exceto && c.readyState===WebSocket.OPEN) c.send(json); });
}
function enviar(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
const handlers = {

  GET_STATE(ws) {
    const db = lerDB();
    if (!db) { enviar(ws, { type:'ERROR', message:'Erro ao carregar banco.' }); return; }
    enviar(ws, { type:'INIT', data: db });
  },

  // Login por USUARIO (nome+sobrenome minúsculo) ou matrícula
  LOGIN(ws, data) {
    const db = lerDB();
    if (!db) { enviar(ws, { type:'LOGIN_ERRO', message:'Erro interno.' }); return; }
    const inputLogin = (data.usuario || '').toLowerCase().trim();
    const senha = data.senha || '';
    const aluno = Object.values(db.alunos).find(a =>
      (a.usuario === inputLogin || a.matricula === inputLogin) && a.senha === senha
    );
    if (!aluno) { enviar(ws, { type:'LOGIN_ERRO', message:'Usuário ou senha incorretos.' }); return; }
    enviar(ws, { type:'LOGIN_OK', alunoId: aluno.id, aluno, db });
    console.log(`[LOGIN] ${aluno.nome}`);
  },

  SOLICITAR_REFEICAO(ws, data) {
    const { alunoId, data: dataRef, turno } = data;
    if (!alunoId||!dataRef||!turno) { enviar(ws,{type:'ERROR',message:'Dados inválidos.'}); return; }
    const db = lerDB();
    const aluno = db.alunos[alunoId];
    if (!aluno) { enviar(ws,{type:'ERROR',message:'Aluno não encontrado.'}); return; }
    // Mínimo 1 dia antes (comparação de strings YYYY-MM-DD é segura)
    if (dataRef <= hojeStr()) {
      enviar(ws,{type:'ERROR',message:'Agendamento deve ser feito com pelo menos 1 dia de antecedência.'}); return;
    }
    if (ehDomingo(dataRef)) { enviar(ws,{type:'ERROR',message:'O RU não funciona aos domingos.'}); return; }
    if (ehSabado(dataRef) && turno==='janta') { enviar(ws,{type:'ERROR',message:'Aos sábados só há almoço.'}); return; }
    const jaAg = (aluno.agendamentos||[]).some(a=>a.data===dataRef&&a.turno===turno&&a.status!=='cancelado');
    if (jaAg) { enviar(ws,{type:'ERROR',message:'Você já tem agendamento para este período.'}); return; }
    const ag = { id:`ag_${Date.now()}`, alunoId, data:dataRef, turno, status:'solicitado', criadoEm:new Date().toISOString() };
    aluno.agendamentos = aluno.agendamentos||[];
    aluno.agendamentos.push(ag);
    db.agendamentos.push(ag);
    // Métricas: conta para o dia exato da refeição
    if (dataRef === hojeStr()) {
      if (turno==='almoco') db.metricas.almocosHoje=(db.metricas.almocosHoje||0)+1;
      else db.metricas.jantasHoje=(db.metricas.jantasHoje||0)+1;
    }
    salvarDB(db);
    enviar(ws,{type:'SUCCESS',message:`${turno==='almoco'?'Almoço':'Janta'} agendado para ${formatarData(dataRef)}!`,agendamento:ag});
    broadcast({type:'REFEICAO_SOLICITADA',agendamento:ag,aluno:{id:aluno.id,nome:aluno.nome},metricas:db.metricas});
    console.log(`[AG] ${aluno.nome} → ${turno} ${dataRef}`);
  },

  CANCELAR_AGENDAMENTO(ws, data) {
    const { agendamentoId, alunoId } = data;
    const db = lerDB();
    const aluno = db.alunos[alunoId];
    if (!aluno) { enviar(ws,{type:'ERROR',message:'Aluno não encontrado.'}); return; }
    const agG = db.agendamentos.find(a=>a.id===agendamentoId);
    const agA = (aluno.agendamentos||[]).find(a=>a.id===agendamentoId);
    if (!agG||!agA) { enviar(ws,{type:'ERROR',message:'Agendamento não encontrado.'}); return; }
    // Perde streak somente se cancelar no próprio dia (já que agendamento é sempre futuro, isso é raro)
    const perdeuStreak = agG.data === hojeStr();
    agG.status='cancelado'; agA.status='cancelado';
    if (perdeuStreak) aluno.streakAtual=0;
    if (agG.data===hojeStr()) {
      if (agG.turno==='almoco') db.metricas.almocosHoje=Math.max(0,(db.metricas.almocosHoje||0)-1);
      else db.metricas.jantasHoje=Math.max(0,(db.metricas.jantasHoje||0)-1);
    }
    salvarDB(db);
    enviar(ws,{type:'SUCCESS',message:perdeuStreak?'Cancelado. Streak zerado.':'Cancelado sem perda de streak.'});
    broadcast({type:'AGENDAMENTO_CANCELADO',agendamentoId,alunoId,perdeuStreak,metricas:db.metricas});
  },

  QR_SCAN(ws, data) {
    const { alunoId, turno, data: dataRef } = data;
    const db = lerDB();
    const aluno = db.alunos[alunoId];
    if (!aluno) { enviar(ws,{type:'ERROR',message:'Aluno não encontrado.'}); return; }
    const diaHoje = dataRef || hojeStr();
    const ehResidente = aluno.residente === true;
    // Anti-duplo
    const jaConsumiu = (aluno.agendamentos||[]).find(a=>a.data===diaHoje&&a.turno===turno&&a.status==='consumido');
    if (jaConsumiu) {
      enviar(ws,{type:'ERROR',message:'QR Code já registrado neste turno hoje!'}); return;
    }
    const ag = (aluno.agendamentos||[]).find(a=>a.data===diaHoje&&a.turno===turno&&a.status==='solicitado');
    const valor = turno==='almoco'?PRECO_ALMOCO:PRECO_JANTA;
    if (!ag) {
      aluno.streakAtual=0;
      if (ehResidente || aluno.creditos>=valor) {
        if (!ehResidente) aluno.creditos=Math.round((aluno.creditos-valor)*100)/100;
        aluno.totalConsumidas=(aluno.totalConsumidas||0)+1;
        aluno.nivel=getNivel(aluno.totalConsumidas).nome;
        const agAv={id:`ag_av_${Date.now()}`,alunoId,data:diaHoje,turno,status:'consumido',criadoEm:new Date().toISOString(),consumidoEm:new Date().toISOString(),avulso:true};
        aluno.agendamentos.push(agAv); db.agendamentos.push(agAv);
        atualizarHistorico(db,diaHoje,turno);
        if(turno==='almoco') db.metricas.almocosConsumidosHoje=(db.metricas.almocosConsumidosHoje||0)+1;
        else db.metricas.jantasConsumidosHoje=(db.metricas.jantasConsumidosHoje||0)+1;
        salvarDB(db);
        const msgTxt = ehResidente
          ? `⚠️ Sem agendamento prévio (Residente). Consumo registrado. Streak zerado.`
          : `⚠️ Sem agendamento prévio. Debitado ${formatCredito(valor)}. Streak zerado.`;
        enviar(ws,{type:'ERROR',message:msgTxt});
        broadcast({type:'CONSUMO_CONFIRMADO',agendamentoId:agAv.id,aluno:{...aluno},turno,valor:ehResidente?0:valor,metricas:db.metricas});
      } else {
        salvarDB(db);
        enviar(ws,{type:'ERROR',message:'Sem agendamento e sem saldo. Acesso negado. Streak zerado.'});
      }
      return;
    }
    if (!ehResidente && aluno.creditos<valor) {
      enviar(ws,{type:'ERROR',message:`Saldo insuficiente (${formatCredito(aluno.creditos)}).`}); return;
    }
    ag.status='consumido'; ag.consumidoEm=new Date().toISOString();
    const agG=db.agendamentos.find(a=>a.id===ag.id);
    if(agG){agG.status='consumido';agG.consumidoEm=ag.consumidoEm;}
    if (!ehResidente) aluno.creditos=Math.round((aluno.creditos-valor)*100)/100;
    aluno.totalConsumidas=(aluno.totalConsumidas||0)+1;
    aluno.streakAtual=(aluno.streakAtual||0)+1;
    let ganhouBonus=false;
    if(aluno.streakAtual>=12){
      aluno.creditos=Math.round((aluno.creditos+BONUS_STREAK)*100)/100;
      aluno.streakAtual=0; ganhouBonus=true;
    }
    aluno.nivel=getNivel(aluno.totalConsumidas).nome;
    if(turno==='almoco') db.metricas.almocosConsumidosHoje=(db.metricas.almocosConsumidosHoje||0)+1;
    else db.metricas.jantasConsumidosHoje=(db.metricas.jantasConsumidosHoje||0)+1;
    atualizarHistorico(db,diaHoje,turno);
    salvarDB(db);
    const saldoMsg = ehResidente ? '(Residente — gratuito)' : `Saldo: ${formatCredito(aluno.creditos)}`;
    const msg={type:'CONSUMO_CONFIRMADO',agendamentoId:ag.id,aluno:{...aluno},turno,valor:ehResidente?0:valor,metricas:db.metricas};
    enviar(ws,{type:'SUCCESS',message:`Bem-vindo(a) ${aluno.nome.split(' ')[0]}! ${ehResidente?'🏠 Residente':'-'+formatCredito(valor)} | ${saldoMsg}`});
    broadcast(msg);
    if(ganhouBonus) broadcast({type:'STREAK_BONUS',alunoId,novoSaldo:aluno.creditos});
    console.log(`[QR] ${aluno.nome} → ${turno} | ${ehResidente?'RESIDENTE':'-'+formatCredito(valor)} | streak:${aluno.streakAtual}`);
  },

  ADICIONAR_CREDITO(ws, data) {
    const {alunoId,valor,metodo}=data;
    if(!valor||valor<1){enviar(ws,{type:'ERROR',message:'Valor mínimo: R$ 1,00.'});return;}
    const db=lerDB(); const aluno=db.alunos[alunoId];
    if(!aluno){enviar(ws,{type:'ERROR',message:'Aluno não encontrado.'});return;}
    aluno.creditos=Math.round((aluno.creditos+valor)*100)/100;
    salvarDB(db);
    const r={type:'CREDITO_ADICIONADO',alunoId,valor,novoSaldo:aluno.creditos,metodo};
    enviar(ws,{type:'SUCCESS',message:`${formatCredito(valor)} adicionados via ${metodo||'PIX'}!`,novoSaldo:aluno.creditos});
    broadcast(r);
  },

  SOLICITAR_SAQUE(ws, data) {
    const {alunoId,valor,chavePix}=data;
    const db=lerDB(); const aluno=db.alunos[alunoId];
    if(!aluno){enviar(ws,{type:'ERROR',message:'Aluno não encontrado.'});return;}
    if(valor>aluno.creditos){enviar(ws,{type:'ERROR',message:'Saldo insuficiente.'});return;}
    aluno.creditos=Math.round((aluno.creditos-valor)*100)/100;
    const saque={id:`saque_${Date.now()}`,alunoId,valor,chavePix:chavePix||null,novoSaldo:aluno.creditos,status:'pendente',criadoEm:new Date().toISOString()};
    db.saquesAdm=db.saquesAdm||[]; db.saquesAdm.push(saque);
    salvarDB(db);
    enviar(ws,{type:'SAQUE_SOLICITADO',alunoId,valor,novoSaldo:aluno.creditos,saque});
    broadcast({type:'SAQUE_SOLICITADO',alunoId,valor,novoSaldo:aluno.creditos,saque});
  },

  PROCESSAR_SAQUE(ws, data) {
    const db=lerDB(); db.saquesAdm=(db.saquesAdm||[]).filter(s=>s.id!==data.saqueId);
    salvarDB(db); enviar(ws,{type:'SUCCESS',message:'Saque processado.'});
  },

  ATUALIZAR_CUBA(ws, data) {
    const { id } = data;
    const faixasRecebidas = Number.parseInt(data.faixas, 10);
    const distancia = Number.isFinite(Number(data.distancia)) ? Number(data.distancia) : null;

    const db = lerDB();
    if (!db) { enviar(ws, { type:'ERROR', message:'Erro ao carregar banco.' }); return; }
    if (!db.cubas) db.cubas = {};
    if (!id || !db.cubas[id]) {
      console.log(`[CUBA] ID inválido recebido: ${id}`);
      enviar(ws, { type:'ERROR', message:`Cuba não encontrada: ${id}` });
      return;
    }
    if (!Number.isFinite(faixasRecebidas)) {
      enviar(ws, { type:'ERROR', message:'Valor de faixas inválido.' });
      return;
    }

    const faixas = Math.min(10, Math.max(0, faixasRecebidas));
    db.cubas[id].faixas = faixas;
    db.cubas[id].ultimaAtualizacao = new Date().toISOString();
    if (distancia !== null) db.cubas[id].distanciaCm = Math.round(distancia * 100) / 100;

    salvarDB(db);

    const payload = { type:'CUBA_UPDATE', cubas:db.cubas, cuba:db.cubas[id] };
    broadcast(payload);
    enviar(ws, { type:'SUCCESS', message:`Cuba ${db.cubas[id].nome} atualizada para ${faixas}/10.` });
    console.log(`[CUBA] ${id} -> ${faixas}/10${distancia !== null ? ` | ${distancia.toFixed(2)} cm` : ''}`);
  },

  VOTAR_ENQUETE(ws, data) {
    const {enqueteId,opcaoId,alunoId}=data;
    const db=lerDB();
    const eq=(db.enquetes||[]).find(e=>e.id===enqueteId);
    if(!eq){enviar(ws,{type:'ERROR',message:'Enquete não encontrada.'});return;}
    if(eq.votantes&&eq.votantes.includes(alunoId)){enviar(ws,{type:'ERROR',message:'Você já votou.'});return;}
    const aluno=db.alunos[alunoId];
    const nivel=aluno?getNivel(aluno.totalConsumidas||0):NIVEIS[0];
    const peso=nivel.pesoVoto||1;
    const opcao=eq.opcoes.find(o=>o.id===opcaoId);
    if(!opcao){enviar(ws,{type:'ERROR',message:'Opção não encontrada.'});return;}
    opcao.votos+=peso;
    eq.votantes=eq.votantes||[]; eq.votantes.push(alunoId);
    salvarDB(db);
    broadcast({type:'ENQUETE_UPDATE',enquetes:db.enquetes});
    enviar(ws,{type:'SUCCESS',message:peso>1?`Voto registrado com peso ${peso}x!`:'Voto registrado!'});
  },

  CRIAR_ENQUETE(ws, data) {
    const {titulo,opcoes}=data;
    if(!titulo||!opcoes||opcoes.length<2){enviar(ws,{type:'ERROR',message:'Título e ≥2 opções obrigatórios.'});return;}
    const db=lerDB(); db.enquetes=db.enquetes||[];
    const eq={id:`enquete_${Date.now()}`,titulo,status:'ativa',criadoPor:'admin',opcoes:opcoes.map((t,i)=>({id:`op${i+1}`,texto:t,votos:0})),votantes:[]};
    db.enquetes.push(eq); salvarDB(db);
    broadcast({type:'ENQUETE_UPDATE',enquetes:db.enquetes});
    enviar(ws,{type:'SUCCESS',message:'Enquete criada!'});
  },

  ENCERRAR_ENQUETE(ws, data) {
    const db=lerDB();
    const eq=(db.enquetes||[]).find(e=>e.id===data.enqueteId);
    if(!eq){enviar(ws,{type:'ERROR',message:'Enquete não encontrada.'});return;}
    eq.status='encerrada'; salvarDB(db);
    broadcast({type:'ENQUETE_UPDATE',enquetes:db.enquetes});
    enviar(ws,{type:'SUCCESS',message:'Enquete encerrada.'});
  },

  // Sugestão de alimento — custa 20 refeições, só Marmiteiro, sem limite de tempo
  ENVIAR_SUGESTAO(ws, data) {
    const {alunoId,sugestao}=data;
    if(!sugestao||sugestao.trim().length<3){enviar(ws,{type:'ERROR',message:'Sugestão muito curta.'});return;}
    const db=lerDB(); const aluno=db.alunos[alunoId];
    if(!aluno){enviar(ws,{type:'ERROR',message:'Aluno não encontrado.'});return;}
    const nivel=getNivel(aluno.totalConsumidas||0);
    if(!nivel.podeSugerir){enviar(ws,{type:'ERROR',message:'Apenas Marmiteiros podem enviar sugestões.'});return;}
    // Gasta 20 refeições
    const CUSTO=20;
    if((aluno.totalConsumidas||0)<CUSTO){enviar(ws,{type:'ERROR',message:`Você precisa ter pelo menos ${CUSTO} refeições para sugerir. Atual: ${aluno.totalConsumidas||0}.`});return;}
    aluno.totalConsumidas=Math.max(0,(aluno.totalConsumidas||0)-CUSTO);
    aluno.nivel=getNivel(aluno.totalConsumidas).nome;
    aluno.ultimaSugestaoSemana=semanaISO();
    db.sugestoes=db.sugestoes||[];
    db.sugestoes.push({id:`sug_${Date.now()}`,alunoId,nomeAluno:aluno.nome,texto:sugestao.trim(),criadoEm:new Date().toISOString(),semana:semanaISO()});
    salvarDB(db);
    broadcast({type:'SUGESTAO_NOVA',sugestoes:db.sugestoes,aluno:{...aluno}});
    enviar(ws,{type:'SUGESTAO_OK',message:`Sugestão enviada! 20 refeições descontadas. Total: ${aluno.totalConsumidas}`,aluno:{...aluno}});
  },

  // Cancelar sugestão (pelo próprio aluno — devolve as 20 refeições)
  CANCELAR_SUGESTAO(ws, data) {
    const {alunoId, sugestaoId} = data;
    const db = lerDB();
    const aluno = db.alunos[alunoId];
    if(!aluno){enviar(ws,{type:'ERROR',message:'Aluno não encontrado.'});return;}
    db.sugestoes = db.sugestoes||[];
    const idx = db.sugestoes.findIndex(s=>s.id===sugestaoId&&s.alunoId===alunoId);
    if(idx===-1){enviar(ws,{type:'ERROR',message:'Sugestão não encontrada.'});return;}
    db.sugestoes.splice(idx,1);
    // Devolve as 20 refeições
    const CUSTO=20;
    aluno.totalConsumidas = (aluno.totalConsumidas||0)+CUSTO;
    aluno.nivel = getNivel(aluno.totalConsumidas).nome;
    aluno.ultimaSugestaoSemana = null;
    salvarDB(db);
    broadcast({type:'SUGESTAO_NOVA',sugestoes:db.sugestoes,aluno:{...aluno}});
    enviar(ws,{type:'SUGESTAO_CANCELADA',message:`Sugestão cancelada. ${CUSTO} refeições devolvidas.`,aluno:{...aluno}});
  },

  // Consumir sugestão (pelo admin — remove sem devolver refeições)

  CONSUMIR_SUGESTAO(ws, data) {
    const {sugestaoId} = data;
    const db = lerDB();
    db.sugestoes = db.sugestoes||[];
    const idx = db.sugestoes.findIndex(s=>s.id===sugestaoId);
    if(idx===-1){enviar(ws,{type:'ERROR',message:'Sugestão não encontrada.'});return;}
    db.sugestoes.splice(idx,1);
    salvarDB(db);
    broadcast({type:'SUGESTAO_NOVA',sugestoes:db.sugestoes});
    enviar(ws,{type:'SUCCESS',message:'Sugestão consumida com sucesso!'});
  },

  // Cardápio — atualizar/salvar
  SALVAR_CARDAPIO(ws, data) {
    const {data:dataCard,turno,cardapioItem}=data;
    if(!dataCard||!turno||!cardapioItem){enviar(ws,{type:'ERROR',message:'Dados incompletos.'});return;}
    const db=lerDB();
    db.cardapio=db.cardapio||{};
    db.cardapio[dataCard]=db.cardapio[dataCard]||{};
    db.cardapio[dataCard][turno]=cardapioItem;
    salvarDB(db);
    broadcast({type:'CARDAPIO_UPDATE',cardapio:db.cardapio});
    enviar(ws,{type:'SUCCESS',message:`Cardápio de ${turno==='almoco'?'Almoço':'Janta'} atualizado!`});
  },
};

function formatarData(dateStr) {
  if(!dateStr)return'—';
  const [y,m,d]=dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ─── WS Connection ────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  clientes.add(ws);
  console.log(`[WS] +1 cliente | total: ${clientes.size}`);
  ws.on('message', raw => {
    try {
      const data = JSON.parse(raw.toString());
      const handler = handlers[data.type];
      if (handler) handler(ws, data);
      else enviar(ws, { type:'ERROR', message:`Tipo desconhecido: ${data.type}` });
    } catch(e) {
      console.error('[WS] Erro:', e.message);
      enviar(ws, { type:'ERROR', message:'Erro interno.' });
    }
  });
  ws.on('close', () => { clientes.delete(ws); console.log(`[WS] -1 cliente | total: ${clientes.size}`); });
  ws.on('error', err => { console.error('[WS]', err.message); clientes.delete(ws); });
});

server.listen(PORT, () => {
  console.log(`\n🍽️  RU-Smart v2 — http://localhost:${PORT}`);
  console.log(`\n👤 Usuários:`);
  console.log(`   gabrielalmeida / 12345678`);
  console.log(`   alexduarte      / 12345678`);
  console.log(`   valderineto     / 12345678`);
  console.log(`\n🔐 Admin: admin / admin123`);
  console.log(`   http://localhost:${PORT}/admin.html\n`);
});