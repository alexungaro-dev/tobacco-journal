# Milestone 05 · Diario delle fumate

Dopo l'accesso, aprire **Diario** e scegliere pipa o sigaro. La data viene
proposta nell'ora locale del browser. Prodotto e, per la pipa, pipa utilizzata
sono i dati essenziali. Voto, foto e dettagli sono facoltativi e si possono
aggiungere in un secondo momento. Per la pipa, le due provenienze si scelgono
separatamente. Per un prodotto offerto o non catalogato si possono annotare
marca, nome, dettagli e chi l'ha offerto.

Le schede possono essere filtrate per periodo locale, tipo, prodotto e
valutazione, ordinate per data e ricercate anche per note e aromi. Dai
dettagli si può aggiungere esplicitamente un prodotto alla collezione se
ha marca e nome. Il diario controlla i duplicati per marca e nome nello
stesso catalogo, senza cambiare lo storico o aggiungere scorte.

## Migrazione da applicare manualmente

La fondazione richiedeva FK a pipe o sigari e usava `ON DELETE RESTRICT`.
Inoltre mancava una transazione che registrasse la fumata e aggiornasse
l'inventario nello stesso passaggio.

1. Su un progetto **Supabase di prova** con fondazione applicata, fare un
   backup e verificare che la versione PostgreSQL supporti
   `ON DELETE SET NULL (colonna)` (PostgreSQL 15 o successivo).
2. Rivedere e applicare come amministratore la migrazione versionata
   [20261118170000_smoking_journal.sql](../supabase/migrations/20261118170000_smoking_journal.sql),
   seguita da [20261118180000_stock_alerts.sql](../supabase/migrations/20261118180000_stock_alerts.sql),
   tramite il normale processo di migrazione del progetto o SQL Editor.
   Se la prima è già applicata, eseguire solo la seconda.
   Se si usa SQL Editor, registrare l'avvenuta applicazione nel proprio
   processo di migrazione per evitarne una seconda esecuzione.
3. Verificare che PostgREST esponga la nuova colonna e la funzione
   `record_smoking_session` e le colonne `stock_alerts_enabled` e
   `cigar_low_stock_threshold` in `profiles`. Se la configurazione lo richiede, ricaricare
   la cache dello schema nel progetto di prova.
4. Configurare URL, chiave pubblicabile e redirect di Auth del Deploy
   Preview secondo la [guida Auth](supabase-auth.md). Verificare la preview
   prima del merge.

La migrazione copia le etichette già presenti prima di rendere i
riferimenti eliminabili. I riferimenti sono sempre vincolati al proprietario
e lo snapshot rimane leggibile dopo la rimozione dal catalogo. Le sessioni
storiche prive di tabacco mostrano un riferimento storico fino a quando
l'utente completa la scheda. I dettagli e gli snapshot vengono salvati in
`smoking_sessions.extra`.

## Scorte e tentativi ripetuti

Per un sigaro della propria collezione con scorta positiva, l'editor
propone di sottrarre un pezzo e mostra quantità precedente e risultante.
Per il tabacco l'aggiornamento è facoltativo. Livello e grammi si possono
cambiare separatamente, senza modificare lo stato della confezione.
Prodotti prestati, offerti o non catalogati non modificano inventari.

La RPC opera nella stessa transazione con i permessi del chiamante. Se
viene richiesto lo scarico di un sigaro con scorta insufficiente o non
specificata, l'errore `PT422` annulla registrazione, ricevuta e scarico.
Si può disattivare lo scarico e registrare la stessa fumata. Dopo il
salvataggio, il diario distingue il successo della registrazione dalla
conferma dell'aggiornamento della scorta. Le vecchie ricevute senza un
esito registrato possono confermare la fumata, con scorta non confermata.

