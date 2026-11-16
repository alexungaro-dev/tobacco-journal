# Milestone 02, fase 2 — Supabase Auth

Branch `feature/supabase-auth`, creato dall'ultimo `origin/main` disponibile.
La migrazione della fase 1 è già su main. Nessuna modifica SQL o alle policy RLS.
Questa fase usa Auth e scrive esclusivamente il profilo dell'utente autenticato.
Catalogo, fotografie data URL e backup JSON continuano a usare il formato locale
`tj-pipes-v1`: nessuna sincronizzazione, importazione o cancellazione automatica.

## Configurazione pubblica e segreti

Da `.env.example` creare una `.env.local` ignorata da Git, con:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<chiave-pubblica-del-progetto>
```

Queste due variabili sono **pubbliche** e incluse da Vite nel JavaScript scaricato
dal browser. Il client accetta anche una legacy anon JWT (ruolo `anon`), ma usare
la publishable key del progetto. L'URL deve essere HTTPS, senza credenziali, query
o percorso; HTTP è ammesso soltanto su localhost per sviluppo Supabase locale.
Chiavi `sb_secret_`, JWT `service_role` o configurazioni incomplete vengono rifiutate.
Vite interrompe avvio e build prima del bundling con configurazioni invalide,
senza stampare i valori. La verifica client è un controllo aggiuntivo e non rende sicuro
pubblicare un segreto: non inserire mai chiavi amministrative, password DB o SMTP
in qualunque variabile `VITE_*`, file tracciato, screenshot o log.

Senza configurazione, l'account segnala l'indisponibilità e il catalogo locale
resta utilizzabile. Le variabili vengono lette al build: modificarle richiede un
nuovo build. Nessuna credenziale di progetto è inclusa nei test o nel repository.

Per sviluppo:

```sh
npm ci
npm run dev
```

Node 22.12+ o 24 LTS; Chromium per i test browser (`CHROMIUM_PATH` se necessario).

## Deploy Preview Netlify (da configurare prima della verifica reale)

Non è stato eseguito alcun deploy da questo lavoro. Nel sito Netlify impostare
le due variabili pubbliche sopra nel contesto **Deploy Previews**, disponibili al
build. Non cambiare le variabili di produzione per questa revisione. Preferire
un progetto Supabase di prova: usando il progetto attuale, registrazione e login
creeranno veri utenti Auth e righe profiles anche da una preview.

Mantenere comando `npm run build`, output `dist` e fallback SPA già presenti in
`netlify.toml`: `/auth/callback` e `/auth/recovery` devono servire `index.html`
anche con un accesso diretto. Il codice non altera il dominio o il branch produttivo.

In Supabase Auth → URL Configuration, aggiungere **entrambi** i redirect dell'URL
effettivo della preview, per esempio:

```text
https://deploy-preview-<numero>--<sito>.netlify.app/auth/callback
https://deploy-preview-<numero>--<sito>.netlify.app/auth/recovery
```

L'SDK può aggiungere `?sb_flow_id=...` a questi URL per distinguere richieste PKCE
concorrenti. La allowlist deve consentire anche tale query secondo il matching
Supabase; se si usano pattern, limitarli allo specifico hostname della preview
(per esempio `https://deploy-preview-<numero>--<sito>.netlify.app/**`). Non autorizzare
indiscriminatamente tutto `netlify.app`. Confermare il comportamento con un'email
reale: un redirect non ammesso può ricadere sul Site URL e arrivare al sito produttivo.
Non modificare il Site URL produttivo per far funzionare una preview.

Per sviluppo locale autorizzare analogamente `http://localhost:5173/auth/callback`
e `/auth/recovery` (e le query SDK); usare sempre lo stesso hostname, porta e browser.
`localhost` e `127.0.0.1` sono origini diverse. Le email devono utilizzare il link
Supabase di conferma (`ConfirmationURL`) e rispettare il redirect richiesto; eventuali
template personalizzati non devono forzare il Site URL al posto di `RedirectTo`.
Non incollare access/refresh token in URL manuali e non usare link implicit flow.

## Flussi e sicurezza

- Registrazione: email, password di almeno 12 caratteri e conferma password.
  Con conferma obbligatoria il client mostra l'invito a leggere l'email e non crea
  il profilo prima dell'autenticazione. Dal form login è possibile reinviare la conferma.
- Login email/password, messaggi IT/EN per credenziali errate, email non confermata,
  limiti del servizio e guasti di rete. I dettagli grezzi del server non sono mostrati
  o registrati. Le risposte di invio email restano generiche per limitare l'enumerazione.
- Callback PKCE: destinazioni fisse sulla stessa origine, senza `next`/redirect arbitrari.
  Il codice monouso viene scambiato con l'API Auth usando il verifier conservato
  dall'SDK; l'eventuale flow ID viene preservato prima di pulire l'URL. Il bootstrap
  avviene una sola volta per pagina anche in React StrictMode. URL e frammenti di
  errore vengono ripuliti; i token di callback implicit non sono accettati.
