// Bot de WhatsApp "premium" para qualificar leads de consórcio e levar até a reunião.
// Usa a API oficial (Cloud API da Meta). Precisa do Node 18 ou mais novo.

const express = require("express");
const crypto = require("crypto");

const {
  VERIFY_TOKEN,
  APP_SECRET, // recomendado: chave secreta do app na Meta, para barrar mensagens falsas
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  OWNER_NUMBER, // opcional: seu WhatsApp pessoal (só dígitos, 55 + DDD) para receber o resumo do lead
  PORT = 3000,
} = process.env;

// ====== PERSONALIZE AQUI ======
const NOME_CONSULTOR = "Bruno Senna";
const LINK_AGENDA = "https://calendly.com/bruno-senna-autorizadoademicon/30min";

// ====== ROTEIRO DA CONVERSA ======
// tipo "texto": o lead digita. "botoes": até 3 opções. "lista": até 10 opções.
// Títulos das opções: até 20 caracteres em "botoes" e 24 em "lista".
// "se": a pergunta só aparece quando a função devolve true.
// "reacao": frase curta que o bot diz antes da próxima pergunta, para soar natural.
// Para mudar, adicionar ou remover perguntas, edite só esta lista.
const OBJ = ["Imóvel", "Veículo", "Serviços"];
const PRAZOS = ["O quanto antes", "Em alguns meses", "Mais para frente"];
const NAO_SEI = "Ainda não sei";

const FAIXAS_CREDITO = {
  Imóvel: ["Até R$ 150 mil", "R$ 150 a 300 mil", "R$ 300 a 500 mil", "R$ 500 mil a 1 mi", "Acima de R$ 1 milhão"],
  Veículo: ["Até R$ 50 mil", "R$ 50 a 100 mil", "R$ 100 a 150 mil", "R$ 150 a 300 mil", "Acima de R$ 300 mil"],
  Serviços: ["Até R$ 15 mil", "R$ 15 a 30 mil", "R$ 30 a 60 mil", "R$ 60 a 100 mil", "Acima de R$ 100 mil"],
};

