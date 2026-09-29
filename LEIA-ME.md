# Cérebro Editorial FZA — publicação no Vercel com ChatGPT

Arquivos:
- `index.html` — o sistema (interface)
- `api/ia.js` — chama o ChatGPT (a chave fica só no servidor)
- `api/dados.js` — banco de dados compartilhado da equipe (Upstash Redis)
- `api/status.js` — confere a senha da equipe e a configuração
- `vercel.json` — tempo máximo das funções (a IA pode levar até 5 min)

Variáveis de ambiente no Vercel (Settings → Environment Variables):
- `SENHA_EQUIPE` — senha única que a equipe usa para entrar
- `OPENAI_API_KEY` — chave de API da OpenAI (platform.openai.com → API keys)
- `OPENAI_MODEL` — opcional; padrão `gpt-5.5`
- `KV_REST_API_URL` e `KV_REST_API_TOKEN` — criadas sozinhas ao conectar o Upstash Redis (Storage)

Depois de mudar qualquer variável: Deployments → ⋯ → Redeploy.