La revisione della collezione deve coincidere con quella vista dall'utente.
In caso di conflitto ricaricare il diario e controllare la scorta prima
di registrare di nuovo. Se la risposta si perde, ripetere lo stesso invio
dall'editor già aperto. Una ricevuta per account e ID conserva soltanto
l'impronta della richiesta, anche dopo la cancellazione della fumata,
per impedire addebiti tardivi. La modifica e la cancellazione di una
fumata non modificano le scorte. Eventuali correzioni sono manuali nel
catalogo. L'importazione scrive soltanto la sessione, con le policy RLS. Un backup
può ripristinare una sessione eliminata senza ripetere lo scarico.

## Avvisi di disponibilità

Il pannello **Avvisi di scorta** è disponibile nei cataloghi Sigari e Tabacchi
e nel Diario. Le preferenze sono salvate nel profilo Supabase sotto le
policy RLS esistenti. Vengono rilette all'apertura e quando la finestra torna
in primo piano, così si possono ritrovare anche su un altro dispositivo.
Gli avvisi sono attivi per impostazione predefinita e si possono disattivare
tutti insieme. Per i sigari la soglia iniziale è 3 pezzi, modificabile da 1
a 10. Una quantità positiva fino alla soglia mostra **Scorta bassa**,
zero mostra **Esaurito** e una quantità non specificata non genera avvisi.

Per i tabacchi gli avvisi dipendono solo dal livello visivo: **Quasi finito**
indica scorta bassa e **Finito** indica esaurimento. Gli indicatori si vedono
nelle schede, durante la scelta del prodotto e dopo un aggiornamento
confermato che lascia la scorta alla soglia, sotto soglia o esaurita.
Sono messaggi nell'interfaccia e la registrazione resta disponibile anche
con avvisi disattivati o senza scarico.

## Foto e backup

Il backup separato `tobacco-journal-smoking-journal` v1 include snapshot e
foto come data URL. Il limite in ingresso è 20 MiB e 10.000 schede per file.
Si possono suddividere copie più grandi mantenendo formato, versione e ID.
L'importazione richiede conferma, segnala record invalidi e duplicati e
non sovrascrive sessioni esistenti. Se il prodotto storico manca o l'ID ha
un'identità diversa nell'account di destinazione, lo snapshot si conserva
e il riferimento operativo resta vuoto.

La fotografia privata usa `journal-photos`, la relazione
`media.smoking_session_id` e il percorso `<user_id>/session-photos/<hash>`.
Valgono i limiti di 3 MiB e JPEG, PNG o WebP. Il diario verifica file e
metadati prima di attivare una nuova foto e pulisce quella sostituita.
La registrazione e lo scarico scorte sono atomici, mentre Storage
richiede un passaggio separato. Se la foto non si salva, la fumata risulta
registrata e il tentativo successivo riguarda la foto senza nuovo scarico.
Una foto con import incompleto resta nel payload temporaneo e può essere
caricata ripetendo lo stesso import. L'export segnala un errore se una
foto privata attiva non è disponibile. Per upload interrotti o pulizia
incompleta, usare la [procedura di riconciliazione](cloud-pipe-photos.md#oggetti-da-riconciliare)
con il prefisso delle sessioni. Un upload già inviato può terminare
dopo il logout, ma il client interrompe le associazioni successive.

## Verifiche

```sh
npm run typecheck
npm run build
npm test
npm run test:e2e -- --workers=2
bash supabase/tests/run-local.sh
```

Usare due account di test, dati di inventario sintetici e immagini di
prova. Registrare una fumata rapida di ciascun tipo, incluse la pipa
prestata e il tabacco offerto. Provare una doppia richiesta, una revisione
di scorta obsoleta, modifica e cancellazione, esportazione e importazione
con foto. Controllare le quantità dopo ogni passaggio. Da un altro account
o senza accesso verificare che sessioni e foto private siano illeggibili.
Verificare anche i riferimenti storici dopo aver eliminato un prodotto
di prova e i flussi pipe, tabacchi e sigari sulla stessa preview.

Nel Deploy Preview provare anche l'ultimo sigaro in due finestre, ritentare
la stessa richiesta e registrare una fumata senza scarico con quantità zero
o non specificata. Cambiare soglia, disattivare gli avvisi e ricaricare con
lo stesso account su un altro dispositivo. Il secondo account deve conservare
le proprie preferenze.