const PASSOS = [
  {
    chave: "nome",
    tipo: "texto",
    pergunta:
      `Olá! 👋 Que bom ter você por aqui.\n\n` +
      `Sou o assistente virtual de *${NOME_CONSULTOR}*, consultor autorizado Ademicon. ` +
      `Vou te fazer umas perguntinhas rápidas (leva uns 3 minutinhos) para montar uma simulação sob medida para você.\n\n` +
      `Para começar, *como posso te chamar?*`,
  },
  {
    chave: "objetivo",
    tipo: "botoes",
    pergunta: "Prazer, {nome}! 😊\n\nO que você pretende conquistar?",
    opcoes: OBJ,
    sinonimos: [
      /^(imovel|imoveis|casa|apartamento|apto|terreno|lote)/,
      /^(veiculo|veiculos|carro|moto|automovel|caminhao|caminhonete)/,
      /^(servico|servicos|viagem|reforma|estetica|cirurgia)/,
    ],
    reacao: (resp) =>
      ({
        Imóvel: "Ótima escolha, {nome}! 🏡 Imóvel é um plano e tanto.",
        Veículo: "Boa, {nome}! 🚗 Vamos planejar essa conquista.",
        Serviços: "Interessante, {nome}! ✨ Vamos ver o melhor caminho para isso.",
      })[resp] || "",
  },
  {
    chave: "detalhe",
    tipo: "botoes",
    se: (r) => r.objetivo === "Imóvel",
    pergunta: "Esse imóvel seria para *morar*, para *investir* ou para *construir/reformar*?",
    opcoes: ["Morar", "Investir", "Construir/reformar"],
    sinonimos: [/^(morar|moradia|residir)/, /^(investir|investimento|renda|alugar)/, /^(construir|reformar|construcao|reforma)/],
  },
  {
    chave: "detalhe",
    tipo: "lista",
    botao: "Escolher",
    se: (r) => r.objetivo === "Veículo",
    pergunta: "Que *tipo de veículo* você está pensando?",
    opcoes: ["Carro", "Moto", "Caminhão ou pesado", "Outro veículo"],
  },
  {
    chave: "detalhe",
    tipo: "texto",
    se: (r) => r.objetivo === "Serviços",
    pergunta: "Conta para mim: *qual serviço* você tem em mente?",
  },
  {
    chave: "valor",
    tipo: "lista",
    botao: "Escolher",
    pergunta: "Pensando nisso, qual *faixa de crédito* faria sentido para você?",
    opcoes: (r) => [...(FAIXAS_CREDITO[r.objetivo] || []), NAO_SEI],
  },
  {
    chave: "parcela",
    tipo: "lista",
    botao: "Escolher",
    pergunta: "E qual *parcela mensal* ficaria tranquila no seu orçamento?",
    opcoes: ["Até R$ 500", "R$ 500 a 1.000", "R$ 1.000 a 2.000", "R$ 2.000 a 4.000", "Acima de R$ 4.000", NAO_SEI],
    reacao: () => "Anotado, {nome}! 👍",
  },
  {
    chave: "prazo",
    tipo: "botoes",
    pergunta: "E para quando você gostaria de *conquistar* isso?",
    opcoes: PRAZOS,
    reacao: (resp) => (resp === PRAZOS[0] ? "Perfeito, então vamos com agilidade! ⚡" : ""),
  },
  {
    chave: "momento",
    tipo: "botoes",
    pergunta: (r) =>
      ({
        Imóvel: "Você já tem *algum imóvel em vista*?",
        Veículo: "Você já tem *algum veículo em vista*?",
        Serviços: "Você já tem o *serviço definido*?",
      })[r.objetivo] || "Você já tem algo em vista?",
    opcoes: ["Já tenho em vista", "Estou pesquisando", "Só começando"],
  },
  {
    chave: "experiencia",
    tipo: "botoes",
    pergunta: "Você já *participou de algum consórcio* antes?",
    opcoes: ["Já tenho um", "Já tive", "Seria o primeiro"],
  },
  {
    chave: "profissao",
    tipo: "texto",
    pergunta:
      "Para eu preparar uma simulação mais ajustada ao seu perfil: *qual a sua profissão ou ocupação?*",
  },
  {
    chave: "idade",
    tipo: "lista",
    botao: "Escolher",
    pergunta: "Legal! 👏 E em qual *faixa de idade* você está? É só para personalizar a simulação.",
    opcoes: ["Até 25 anos", "26 a 35 anos", "36 a 45 anos", "46 a 55 anos", "Acima de 55 anos"],
  },
  {
    chave: "cidade",
    tipo: "texto",
    pergunta: "Quase lá! 🙌 Em qual *cidade e estado* você mora?",
  },
  {
    chave: "agendar",
    tipo: "botoes",
    pergunta:
      "Obrigado, {nome}! Com tudo isso já consigo preparar uma *simulação personalizada* para o seu perfil. 🎯\n\n" +
      `O próximo passo é uma conversa online de 30 minutos com *${NOME_CONSULTOR}*, sem compromisso.\n\n` +
      "Posso te enviar a agenda?",
    opcoes: ["Quero agendar", "Agora não"],
    sinonimos: [
      /^(sim|s|quero|bora|vamos|pode|claro|ok|agendar|manda)\b/,
      /^(nao|n|agora nao|depois)\b/,
    ],
  },
];

// ====== AJUDANTES DO ROTEIRO ======
const perguntaDe = (p, r) => (typeof p.pergunta === "function" ? p.pergunta(r) : p.pergunta);
const opcoesDe = (p, r) => (typeof p.opcoes === "function" ? p.opcoes(r) : p.opcoes || []);

// Confere os limites do WhatsApp assim que o bot liga (erro cedo é melhor que erro com cliente)
for (const p of PASSOS) {
  const dinamico = typeof p.pergunta === "function" || typeof p.opcoes === "function";
  const contextos = dinamico ? OBJ.map((objetivo) => ({ objetivo })) : [{}];
  for (const r of contextos) {
    const ops = opcoesDe(p, r);
    if (perguntaDe(p, r).length > 900) throw new Error(`Pergunta longa demais: ${p.chave}`);
    if (p.tipo === "botoes" && (ops.length > 3 || ops.some((o) => o.length > 20)))
      throw new Error(`Botões inválidos em "${p.chave}" (máx. 3 opções, 20 caracteres)`);
    if (p.tipo === "lista" && (ops.length > 10 || ops.some((o) => o.length > 24)))
      throw new Error(`Lista inválida em "${p.chave}" (máx. 10 opções, 24 caracteres)`);
  }
}

// ====== MENSAGENS FIXAS ======
const MSG = {
  link: (nome) =>
    `Perfeito, ${nome}! 🙌\n\nEscolha o melhor dia e horário por aqui:\n${LINK_AGENDA}\n\n` +
    `Na reunião eu apresento as opções de consórcio para o seu perfil, com simulação personalizada.\n\n` +
    `_As condições e valores são apresentados na reunião, conforme as regras de cada grupo._`,
  recusa: (nome) =>
    `Sem problema, ${nome}! Fico à disposição. 😊\n\n` +
    `Se mudar de ideia, a agenda fica aqui:\n${LINK_AGENDA}`,
  parar:
    "Tudo bem! Encerrei o atendimento automático por aqui. " +
    "Quando quiser retomar, é só me chamar. 😊",
  posFim: (nome) =>
    `Recebi sua mensagem, ${nome}! ${NOME_CONSULTOR} vai te responder em breve. 😊\n\n` +
    `A agenda continua disponível:\n${LINK_AGENDA}`,
  repetir: "Não consegui entender essa resposta 😅 Vou repetir:\n\n",
};

