# Milestone 03 · Catalogo tabacchi da pipa

Aprire **Tabacchi** dopo l'accesso. Il catalogo personale parte vuoto. Marca
e nome sono obbligatori. Gli altri campi, incluso lo stato, sono facoltativi.
I componenti comuni sono selezionabili e i componenti personalizzati si possono
scrivere separati da virgole. Le quantità sono in grammi e si modificano
dall'editor. Il diario non calcola consumi né viene modificato da questa funzione.

La ricerca comprende marca, nome, produttore, miscela, componenti e note.
Le schede si filtrano per miscela o stato e si ordinano per nome, ultima
modifica o quantità residua. Formati, intensità e tipi di miscela sono testo
libero. I valori numerici sono non negativi e il gradimento è un intero da 1 a 5.

## Modello, fotografie e coerenza

`public.tobaccos` conserva `brand`, `name`, `blend_type` e `notes` nelle
colonne esistenti. `extra` contiene produttore, componenti, confezione,
quantità, data, prezzo, stato, intensità, gradimento e il puntatore della foto
(`cataloguePhoto`). L'editor mantiene le altre chiavi già presenti in `extra`.
Le modifiche e le eliminazioni confrontano `updated_at`. In caso di conflitto
ricaricare il catalogo e controllare la versione attuale prima di ripetere
la modifica. Le righe referenziate da sessioni esistenti non si possono eliminare.

Il bucket privato `journal-photos` usa i percorsi
`<user_id>/tobacco-photos/<hash>` e `public.media.tobacco_id`. Si applicano
gli stessi limiti delle pipe, JPEG, PNG o WebP fino a 3 MiB. La foto nuova
diventa attiva dopo la verifica di file e metadati e il salvataggio della
scheda. In caso di errore durante la creazione con foto, la scheda può essere
già salvata. L'editor lo segnala e permette di riprovare. Il logout o il cambio
account rimuove le anteprime e interrompe i passaggi successivi di una
richiesta in corso. Un upload già inviato può terminare lato server.
In caso di pulizia incompleta, seguire la procedura di riconciliazione
[documentata per le pipe](cloud-pipe-photos.md#oggetti-da-riconciliare)
applicandola ai puntatori dei tabacchi e al loro prefisso. Il cascade SQL
riguarda i metadati, mentre l'app cancella il file tramite Storage dopo la
conferma della modifica o della cancellazione.

## Backup e importazione

**Esporta dati JSON** salva il catalogo intero, a prescindere dai filtri.
Il formato è `tobacco-journal-tobaccos` versione 1 e include i campi del
catalogo e le foto come data URL. I riferimenti privati non vengono esportati.
Il formato pipe è separato. L'export segnala un errore se una foto privata
attiva non può essere recuperata.

1. Selezionare il JSON dei tabacchi. Il limite per file è 20 MiB e 10.000
   schede. Se necessario suddividere una copia del backup in più file,
   mantenendo l'intestazione v1 e gli ID.
2. Verificare l'elenco delle esclusioni, scaricare il backup preventivo e
   confermare l'importazione nell'account indicato.
3. Leggere l'esito per ID. Sono esclusi tutti i record che condividono lo
   stesso ID nel file. Gli ID già presenti nell'account vengono conservati.
   Marca e nome uguali sono ammessi con ID distinti, per gestire più lotti.
4. Se il salvataggio della foto si interrompe dopo la creazione della scheda,
   l'originale importato resta temporaneamente in `extra.pendingCataloguePhoto`
   e nel backup. Ripetere con lo stesso file per completare l'upload.
   La ripresa richiede la corrispondenza della scheda e dei dati della foto.
   Dopo la verifica in Storage l'originale temporaneo viene rimosso dalla
   scheda. Conservare il file sorgente. I record completati non sono riscritti.

## Verifica e configurazione Supabase

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e -- --workers=2
bash supabase/tests/run-local.sh
```

Playwright usa sessioni, API e immagini sintetiche. Il runner SQL applica la
migrazione esistente a PostgreSQL locale e verifica anche isolamento,
chiavi esterne e cascade dei metadati. Per verificare Storage reale usare
un progetto di prova con la fondazione già applicata, il bucket privato
e le policy esistenti. Configurare Auth come nella
[guida Supabase](supabase-auth.md). Provare con due account distinti,
una foto sintetica ciascuno, refresh, sostituzione, logout durante l'upload e
recupero del backup. Verificare che l'altro account e una richiesta anonima
non possano leggere la foto. Se la fondazione è già applicata, la Milestone 03
non richiede migrazioni né nuove policy.