- Aprire le email nello **stesso browser/profilo e stessa origine** da cui si è iniziato
  il flusso. Un link aperto su un altro dispositivo, browser in-app o dominio non può
  usare il verifier PKCE: richiedere un nuovo link da quel browser. Link scaduti/usati
  producono un messaggio con istruzioni, senza interrompere il catalogo.
- Recupero: invio email, riconoscimento dell'evento SDK `PASSWORD_RECOVERY`, form
  nuova password e `updateUser`. Il solo percorso `/auth/recovery` non abilita il form.
  Un marcatore non segreto con l'ID utente in sessionStorage mantiene la schermata
  dopo reload nella stessa scheda. Non autorizza operazioni server; il server valida
  sempre sessione e richiesta. Il marcatore viene rimosso dopo salvataggio/logout.
- SDK con persistenza sessione e auto-refresh attivi: rinnovo access token, ripristino
  al reload e notifiche Auth per logout, aggiornamenti token e altre schede.
  Token refresh revocato/scaduto fa tornare al login; un errore temporaneo di ripristino
  offre un retry. La firma e autorizzazione delle operazioni restano al server/RLS.
- Logout con scope `local`: termina la sessione corrente e si propaga alle schede
  della stessa origine; non forza l'uscita da tutti gli altri dispositivi. Access token
  già emessi possono restare validi fino alla scadenza prevista da Supabase.
- Le password esistono solo negli input/stato React e nelle richieste HTTPS Auth;
  vengono svuotate dopo ogni richiesta e cambio modalità, mai scritte nel localStorage
  applicativo o nei log. L'SDK conserva access/refresh token e verifier PKCE nelle
  proprie chiavi `sb-*` del browser: sono dati sensibili di sessione, non password.
  Non esportarli, aggiungere script non fidati o trattare un dispositivo condiviso
  come privato. Se lo storage non è disponibile, l'SDK può usare una sessione in
  memoria: il reload/ritorno da email potrebbe richiedere un nuovo accesso.

## Creazione profilo e dati locali

Dopo autenticazione o ripristino si esegue `upsert` su profiles con
`onConflict: 'id', ignoreDuplicates: true`: equivale a INSERT ON CONFLICT DO NOTHING.
Solo `id` e lingua iniziale (`it`/`en`) vengono inviati. Nome e preferenze di un profilo
esistente non vengono aggiornati, nemmeno cambiando lingua UI, ricaricando o entrando
contemporaneamente da altre schede. Nessuna funzione amministrativa o trigger Auth.

Un errore profiles è distinto dall'esito del login: l'utente resta autenticato e può
riprovare la creazione; l'app non dichiara falsamente che il profilo è pronto.
La policy RLS della fase 1 verifica l'identità in base al JWT, non a dati del form.

**Il catalogo locale non appartiene ancora a un account cloud.** Rimane lo stesso
per chi usa quel browser/origine, anche dopo logout o cambio utente; non viene
separato né cancellato. L'interfaccia lo dichiara nella sezione Account. Le preview
hanno un'origine diversa dalla produzione, dunque un localStorage separato: questo
non è una perdita dei dati del sito pubblico. Nessun upload fotografico viene eseguito.

## Verifiche

```sh
npm run build
npm test
npm run test:e2e
```

Playwright avvia un server dedicato con un URL/chiave **sintetici** e intercetta le
richieste Auth/profiles nei test account. Non legge `.env.local` per collegarsi al
progetto reale: i due valori di test hanno precedenza. Nessun account reale è creato.
Chiudere un eventuale Vite sulla porta 5173 prima del test; Chromium è configurabile.

Test unitari: configurazione sicura, traduzioni, messaggi sicuri, callback e creazione
profilo idempotente, oltre ai test preesistenti di storage/backup.
Test browser: registrazione e conferma, recupero/reset con reload, errori bilingui,
login/logout, rinnovo e revoca token, logout tra schede, retry profiles, conservazione
dati locali, layout mobile e regressioni su foto/CRUD/import/export.

I test simulano le risposte del servizio, non validano SMTP, le impostazioni Auth,
le effettive allowlist Netlify/Supabase o le policy di un database remoto. Prima
dell'approvazione sul Deploy Preview eseguire con un account di prova: registrazione,
conferma e reinvio email, login/logout, recupero/password aggiornata, reload, scadenza,
profilo già presente con preferenze personalizzate e due account con RLS. Controllare
che non si producano richieste alle tabelle catalogo o a Storage, e confrontare un
backup JSON prima/dopo l'accesso. Non sono state applicate migrazioni remote.

Esito locale: build TypeScript/Vite riuscita, 12 test unitari e 15 test browser
Chromium superati. Verificati visivamente screenshot desktop/mobile e build di
produzione senza variabili Auth: catalogo e modulo locale disponibili, nessun
errore JavaScript. Verificato anche il rifiuto del build con una chiave secret
sintetica, prima di generare bundle. Nessun test sul progetto Supabase reale.
