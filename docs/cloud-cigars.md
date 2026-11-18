# Milestone 04 · Catalogo sigari

Dopo l'accesso, aprire **Sigari**. Marca e nome sono obbligatori. Vitola e
formato accettano testo libero e propongono formati comuni, tra cui Toscano
e Half Corona. Quantità residua e valutazione a stelle sono subito
disponibili. Aprire **Dettagli avanzati** per misure, composizione, acquisto,
quantità iniziale, note e umidità target. Le quantità sono pezzi interi
non negativi e si aggiornano manualmente. Il diario resta separato.

Il valore di umidità relativa target è un promemoria personale, facoltativo
e senza valore iniziale. Il campo accetta valori da 0 a 100, compresi i
decimali. La scheda lo mostra solo se presente. L'app non monitora
l'umidità né fornisce raccomandazioni sul valore da scegliere.

Le schede sono ricercabili anche per serie, origine, formato, composizione,
intensità e note. I filtri usano formato e paese d'origine. L'ordinamento
può seguire nome, ultima modifica, quantità residua o valutazione.

## Dati e fotografie

`public.cigars` usa le colonne esistenti `brand`, `name`, `vitola` e
`notes`. Gli altri campi vanno in `extra`. Le letture e le scritture usano la
sessione del proprietario e le policy RLS esistenti. L'aggiornamento e la
cancellazione confrontano la revisione della scheda. Se la revisione cambia,
ricaricare il catalogo prima di riprovare. I riferimenti da eventuali
sessioni impediscono la cancellazione tramite la chiave esterna esistente.

Una foto JPEG, PNG o WebP fino a 3 MiB si salva nel bucket privato
`journal-photos`. Il percorso ha forma `<user_id>/cigar-photos/<hash>`.
I metadati si collegano con `media.cigar_id`. La sostituzione verifica file e
metadati prima di rendere attiva la nuova foto. Dopo il salvataggio
rimuove la precedente. La cancellazione del sigaro pulisce anche i file
gestiti già collegati via `media`, inclusi quelli preparati durante tentativi
precedenti. La pulizia si esegue solo dopo la cancellazione confermata.

Storage e PostgreSQL sono separati. Un'interruzione tra upload e registrazione
dei metadati può lasciare un oggetto senza collegamento. Un errore durante
la rimozione può lasciare un file da riconciliare. Seguire la procedura
[per gli oggetti da riconciliare](cloud-pipe-photos.md#oggetti-da-riconciliare),
usando il puntatore del sigaro e il relativo prefisso. Un upload già spedito
può terminare dopo il logout, ma la sessione precedente non prosegue con
l'associazione alla scheda.

## Backup e importazione

Il backup del catalogo intero ha formato `tobacco-journal-cigars` versione 1.
Include tutti i campi della scheda e la foto come data URL. Se una foto
privata attiva non è recuperabile, l'esportazione segnala un errore.
Il formato è distinto da quello di pipe e tabacchi.

Per importare, scegliere il file, esaminare le esclusioni e confermare
nell'account indicato. Il limite è 20 MiB per file e 10.000 schede. I record
con ID ripetuto nel file sono esclusi e quelli già presenti non vengono
sovrascritti. Se la scheda è stata creata ma la foto non è stata verificata in
Storage, il backup originale resta recuperabile. Ripetere l'importazione
dello stesso file per completare una foto in sospeso, purché scheda e foto
coincidano. I record già completati vengono trattati come duplicati.

## Verifica in Deploy Preview

Eseguire in locale `npm run typecheck`, `npm run build`, `npm test`,
`npm run test:e2e -- --workers=2` e `bash supabase/tests/run-local.sh`.
Playwright usa Supabase simulato e foto sintetiche. I controlli SQL usano
PostgreSQL locale. La funzionalità non richiede nuove migrazioni o policy.

Per la verifica reale usare un progetto Supabase di prova con la fondazione
già applicata e configurare l'origine della preview per Auth secondo la
[guida Supabase](supabase-auth.md). Con due account di prova e immagini
sintetiche, verificare creazione, ricaricamento, sostituzione, rimozione,
cancellazione, backup e reimportazione. Controllare che ciascun account veda
solo le proprie schede e che richieste anonime o di un altro account non
leggano le foto. Provare il modulo su desktop, tablet e smartphone prima
del merge.
