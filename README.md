# Tobacco Journal

Milestone 01: React + TypeScript + Vite, CSS Dark Heritage e italiano/inglese con react-i18next. Nessun backend o servizio esterno richiesto.

## Sviluppo e verifiche

Usare Node.js 22.12+ (oppure 24 LTS) e npm, nel checkout esistente:

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run preview
```

I test browser usano Chromium in `/usr/bin/chromium`. Su altre macchine impostare `CHROMIUM_PATH` al proprio eseguibile Chromium/Chrome. Il server Vite di test viene avviato automaticamente; i test usano contesti browser temporanei. Non usare il proprio profilo personale per i test automatizzati. Non è configurato un linter: `typecheck` esegue il controllo TypeScript strict.

## Architettura

- `src/App.tsx`: coordinamento del catalogo e navigazione hash, senza necessità di un router aggiuntivo.
- `src/components/PipeForm.tsx`, `PipeCard.tsx`: modulo di inserimento/modifica e schede responsive.
- `src/data/storage.ts`: lettura, validazione, scrittura e backup, separati dall'interfaccia.
- `src/data/usePipes.ts`: stato React e commit solo dopo un salvataggio riuscito.
- `src/types.ts`: formato delle schede; conserva anche campi aggiuntivi dei backup.
- `src/i18n.ts`, `src/locales/it.json`, `en.json`: rilevamento lingua iniziale, preferenza `tj-language`, dizionari separati e fallback inglese.
- `src/config.ts`: nome e monogramma modificabili centralmente, codici dei moduli futuri.
- `src/styles.css`: CSS del prototipo con piccoli adattamenti per navigazione, lingua e accessibilità.
- `netlify.toml`: build, directory di pubblicazione e fallback SPA.

Dashboard, Tabacchi, Sigari e Diario hanno schermate placeholder. Pipe è il catalogo operativo. I codici `in_use`, `stored`, `archived`, `none`, `6`, `9`, `other` sono indipendenti dalla lingua. I contenuti personali rimangono invariati. Date e importi sono visualizzati con `Intl` nella lingua selezionata; i valori memorizzati restano indipendenti dal formato locale.

Per aggiungere una lingua, aggiungere un dizionario e registrarlo in `src/i18n.ts`, quindi aggiungere l'opzione al selettore. Non cambiare i codici dei dati.

## Analisi del prototipo e compatibilità

Il repository iniziale conteneva solo `index.html`, senza manifest, test, CI o configurazione Netlify. Le funzioni effettive erano catalogo pipe, creazione/modifica/eliminazione con conferma, ricerca testuale, filtro stato, foto JPEG/PNG/WebP fino a 3 MB e import/export JSON. Le voci di navigazione erano semplici etichette.

Il formato esistente viene mantenuto senza migrazioni distruttive:

- localStorage: `tj-pipes-v1`, array di schede con ID stringa.
- Campi: `brand`, `model`, `shape`, `material`, `filter`, `status`, `date`, `price`, `notes`, `photo`, `createdAt`, `updatedAt`.
- Fotografie: data URL incorporati nelle schede.
- Backup: `{ format: "tobacco-journal-pipes", version: 1, exportedAt, pipes }`.

Il caricamento non scrive nel localStorage. Campi opzionali mancanti sono accettati; campi aggiuntivi e codici sconosciuti sono conservati. Archivi malformati, fotografie in formati inattesi o ID duplicati bloccano le scritture invece di azzerare la collezione. È disponibile il download dei dati originali per il recupero; un backup valido può sostituire l'archivio solo dopo conferma. Import ripetuti sostituiscono la collezione, senza concatenarla e duplicarla. Errori di quota mantengono scheda e dati in memoria senza indicare falsamente un salvataggio riuscito.

Rischi: il localStorage è legato a origine e browser, ha una quota limitata e non è un backup cloud. Nessun codice può accedere ai dati di un altro dominio/browser. La compatibilità automatizzata usa dati del vecchio formato, non le schede personali del sito pubblico. Prima dell'aggiornamento esportare una copia JSON dal prototipo. Non sono state consultate o modificate le impostazioni dell'account Netlify.

## Revisione prima del merge e Netlify

Il lavoro è nel branch `feature/react-i18n`; nessun merge o deploy in produzione viene eseguito automaticamente.

1. Rivedere il diff e avviare i comandi di verifica sopra.
2. Dal sito attuale esportare il backup JSON. Aprire la nuova build in un browser di prova, importare il backup e controllare campi, fotografie e note.
3. Verificare IT/EN, ricaricamento, ricerca, stati, modifiche e comportamento su desktop/tablet/mobile. Controllare le schermate placeholder e la navigazione indietro/avanti.
4. Se desiderato, pubblicare il branch su GitHub e aprire una PR verso `main`. Usare un Deploy Preview Netlify prima del merge: il dominio di preview ha localStorage separato, quindi richiede l'importazione di una copia del backup.
5. Netlify deve usare `npm run build` e pubblicare `dist` dalla radice del repository; `netlify.toml` dichiara questi valori e Node 22, con fallback a `index.html`. Verificare eventuali override nell'interfaccia Netlify e lasciare invariati dominio, visibilità e branch di produzione.
6. Solo dopo revisione e merge autorizzato, il deploy collegato a `main` potrà aggiornare il sito. Sullo stesso dominio e browser, l'app leggerà direttamente `tj-pipes-v1` esistente.

Non sono inclusi Supabase, autenticazione, database predefiniti o funzionalità social.

## Esito delle verifiche della milestone

Nell'ambiente cloud: build Vite con TypeScript strict riuscita, 7 test unitari superati e 6 test browser Chromium superati. Verificati dati legacy senza perdita di foto/campi aggiuntivi, backup versione 1, CRUD, ricerca e filtri, cambio lingua e preferenza persistente, navigazione, larghezze 390/768/1280 px, tastiera del dialogo, validazione fotografie, archivi malformati, storage non accessibile e quota esaurita. Una prova browser della build di produzione ha verificato rendering, creazione e persistenza dopo reload, senza errori JavaScript.

Non sono stati eseguiti test su Safari/Firefox o sul deploy Netlify pubblico. Non sono stati letti i dati personali del browser del sito pubblico. La configurazione dell'account Netlify non è verificabile dal solo checkout.

Se la cache npm predefinita non è scrivibile nell'ambiente cloud, usare `npm ci --cache /tmp/tobacco-npm-cache`.
