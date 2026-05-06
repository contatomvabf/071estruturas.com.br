# Contact Worker (Turnstile + FormSubmit)

Este Worker recebe o envio do formulario, valida o token do Cloudflare Turnstile no servidor e, somente em caso de sucesso, encaminha para o FormSubmit.

## 1) Pre-requisitos

- Conta Cloudflare com Turnstile criado (site key + secret key)
- Node.js instalado
- Wrangler CLI: `npm i -g wrangler`
- Login: `wrangler login`

## 2) Variaveis secretas

Na pasta `worker`, execute:

```bash
wrangler secret put TURNSTILE_SECRET_KEY
```

Opcional:

```bash
wrangler secret put FORMSUBMIT_ENDPOINT
wrangler secret put SENDER_EMAIL
wrangler secret put ALLOWED_ORIGIN
wrangler secret put ALLOWED_ORIGINS
```

- `FORMSUBMIT_ENDPOINT` exemplo: `https://formsubmit.co/ajax/071estruturas@gmail.com`
- `SENDER_EMAIL` exemplo: `071estruturas@gmail.com` (remetente fixo)
- `ALLOWED_ORIGIN` exemplo: `https://seu-dominio.com` (dominio unico)
- `ALLOWED_ORIGINS` exemplo: `https://seu-dominio.com,https://www.seu-dominio.com` (multiplos dominios)

Use apenas um dos dois (`ALLOWED_ORIGIN` ou `ALLOWED_ORIGINS`).

## 3) Deploy

Na pasta `worker`:

```bash
wrangler secret put ALLOWED_ORIGINS
```

Valor para este projeto:

```text
https://www.071estruturas.com.br,https://071estruturas.com.br
```

Depois rode:

```bash
wrangler deploy
```

Anote a URL gerada, ex.: `https://estruturas-contact-worker.<subdominio>.workers.dev`

## 4) Frontend

No arquivo `js/script.js`, troque:

- `contactEndpoint` para a URL do Worker.

O frontend ja envia JSON (`Content-Type: application/json`) para o Worker.

No `index.html`, troque:

- `YOUR_TURNSTILE_SITE_KEY` pela sua site key real.

No Turnstile (Cloudflare Dashboard), adicione os hostnames:

- `www.071estruturas.com.br`
- `071estruturas.com.br`