// ====== UTILIDADES ======
const norm = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const UM_DIA = 24 * 60 * 60 * 1000;
const sessoes = new Map(); // telefone -> { passo, respostas, fim, atualizado, avisouPos }
const jaProcessadas = new Set(); // evita responder duas vezes à mesma mensagem

function primeiroNome(s) {
  const n = (s.respostas.nome || "").trim().split(/\s+/)[0] || "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}

function proximoPasso(s) {
  for (let i = s.passo + 1; i < PASSOS.length; i++) {
    const p = PASSOS[i];
    if (!p.se || p.se(s.respostas)) return i;
  }
  return PASSOS.length;
}

// ====== ENVIO ======
async function post(payload) {
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error("Erro ao enviar:", r.status, await r.text());
  } catch (e) {
    console.error("Falha de rede ao enviar:", e.message);
  }
}

const enviarTexto = (para, texto) =>
  post({ to: para, type: "text", text: { body: texto } });

function enviarPasso(para, s, prefixo = "") {
  const p = PASSOS[s.passo];
  const texto = (prefixo + perguntaDe(p, s.respostas)).replace(/\{nome\}/g, primeiroNome(s));
  const ops = opcoesDe(p, s.respostas);

  if (p.tipo === "texto") return enviarTexto(para, texto);

  if (p.tipo === "botoes") {
    return post({
      to: para,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: texto },
        action: {
          buttons: ops.map((o, i) => ({
            type: "reply",
            reply: { id: `${p.chave}:${i}`, title: o },
          })),
        },
      },
    });
  }

  return post({
    to: para,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: texto },
      action: {
        button: p.botao || "Escolher",
        sections: [
          {
            title: "Opções",
            rows: ops.map((o, i) => ({ id: `${p.chave}:${i}`, title: o })),
          },
        ],
      },
    },
  });
}

// ====== LEITURA DA RESPOSTA ======
function extrairResposta(m, passo, ops) {
  // Toque em botão ou item da lista
  if (m.type === "interactive") {
    const r = m.interactive?.button_reply || m.interactive?.list_reply;
    if (!r || passo.tipo === "texto") return null;
    const [chave, i] = String(r.id).split(":");
    if (chave !== passo.chave) return null; // botão de pergunta antiga
    return ops[Number(i)] ?? null;
  }

  if (m.type !== "text") return null;
  const t = m.text.body.trim();

  if (passo.tipo === "texto") return t.length >= 2 ? t.slice(0, 100) : null;

  // Lead digitou em vez de tocar: aceita número, sinônimo ou nome da opção
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= ops.length) return ops[n - 1];

  const tn = norm(t);
  if (passo.sinonimos) {
    const i = passo.sinonimos.findIndex((re) => re.test(tn));
    if (i >= 0) return ops[i];
  }
  if (tn.length >= 3) {
    const achou = ops.find((o) => norm(o) === tn || norm(o).startsWith(tn));
    if (achou) return achou;
  }
  return null;
}

// ====== CLASSIFICAÇÃO E AVISO PARA VOCÊ ======
function classificar(r) {
  let pts = 0;
  pts += { "O quanto antes": 3, "Em alguns meses": 2 }[r.prazo] ?? 0;
  pts += { "Já tenho em vista": 2, "Estou pesquisando": 1 }[r.momento] ?? 0;
  if (r.agendar === "Quero agendar") pts += 2;
  return pts >= 5 ? "🔥 Lead quente" : pts >= 3 ? "🟡 Lead morno" : "🔵 Lead frio";
}

function resumo(telefone, s) {
  const r = s.respostas;
  return (
    `${classificar(r)} — ${r.agendar === "Quero agendar" ? "pediu a agenda" : "não agendou"}\n\n` +
    `👤 ${r.nome}\n📱 https://wa.me/${telefone}\n` +
    `🎯 Objetivo: ${r.objetivo}${r.detalhe ? " — " + r.detalhe : ""}\n` +
    `💰 Crédito: ${r.valor}\n💳 Parcela: ${r.parcela}\n` +
    `⏱️ Prazo: ${r.prazo}\n🔎 Momento: ${r.momento}\n📚 Consórcio antes: ${r.experiencia}\n` +
    `💼 Profissão: ${r.profissao}\n🎂 Idade: ${r.idade}\n📍 Cidade: ${r.cidade}`
  );
}

