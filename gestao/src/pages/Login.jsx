import { useState } from 'react';
import { api } from '../lib/api.js';

export function Login({ onOk }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const entrar = async (e) => {
    e.preventDefault();
    try {
      await api.post('/login', { senha });
      onOk();
    } catch (err) {
      setErro(err.message);
    }
  };
  return (
    <div className="login">
      <form className="card stack" onSubmit={entrar}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" style={{ background: 'var(--amber-deep)' }} />
          <div className="brand-name">FZA Gestão<small style={{ color: 'var(--muted)' }}>Painel do gerente</small></div>
        </div>
        <label className="field"><span>Senha</span>
          <input type="password" className="input" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <span className="small" style={{ color: 'var(--red)' }}>{erro}</span>}
        <button className="btn primary block">Entrar</button>
      </form>
    </div>
  );
}
