# Milestone 02 — Fondazione Supabase

Solo schema: React, `tj-pipes-v1`, backup JSON e salvataggio locale restano invariati.
Nessun client Supabase, credenziale, collegamento remoto o import automatico è incluso.
Migrazione: `migrations/20261116160000_supabase_foundation.sql`, transazionale,
per un progetto Supabase nuovo (schemi `auth` e `storage` già gestiti dalla piattaforma).
Non è uno script da rieseguire: tabelle, policy o bucket omonimi causano un errore
con rollback. Prima di un futuro uso remoto occorre revisione esplicita.

## Modello

| Tabella | Scopo e relazioni |
| --- | --- |
| profiles | Profilo privato, PK UUID uguale ad `auth.users.id`, lingua preferita |
| pipes | Catalogo pipe, ID testuale, attributi esistenti e payload originale |
| tobaccos | Catalogo tabacchi, marca, nome, tipo miscela, note e campi JSON aggiuntivi |
| cigars | Catalogo sigari, marca, nome, vitola, note e campi JSON aggiuntivi |
| smoking_sessions | Sessione pipe (pipa obbligatoria, tabacco facoltativo) oppure sigaro; tempi e voto 1–5 |
| media | Metadati fotografia, collegata esattamente a un elemento dei quattro cataloghi/diario |

Le cinque tabelle di contenuto appartengono a `profiles` con `ON DELETE CASCADE`.
Le FK composte `(user_id, id)` impediscono riferimenti tra proprietari differenti,
anche per scritture privilegiate che bypassano RLS. Le sessioni impediscono la
cancellazione di elementi referenziati: eliminare prima le sessioni interessate.
I metadati media vengono invece eliminati con il relativo elemento.
Indici su PK e FK supportano filtri per proprietario e controlli referenziali.
`updated_at` è gestito da trigger invoker con `search_path` vuoto.

Il profilo non viene creato da un trigger su `auth.users`: in una futura integrazione,
dopo l'autenticazione, creare esplicitamente il proprio profilo prima dei contenuti.
Nessuna funzione con privilegi elevati o automatismo sull'autenticazione è introdotto.
La cancellazione del profilo è consentita al proprietario e cancella i dati relazionali;
non cancella l'account Auth né i file fisici di Storage.

## Sicurezza e fotografie

RLS abilitata e forzata sulle sei tabelle: solo `authenticated` dispone di CRUD,
con `auth.uid()` verificato sia in lettura sia per il nuovo proprietario nelle scritture.
`anon` e `PUBLIC` non ricevono privilegi sulle tabelle. Nessuna lettura pubblica
neppure per i profili. Non aggiungere policy permissive che allarghino questi confini.
Il modello protegge gli utenti dell'API: superuser e ruoli `BYPASSRLS` (incluso
`service_role` nella piattaforma) sono amministrativi e non vanno esposti nel browser.

Bucket `journal-photos`: privato, JPEG/PNG/WebP, massimo 3 MiB per file.
Percorso richiesto: `<auth.uid()>/<nome-file-univoco>`, preferibilmente UUID più
estensione. Policy separate SELECT/INSERT/UPDATE/DELETE controllano bucket e
prima cartella; UPDATE controlla sia vecchio sia nuovo percorso. Il catalogo media
controlla proprietario del percorso, tipo MIME, dimensione e riferimento all'elemento.
I limiti di bucket sono applicati dal servizio Supabase Storage, non dai soli test SQL.
Non usare URL pubblici: future letture con JWT oppure URL firmati a breve scadenza;
chi possiede un URL firmato può usarlo fino alla scadenza, quindi non condividerlo.

Metadati e oggetto Storage sono operazioni separate: nessuna FK o trigger su
`storage.objects` (schema gestito dalla piattaforma). Un file può esistere prima
del suo record media; il percorso ne limita comunque l'accesso al proprietario.
Upload/rinomina/cancellazione richiederanno coordinamento, retry e pulizia degli
orfani nella futura integrazione. Eliminare righe SQL non elimina i file:
usare sempre l'API Storage per i file, anche nella cancellazione dell'account.
Valori MIME/dimensione dichiarati in media non certificano il contenuto del file.
Su un progetto esistente verificare tutte le policy Storage: quelle permissive
si combinano con OR e potrebbero rendere inefficace l'isolamento di queste policy.

