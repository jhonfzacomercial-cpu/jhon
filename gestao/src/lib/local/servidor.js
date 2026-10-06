// Versão "sem servidor": a mesma API roda no navegador sobre SQLite (sql.js)
// e cada linha alterada é gravada no banco do artifact (capability `db`).
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import { SCHEMA } from '../../../server/schema.js';
import { criarApp } from '../../../server/app.js';
import { TABELAS } from '../../../server/seed.js';
import { requisitar } from './express.js';

const normalizar = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** Adaptador com a mesma interface de node:sqlite (DatabaseSync). */
function compat(sql) {
  const executar = (texto, params, coletar) => {
    const st = sql.prepare(texto);
    try {
      st.bind(params.map(normalizar));
      const linhas = [];
      while (st.step()) {
        linhas.push(st.getAsObject());
        if (coletar === 1) break;
      }
      return linhas;
    } finally {
      st.free();
    }
  };
  return {
    exec: (texto) => sql.exec(texto),
    prepare: (texto) => ({
      all: (...p) => executar(texto, p),
      get: (...p) => executar(texto, p, 1)[0],
      run: (...p) => {
        executar(texto, p);
        const changes = sql.getRowsModified();
        const id = sql.exec('SELECT last_insert_rowid()')[0].values[0][0];
        return { changes, lastInsertRowid: id };
      },
    }),
  };
}

const chaveDe = (t) => (t === 'config' ? 'chave' : 'id');
const colecao = (store, t) => store.collection(`tabelas/${t}/linhas`);

let estado = null;

async function carregar(store, sql) {
  const colunas = (t) => sql.exec(`PRAGMA table_info(${t})`)[0].values.map((v) => v[1]);
  for (const t of TABELAS) {
    const cols = colunas(t);
    const linhas = [];
    if (t === 'config') {
      const snap = await colecao(store, t).get();
      snap.docs.forEach((d) => linhas.push(d.data()));
    } else {
      let ultimo = 0;
      for (;;) {
        const snap = await colecao(store, t).where('id', '>', ultimo).orderBy('id').limit(1000).get();
        snap.docs.forEach((d) => linhas.push(d.data()));
        if (snap.size < 1000) break;
        ultimo = snap.docs[snap.size - 1].data().id;
      }
    }
    for (const l of linhas) {
      const c = cols.filter((k) => k in l);
      sql.run(`INSERT OR REPLACE INTO ${t} (${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`, c.map((k) => normalizar(l[k])));
    }
  }
}

function instalarGatilhos(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS _mudancas (tabela TEXT, chave TEXT)');
  for (const t of TABELAS) {
    const k = chaveDe(t);
    for (const [ev, ref] of [['INSERT', 'NEW'], ['UPDATE', 'NEW'], ['DELETE', 'OLD']]) {
      sql.exec(`CREATE TRIGGER IF NOT EXISTS _m_${ev}_${t} AFTER ${ev} ON ${t} BEGIN INSERT INTO _mudancas VALUES ('${t}', ${ref}.${k}); END;`);
    }
    // Troca de chave numa atualização (raro): grava também a chave antiga
    sql.exec(`CREATE TRIGGER IF NOT EXISTS _m_UPDK_${t} AFTER UPDATE ON ${t} WHEN OLD.${k} IS NOT NEW.${k} BEGIN INSERT INTO _mudancas VALUES ('${t}', OLD.${k}); END;`);
  }
}

/** Grava no banco do artifact o que mudou desde a última gravação. */
async function gravar() {
  const { sql, store } = estado;
  const r = sql.exec('SELECT DISTINCT tabela, chave FROM _mudancas');
  sql.exec('DELETE FROM _mudancas');
  if (!r.length || !store) return;
  const falhas = [];
  const tarefas = r[0].values.map(([t, k]) => async () => {
    const res = sql.exec(`SELECT * FROM ${t} WHERE ${chaveDe(t)} = ?`, [t === 'config' ? k : Number(k)]);
    const ref = colecao(store, t).doc(String(k));
    const fazer = () => {
      if (!res.length) return ref.delete();
      const { columns, values } = res[0];
      return ref.set(Object.fromEntries(columns.map((c, i) => [c, values[0][i]])));
    };
    try {
      await fazer();
    } catch (e) {
      try {
        if (e?.code !== 'unavailable') throw e;
        await new Promise((ok) => setTimeout(ok, 400 + Math.random() * 600));
        await fazer();
      } catch (e2) {
        falhas.push([t, k]);
        throw e2;
      }
    }
  });
  // Até 6 gravações simultâneas (documentos diferentes)
  let i = 0;
  const erros = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < tarefas.length) {
      const fn = tarefas[i++];
      try { await fn(); } catch (e) { erros.push(e); }
    }
  }));
  if (erros.length) {
    // Fica pendente para a próxima gravação
    for (const [t, k] of falhas) sql.run('INSERT INTO _mudancas VALUES (?, ?)', [t, String(k)]);
    const e = erros[0];
    throw new Error(e?.code === 'quota_exceeded' ? 'O espaço de armazenamento do sistema acabou. Exporte um backup e apague registros antigos.' : `Não foi possível salvar (${e?.code || e?.message || 'erro'}). Tente de novo.`);
  }
}

async function iniciar() {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.exec(SCHEMA);
  const store = window.claude?.use ? await window.claude.use('db').catch(() => null) : null;
  if (store) await carregar(store, sql);
  sql.exec('PRAGMA foreign_keys = ON');
  instalarGatilhos(sql);
  const db = compat(sql);
  estado = { sql, store, app: criarApp(db, { senha: '' }), salvando: Promise.resolve() };
  return estado;
}

let pronto = null;
export const persistente = () => !!estado?.store;

/** Mesmo contrato do fetch da API: resolve o corpo ou lança Error com a mensagem. */
export async function chamar(metodo, url, body) {
  pronto ||= iniciar();
  await pronto;
  const { status, body: resposta } = requisitar(estado.app, metodo, url, body ? structuredClone(body) : undefined);
  // Gravações em fila: uma de cada vez, na ordem das alterações
  const vez = estado.salvando.then(gravar);
  estado.salvando = vez.catch(() => {});
  await vez;
  if (status >= 400) throw new Error(resposta?.erro || `Erro ${status}`);
  return resposta;
}

/** Recarrega tudo do banco do artifact (outra aba/aparelho pode ter alterado). */
export async function recarregar() {
  if (!estado?.store) return;
  await estado.salvando;
  const novo = await iniciar();
  pronto = Promise.resolve(novo);
}

export async function servicos() {
  const use = window.claude?.use;
  const [assets, downloads] = await Promise.all([
    use ? use('assets').catch(() => null) : null,
    use ? use('downloads').catch(() => null) : null,
  ]);
  return { assets, downloads };
}
