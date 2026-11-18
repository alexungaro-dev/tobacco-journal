# Milestone 06 · Dashboard personale

La Dashboard è la pagina iniziale quando si entra senza un collegamento
specifico. I link diretti ai cataloghi e alle fumate conservano la loro
destinazione. **Nuova fumata** apre il modulo esistente del Diario. Le
tre fumate più recenti si aprono direttamente nei rispettivi dettagli.

I conteggi indicano schede, comprese le tipologie di sigari. Gli avvisi
usano le preferenze del profilo della Milestone 05. Sono disponibili anche
sulla Dashboard, che omette il pannello quando sono disattivati oppure
quando nessun prodotto soddisfa le soglie. Gli avvisi e la scheda
dell'ultimo prodotto rimandano al catalogo corrispondente.

La Dashboard usa la data della fumata, interpretata nel fuso locale del
browser. Gli ultimi 30 giorni comprendono oggi e i 29 giorni precedenti,
raggruppati in intervalli fino a sette giorni. Gli ultimi 12 mesi
comprendono il mese corrente e gli 11 precedenti. I periodi recenti
escludono date future. Lo storico completo comprende tutte le sessioni
registrate e si consulta in pagine di massimo 12 mesi. Le barre su ciascuna
pagina condividono la scala e riportano il conteggio numerico. I mesi
senza sessioni nella pagina restano a zero.

Per l'ultimo prodotto si confronta `created_at` dei tre cataloghi. Un
timestamp mancante o illeggibile esclude la scheda da quel confronto.
La data di inserimento indica la creazione della scheda su Supabase.
Per i prodotti importati può quindi coincidere con l'importazione.

Il caricamento usa le query paginate e filtrate per proprietario già
usate dal Diario. Le proiezioni JSON evitano di caricare i dettagli e le
foto delle sessioni per i riepiloghi. La Dashboard legge al massimo la
foto del prodotto più recente. Il bucket esistente serve l'originale,
nei limiti di 3 MiB, senza un'infrastruttura per miniature. Quando si passa
dalla Dashboard al Diario, le opzioni dei cataloghi sono riutilizzate.
Il ritorno alla Dashboard rilegge i dati e riflette le modifiche salvate.

## Verifica in Deploy Preview

1. Usare un progetto Supabase di prova con le migrazioni della
   [Milestone 05](cloud-smoking-journal.md#migrazione-da-applicare-manualmente)
   già applicate. La Dashboard non richiede nuove migrazioni.
2. Configurare l'origine della preview e i redirect Auth come indicato
   nella [guida Supabase](supabase-auth.md). Accedere dall'URL principale.
3. Inserire schede sintetiche con quantità distinte, qualche foto e
   fumate con date diverse, compresa una data retroattiva. Verificare
   conteggi, ordine per data della fumata, foto del prodotto più recente,
   provenienze e tutti e tre i periodi del grafico.
4. Registrare una fumata da **Nuova fumata**, poi tornare alla Dashboard.
   Controllare le ultime fumate e gli eventuali avvisi. Cambiare soglia o
   disattivare gli avvisi dal Diario o da un catalogo e verificare la
   Dashboard.
5. Ripetere con un altro account e su smartphone. Controllare che nessuna
   scheda dell'account precedente sia visibile.