## Compatibilità e multilingua

Nessuna conversione dei dati attuali viene eseguita. Il futuro import deve essere
esplicito, validato, reversibile e preceduto da esportazione del backup originale.

- `id` resta testo non vuoto, non UUID obbligatorio. PK `(user_id,id)` conserva gli
  ID legacy e consente a utenti diversi di importare lo stesso backup senza collisioni.
- `brand`, `model`, `shape`, `material`, `filter`, `status`, `notes` si mappano
  direttamente. Stringhe vuote restano consentite come nel validatore legacy.
  `status` e `filter` restano testo aperto: codici futuri/sconosciuti non vengono persi.
- `date` → `acquired_on`; `createdAt`/`updatedAt` → timestamp solo se validi.
  `legacy_payload` deve ricevere l'intero record originale, inclusi campi ignoti,
  valori mancanti, date non standard e timestamp originali. Non usare i timestamp
  SQL, modificabili dai trigger, come unica copia dei valori del backup.
- Il validatore locale ammette prezzi finiti negativi e date arbitrarie; il nuovo
  prezzo è non negativo e finito, la data SQL è tipizzata. Il futuro import deve
  segnalare questi casi, conservare l'originale nel payload e richiedere una scelta
  prima di normalizzare; non scartare o correggere silenziosamente i valori.
- `photo` data URL resta nel payload/backup originale durante la transizione.
  In futuro decodificare e verificare tipo e dimensione prima dell'upload privato,
  poi creare media. Backup storici possono superare i limiti: segnalare e preservare
  l'originale, senza dichiarare riuscito un import incompleto. Il payload può dunque
  contenere dati voluminosi; definire la politica di conservazione prima dell'import.
- Prezzi senza valuta nel vecchio formato restano senza valuta nello schema:
  non inferirla dalla lingua. Nessun testo personale viene tradotto.

`preferred_locale` accetta codici lingua estensibili (2–35 caratteri), default `it`.
Etichette UI e traduzioni restano nei dizionari React; codici di stato/filtro e
`kind` delle sessioni sono indipendenti dalla lingua. Note, nomi e descrizioni
sono testo Unicode. Le nuove tabelle tabacchi/sigari sono una base, non un modello
completo di inventario o una migrazione di dati inesistenti.

## Verifica locale riproducibile

Prerequisito: Docker operativo e accesso al registry per la prima immagine PostgreSQL.
Dalla radice del checkout esistente (nessun worktree necessario):

```sh
bash supabase/tests/run-local.sh
```

Il runner usa PostgreSQL 17 fissato a digest, container senza rete né porte esposte,
autenticazione trust solo interna al container temporaneo e rimozione automatica.
Non accetta URL remoti e interrompe il test al primo errore. `local-bootstrap.sql`
è esclusivamente un sostituto minimo locale dei contratti Auth/Storage: **non è una
migrazione Supabase e non va applicato a un progetto reale**. La suite usa transazioni
con rollback e utenti sintetici, senza credenziali.

Verificati: esecuzione integrale della migrazione, RLS sulle sei tabelle, CRUD
proprietario, isolamento tra due utenti, scritture con proprietario falsificato,
UPDATE/DELETE altrui, FK tra utenti, ID legacy/codici aperti/JSON, vincoli di prezzo,
tempi e media, trigger timestamp, cascade metadati, accesso anonimo negato e
policy SQL per i percorsi Storage, incluso tentativo di spostamento tra utenti.

Limite: non è uno stack Supabase completo. Non verifica emissione JWT, PostgREST,
API Storage, upload effettivo, MIME/dimensioni applicati dal servizio o URL firmati.
Prima di un futuro rilascio servirà uno stack Supabase isolato con due account reali
per queste verifiche, inclusa l'assenza di altre policy permissive. Non è stata
eseguita alcuna migrazione remota, né merge o deploy.
