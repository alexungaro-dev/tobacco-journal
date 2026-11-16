# Milestone 02 — Fase A: catalogo pipe cloud

Branch `feature/cloud-pipes`, basato su `origin/main` (Auth già integrata).
Nessuna modifica a migrazioni, tabelle o policy SQL. Nessun upload Storage, nuovo
catalogo tabacchi/sigari/diario, merge o deploy. Nessuna credenziale aggiunta.

## Comportamento e isolamento

Un solo AuthProvider condivide la sessione SDK fra Account e catalogo. Il catalogo
si monta solo dopo il ripristino dell'accesso e la preparazione del profilo personale;
non viene mostrato durante il recupero password. Senza autenticazione mostra solo
l'invito ad accedere, senza leggere o visualizzare il contenuto di `tj-pipes-v1`.
Il precedente editor locale non è più il percorso operativo dell'applicazione.

Ogni istanza del catalogo appartiene a un solo user ID e conserva i dati solo in
memoria. Logout, sessione non valida o cambio utente smontano l'intera istanza:
righe, form, ricerca, anteprime e resoconti d'importazione vengono scartati, mentre
le richieste HTTP vengono abortite. Il logout nasconde i dati **prima** di attendere
il servizio Auth; eventuali errori richiedono un'esplicita riapertura della sessione.
Le altre schede reagiscono agli eventi Auth SDK. Una risposta tardiva non può
ripopolare una nuova istanza o comparire nell'account successivo.

Ogni operazione controlla la sessione corrente con l'SDK, specifica il proprietario
nelle scritture e filtra le letture/modifiche/eliminazioni con `user_id`. Una risposta
con proprietario diverso viene rifiutata anche nel client. RLS resta il confine di
sicurezza sul server; nessuna service role o operazione amministrativa è utilizzata.
Non viene creato alcun cache del catalogo in localStorage/sessionStorage.

## CRUD e concorrenza

Il repository usa esclusivamente `public.pipes`; Auth continua a preparare profiles.
La lettura usa pagine ordinate per ID con cursore (`id > ultimo_id`), continuando
fino a una pagina vuota: non tronca la collezione al limite PostgREST, neppure se
il server imposta un max-rows inferiore alla dimensione richiesta dal client.
La paginazione non è una fotografia transazionale di scritture simultanee: ricaricare
per vedere cambiamenti effettuati da altre schede/dispositivi. Nessun Realtime.

Inserimento e modifica chiedono al server il record salvato e ne verificano ID,
proprietario, colonne e payload prima di aggiornare l'interfaccia. L'ID di una nuova
scheda resta stabile durante i tentativi dello stesso form. Le modifiche e le
eliminazioni includono `updated_at` nella condizione per evitare di sovrascrivere
una versione più recente. Zero righe interessate è un conflitto, non un successo.
Le cancellazioni con FK ancora attive sono segnalate senza cancellazioni a cascata
introdotte dal client. Il form mantiene i valori in caso di errore.

Un timer sulla scadenza del token (ricontrollata anche al focus) nasconde i dati
anche se il rinnovo SDK resta bloccato dalla rete; un rinnovo valido aggiorna il timer.
Gli errori Auth/JWT nascondono il catalogo e invitano al ripristino dell'accesso;
il pulsante Esci permette di terminare anche una sessione rifiutata dall'API.
Guasti di rete ed esiti incerti non producono messaggi di salvataggio riuscito.
I retry PostgREST sono disabilitati per queste operazioni: il retry è esplicito.
Dopo una risposta persa, ricaricare prima di riprovare: una scrittura già partita
può essere stata commessa, anche se il browser ha annullato l'attesa. L'abort non
è un rollback del server. Nessuna scrittura offline o locale sostitutiva.

## Importazione esplicita dal browser o da JSON

1. Accedere all'account corretto e verificare l'indirizzo di destinazione.
2. Selezionare **Prepara importazione dal browser** oppure un backup JSON versione 1
   tramite **Importa dati JSON**. Il file non sostituisce la collezione cloud.
3. Esaminare schede importabili, esclusioni con ID e motivo, e conteggio fotografie.
   Scaricare **Backup prima del trasferimento**, che include anche i record esclusi
   e le immagini originali. Il backup è offerto prima della conferma, non obbligatorio.
4. Confermare il trasferimento nell'account indicato. Nessun dato locale viene scritto,
   cancellato o attribuito automaticamente a un account. Su un browser condiviso
   verificare che la sorgente appartenga effettivamente al titolare dell'account.
5. Leggere il resoconto: schede **verificate**, escluse, conflitti/errori e non tentate.
   Conservarlo e risolvere i problemi su una copia del backup prima di riprovare.

Sono ammessi gli ID testuali originali e i codici di stato/filtro sconosciuti. La PK
esistente `(user_id,id)` e `ON CONFLICT DO NOTHING` impediscono duplicati per account
senza sovrascrivere schede esistenti. Ogni scheda viene riletta e confrontata con
colonne e intero `legacy_payload`, indipendentemente dall'ordine delle chiavi JSON.
Un record identico già presente conta come verificato; lo stesso ID con dati diversi
è un conflitto da revisionare. Non si rinomina automaticamente un ID in conflitto. La sorgente non conserva
un registro delle cancellazioni cloud: una scheda eliminata nel cloud può essere
ricreata se si conferma nuovamente l'importazione di una sorgente che la contiene.