async function avisarDono(texto) {
  console.log("\n" + texto + "\n");
  if (OWNER_NUMBER) await enviarTexto(OWNER_NUMBER, texto);
}

// ====== LÓGICA DA CONVERSA ======
async function finalizar(telefone, s) {
  const aceitou = s.respostas.agendar === "Quero agendar";
  s.fim = aceitou ? "agendou" : "recusou";
  const nome = primeiroNome(s);
  await enviarTexto(telefone, aceitou ? MSG.link(nome) : MSG.recusa(nome));
  await avisarDono(resumo(telefone, s));
}

async function aposFim(telefone, s, m) {
  if (s.fim === "parou") return;
  const nome = primeiroNome(s) || "tudo bem";
  const conteudo = m.type === "text" ? m.text.body : `[${m.type}]`;
  await avisarDono(`💬 Mensagem de ${s.respostas.nome || "lead"} (https://wa.me/${telefone}):\n${conteudo}`);
  if (!s.avisouPos) {
    s.avisouPos = true;
    await enviarTexto(telefone, MSG.posFim(nome));
  }
}

async function tratar(m) {
  const telefone = m.from;
  const textoLivre = m.type === "text" ? m.text.body : "";
  let s = sessoes.get(telefone);

  if (s && Date.now() - s.atualizado > UM_DIA) {
    sessoes.delete(telefone);
    s = null;
  }

  // Lead pediu para parar
  if (/^(parar|sair|cancelar|stop)$/.test(norm(textoLivre))) {
    sessoes.set(telefone, {
      passo: 0, respostas: s?.respostas || {}, fim: "parou", atualizado: Date.now(),
    });
    return enviarTexto(telefone, MSG.parar);
  }

  // Primeira mensagem: começa o roteiro
  if (!s) {
    s = { passo: 0, respostas: {}, fim: null, atualizado: Date.now() };
    sessoes.set(telefone, s);
    // Se o lead tocou num botão mas o servidor esqueceu a conversa (reinício), avisa com educação
    const aviso =
      m.type === "interactive"
        ? "Desculpe, nossa conversa foi reiniciada por aqui. Vamos recomeçar? 😊\n\n"
        : "";
    return enviarPasso(telefone, s, aviso);
  }
  s.atualizado = Date.now();

  if (s.fim) return aposFim(telefone, s, m);

  const passo = PASSOS[s.passo];
  const resposta = extrairResposta(m, passo, opcoesDe(passo, s.respostas));
  if (resposta === null) return enviarPasso(telefone, s, MSG.repetir);

  s.respostas[passo.chave] =
    passo.chave === "nome"
      ? resposta.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
      : resposta;
  const reacao = passo.reacao ? passo.reacao(resposta, s.respostas) : "";
  s.passo = proximoPasso(s);
  if (s.passo < PASSOS.length) return enviarPasso(telefone, s, reacao ? reacao + "\n\n" : "");
  return finalizar(telefone, s);
}

// ====== SERVIDOR (webhook da Meta) ======
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

if (!APP_SECRET) {
  console.warn("⚠️ APP_SECRET não definido: o webhook vai aceitar qualquer requisição. Defina para mais segurança.");
}

// Confere que a mensagem veio mesmo da Meta (assinatura HMAC), e não de um curioso
function assinaturaValida(req) {
  if (!APP_SECRET) return true;
  const recebida = Buffer.from(String(req.headers["x-hub-signature-256"] || ""));
  const esperada = Buffer.from(
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody || "").digest("hex")
  );
  return recebida.length === esperada.length && crypto.timingSafeEqual(recebida, esperada);
}

app.get("/", (_req, res) => res.send("Bot no ar ✅"));

// A Meta chama isto uma vez para confirmar o webhook
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// A Meta chama isto a cada mensagem recebida
app.post("/webhook", (req, res) => {
  if (!assinaturaValida(req)) return res.sendStatus(401);
  res.sendStatus(200); // responde rápido; o processamento segue abaixo
  try {
    const mensagens = req.body?.entry?.[0]?.changes?.[0]?.value?.messages || [];
    for (const m of mensagens) {
      if (jaProcessadas.has(m.id)) continue;
      if (jaProcessadas.size > 5000) jaProcessadas.clear();
      jaProcessadas.add(m.id);
      tratar(m).catch((e) => console.error("Erro:", e));
    }
  } catch (e) {
    console.error(e);
  }
});

app.listen(PORT, () => console.log(`Bot rodando na porta ${PORT}`));
