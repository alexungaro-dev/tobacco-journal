# Milestone 02, Fase B · Fotografie delle pipe

Il catalogo usa il bucket privato `journal-photos` e `public.media` della
[migrazione esistente](../supabase/migrations/20261116160000_supabase_foundation.sql).
I file sono JPEG, PNG o WebP fino a 3 MiB (3.145.728 byte). Il browser controlla
MIME, firma del formato e decodifica prima di caricare. L'app recupera i file
tramite Supabase Storage autenticato e mostra URL blob temporanei, revocati
quando l'immagine cambia o l'account viene chiuso. I riferimenti includono
proprietario e SHA-256, verificati a ogni lettura insieme ai metadati.

## Aggiungere, sostituire o rimuovere una foto

Aprire l'editor, selezionare l'immagine, controllare l'anteprima e salvare. La
rimozione diventa effettiva al salvataggio. Ogni scheda visualizza al massimo una
fotografia. Una modifica della scheda senza scelta fotografica mantiene la foto
corrente. La rimozione dall'editor lascia intatta l'eventuale copia originale in
`legacy_payload.photo` e la esclude dalla vista e dalle migrazioni successive.
La cancellazione confermata dell'intera scheda segue il CRUD del catalogo e
comporta la cancellazione dei dati della scheda stessa.

La revisione della pipa (`updated_at`) protegge dalle scritture concorrenti. Una
nuova foto viene prima verificata in Storage e in `media`, poi diventa quella
corrente mediante una scrittura condizionata sulla revisione. Un riferimento
interno in `legacy_payload._tobaccoJournalStoragePhoto` identifica l'unica foto
attiva oppure contiene `null` per una rimozione esplicita. Le schede precedenti
possono avere il campo assente. Una nuova scheda viene creata prima del
caricamento, come richiesto dalla chiave esterna. Se il caricamento fallisce,
l'editor segnala la creazione parziale e consente di riprovare. Dopo un conflitto
o un esito incerto, ricaricare il catalogo prima di ripetere la modifica. Un
caricamento già in volo al logout può terminare sul server, mentre
l'interfaccia scarta l'esito e interrompe i passaggi successivi.

## Migrazione e backup

1. Esportare un backup JSON e conservarne una copia.
2. Entrare nell'account corretto e controllare il conteggio sotto **Fotografie legacy**.
3. Selezionare **Trasferisci fotografie legacy** e confermare. Le immagini non valide
   o sopra il limite rimangono nei dati originali e sono riportate con l'ID della pipa.
4. Leggere il resoconto. Un nuovo tentativo riprende la stessa destinazione per
   gli stessi byte e la stessa scheda, anche dopo una modifica dei suoi campi. Un file esistente viene riutilizzato
   soltanto se i suoi byte coincidono, con i metadati verificati. Una foto già
   attiva ha precedenza. Dopo un conflitto si usa la revisione corrente.
5. Ricaricare la pagina e controllare le schede. In caso di errore Storage,
   l'app segnala l'errore e mostra la copia legacy se disponibile e supportata.

Il backup rimane in formato versione 1. `photo` contiene la foto corrente come
data URL, oppure `null` dopo la rimozione. Quando la foto corrente è diversa
dall'originale, il backup include anche l'originale in
`tobaccoJournalOriginalPhoto`. Se il nome esiste già nei dati, l'app aggiunge
uno o più caratteri `_` per conservare entrambi i valori. Il campo interno di
Storage è riservato e resta fuori dal backup. Reimportando in un account con
destinazione libera, la foto corrente torna come immagine inline e può essere
trasferita con la stessa procedura. Le copie originali aggiuntive restano
recuperabili nel JSON. Se il recupero di una fotografia privata fallisce,
l'interfaccia offre separatamente il backup delle copie originali e indica
che quella copia esclude le foto presenti solo in Storage.

## Verifica con un progetto di prova

Eseguire dalla radice del checkout i comandi seguenti. Playwright intercetta
Supabase con file e sessioni sintetici. Il test SQL usa un container locale.

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run test:e2e -- --workers=2
bash supabase/tests/run-local.sh
```

Per una prova reale utilizzare un **progetto di test** con la migrazione già
applicata, un bucket privato con i limiti sopra indicati e le policy originali
su `media` e su Storage. Configurare URL, chiave pubblicabile e redirect di
Auth come descritto nelle [istruzioni Auth](supabase-auth.md).
La Fase B riutilizza lo schema esistente. Su un progetto già configurato non
serve applicare nuovamente la migrazione.

Con due account di test, caricare due immagini sintetiche, ricaricare la
pagina, sostituirne una e rimuovere l'altra. Verificare che le richieste senza
sessione e quelle del secondo account non possano scaricare la foto del primo.
Ripetere con un backup legacy, controllare ID, conteggio e byte originali,
poi interrompere la rete durante un caricamento e riprovare. Controllare anche
logout e cambio account durante il caricamento, oltre all'export in entrambi i
casi, con e senza Storage raggiungibile. Verificare i limiti reali del bucket e
almeno un browser mobile sul progetto di prova.

## Oggetti da riconciliare

Storage e PostgreSQL confermano le scritture separatamente. Un caricamento
interrotto può lasciare un oggetto senza riga `media` oppure un oggetto e una
riga preparati prima dell'aggiornamento della scheda. L'app rimuove una foto
precedente solo dopo il commit della nuova selezione o della rimozione.
Se la pulizia fallisce, la selezione confermata rimane valida e l'app segnala
l'esito incerto. Una scheda cancellata può lasciare un oggetto dopo il cascade
di `media`. Il percorso degli oggetti di questa funzionalità è
`<user_id>/pipe-photos/<hash>`.

Per la pulizia manuale, sospendere le scritture per gli account interessati,
fare un backup e confrontare, in sola lettura, i puntatori attivi delle pipe,
le righe `media` e gli oggetti con quel prefisso. Escludere i percorsi correnti,
gli altri tipi di media, i caricamenti recenti e i candidati con esito incerto.
Prima di rimuovere un candidato accertarsi che non serva a un tentativo da
riprendere e rileggere i riferimenti. Per una riga preparata ma mai attivata,
eliminare prima la sola riga `media` corrispondente e verificare che nessuna
riga usi il file. Eliminare quindi il singolo oggetto con l'API Storage o
la console Supabase. Una riga attiva con file mancante richiede una
riconciliazione esplicita: conservare la copia legacy e sostituire o rimuovere
la selezione tramite l'editor. Evitare la cancellazione in massa per prefisso
e le modifiche dirette a `storage.objects`.