L'import procede una scheda alla volta, con avanzamento. Non è una transazione
unica: in caso di interruzione alcune schede possono essere già salvate. Alla prima
perdita di rete o sessione si fermano le operazioni successive; le rimanenti vengono
conteggiate come non tentate. Ripetere dalla stessa sorgente è sicuro anche dopo
una risposta persa. Navigazione, logout o chiusura della pagina possono interrompere
l'importazione: ripartire dalla sorgente e verificare il nuovo resoconto.

Un readback fallito non viene dichiarato riuscito solo perché la lista successiva
mostra la scheda. Non esiste un'etichetta generica «migrazione completa» che ignori
esclusioni o foto ancora in attesa. Verificato significa coincidente al momento
della lettura; modifiche successive da altri dispositivi richiedono una nuova verifica.

## Compatibilità, limiti e fotografie (Fase B)

`legacy_payload` conserva l'intero record originale, inclusi campi aggiuntivi,
`photo` data URL e stringhe timestamp legacy. `created_at` e `updated_at` PostgreSQL
descrivono la vita cloud; non si interpretano timestamp legacy arbitrari come date
SQL. La data acquisto valida si mappa a `acquired_on`; data vuota a NULL. Prezzo,
marca, modello, note, forma, materiale, filtro e stato vanno nelle colonne dedicate.
L'export ricostruisce un backup versione 1, mantenendo foto e campi extra; i dati
SQL correnti prevalgono per i campi del catalogo. Gli export sono dati personali.

Sono esclusi e segnalati: formati invalidi, prezzi negativi, date acquisto impossibili,
valori non rappresentabili in JSON/PostgreSQL (per esempio NUL), e **tutte** le
occorrenze di ID duplicati nella sorgente. Non vengono corretti silenziosamente.
Sorgenti malformate consentono il download grezzo degli originali quando leggibili.
Storage locale negato non viene azzerato. Limiti: 10.000 schede per sorgente e
20 MiB per file JSON. Un export cloud completo può superare questo limite: per
reimportarlo occorre suddividere una copia in backup versione 1 più piccoli,
conservando l'originale. I limiti HTTP del progetto possono rifiutare singoli payload
fotografici voluminosi. In tal caso il record non è verificato, la sorgente rimane
intatta e il problema viene riportato. Non comprimere/scartare foto automaticamente.

**Nessun file viene caricato nel bucket.** Le foto legacy delle schede accettate
restano nel JSONB e possono essere visualizzate come data URL; quelle delle schede
escluse restano nella sorgente/backup. Il trasferimento nello Storage non è completo.
L'editor non permette ancora aggiunta, rimozione o sostituzione di fotografie: mostra
l'immagine legacy in sola lettura. Le normali modifiche agli altri campi mantengono
foto e campi extra nel payload; nessuna richiesta a storage.objects/media/bucket.

La futura Fase B potrà leggere `legacy_payload.photo` con proprietario e ID originari,
verificare i byte, caricare nel bucket privato e associare i metadati. Dovrà verificare
il file e un backup prima di rimuovere eventuali copie inline; questa fase non esegue
alcuno di questi passaggi. I dati locali non vengono mai rimossi automaticamente.

## Test e Deploy Preview

```sh
npm ci
npm run build
npm test
npm run test:e2e
bash supabase/tests/run-local.sh
```

Playwright usa credenziali pubbliche sintetiche e risposte Auth/PostgREST simulate,
con proprietari separati. La suite PostgreSQL usa un container locale effimero e
contratti Auth/Storage minimi; non rappresenta uno stack Supabase completo. Il runner
attende ora il server finale su TCP, evitando il server temporaneo di inizializzazione
Docker. Nessuna migrazione o richiesta di test è eseguita sul progetto remoto.

Per il Deploy Preview rimangono necessarie solo le variabili pubbliche esistenti:
`VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, nel contesto Netlify Deploy
Previews, disponibili al build. Usare un progetto di prova se possibile. Mantenere
build `npm run build`, output `dist`, Node 22 e fallback SPA esistenti. Autorizzare
`/auth/callback` e `/auth/recovery` (incluse le query PKCE) sull'hostname esatto della
preview in Supabase, senza cambiare Site URL o impostazioni Netlify produttive.
Dettagli Auth in [supabase-auth.md](supabase-auth.md).

Prima di approvare con due account reali e pochi dati di prova:

- CRUD effettivo in pipes, proprietario corretto e assenza di richieste Storage.
- Nessuna scheda dopo logout, cambio account o revoca sessione, anche con form o
  import in corso; isolamento anche interrogando direttamente PostgREST con i JWT
  dei due account. Le policy remote non sono provate da una simulazione del client.
- Backup locale scaricato, import parziale/valido/ripetuto, ID in conflitto e readback;
  confrontare `legacy_payload.photo` e campi aggiuntivi con gli originali.
- Ricaricamento, ricerca/filtri IT/EN, errori di rete e conflitti tra due schede aperte.
- Verificare che `tj-pipes-v1` sia identico prima/dopo; la preview ha localStorage
  distinto dal sito produttivo. Per testare una copia dei dati di produzione usare
  un backup JSON esportato esplicitamente, senza aspettarsi che compaia da solo.

Le email reali, i limiti di payload, i permessi e le policy del progetto remoto
richiedono queste verifiche; non è stato contattato il Supabase produttivo.

Esito locale della Fase A: build TypeScript/Vite riuscita, **19 test unitari**, **21
test Chromium** e **51 controlli SQL/RLS** superati. Verificati screenshot desktop,
tablet/mobile e della procedura d'importazione. Vite segnala un avviso non bloccante
sulla dimensione del bundle principale (circa 544 kB prima della compressione);
la suddivisione ulteriore del bundle resta un miglioramento prestazionale possibile.
