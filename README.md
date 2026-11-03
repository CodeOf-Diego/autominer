# Autominer

Sistema che, data la disposizione di un filone di ametista (il "geoide"), calcola il modo ottimale per scavarlo. Lo scavo è affidato a **tre macchine automatiche**, una per ciascun asse (X, Y, Z), che spingono blocchi di slime/miele per rompere l'ametista circostante senza doverla minare manualmente.

## Pipeline prevista

1. **Geoide** — mappa 3D del filone di ametista.
   Oggi viene generato casualmente ad ogni refresh della pagina, solo per avere dati di demo. In futuro andrà sostituito con un geoide reale e persistito.

2. **Perimetro e supporti per asse** *(step attuale, completo su tutti e 3 gli assi)*
   Per ciascuno dei 3 assi: appiattisce il volume in un piano 2D, trova le celle d'aria adiacenti all'ametista ("confini stretti"), individua le aree isolate, scarta quelle troppo piccole o senza un percorso a L percorribile, poi fonde i confini stretti vicini in strutture contigue più larghe aggiungendo blocchi di supporto ("confini larghi").
   **Vincolo Minecraft:** un pistone può spingere al massimo **12 blocchi in fila**, quindi nessun gruppo fuso può superare i 12 blocchi. L'algoritmo di fusione rispetta già questo limite, preferendo fondere il più possibile (per minimizzare il numero di gruppi — ogni gruppo richiederà una piston machine a sé) senza mai sforare il tetto.
   **Limite noto:** se un singolo confine stretto (prima di qualsiasi fusione) è già oltre 12 blocchi da solo, oggi **non viene spezzato** — resta sovradimensionato e viene segnalato in `data_layers.support.oversizedAreas` (+ `console.warn`). Spezzare un'area contigua troppo grande in più chunk da ≤12 è un problema a sé, ancora da affrontare.

3. **Struttura delle 3 macchine** *(da fare — prossimo step)*
   Dal perimetro/supporti di ciascun asse, generare la struttura fisica della macchina che scava su quell'asse.
   **Requisito:** ogni asse deve essere **swappabile di direzione** — poter scegliere se la macchina si costruisce "sopra" o "sotto" (e analogamente per gli altri due assi), così il calcolo parte dal lato scelto invece che sempre dallo stesso verso.
   **Requisito:** come nelle flying machine di Minecraft, va previsto un **sistema di ritorno** per il meccanismo a pistoni (non ancora chiaro se basti un blocco o serva altro — da approfondire in fase di progettazione di questo step).

4. **Struttura dei blocchi di slime** *(da fare)*
   Dalla struttura delle macchine, i blocchi di slime/miele necessari per spingere ed eseguire lo scavo.

5. **Piston machine** *(da fare)*
   Generare i pistoni che spingono i blocchi di slime — una macchina per ogni gruppo definito nello step 2.

6. **Modello 3D completo** *(da fare)*
   Risultato finale: visionabile e costruibile **layer per layer**, con possibilità di **esportare uno schematic** (es. formato Minecraft .schematic/.litematic).
   **Requisito:** calcolare anche il **costo in numero di risorse** (pistoni, blocchi di slime/miele, ecc.) necessario a costruire il tutto.

## Requisiti di interfaccia (trasversali, da fare)

- Menu per: caricare una nuova build a partire da una foto (da definire come, rimandato), aprirne una tra quelle salvate in **local storage**, o generarne una randomica (quello che si fa oggi) per vedere come funziona.
- Vista di avanzamento manuale della pipeline (vedi sotto) — già presente per lo step 2, da estendere man mano che si aggiungono gli step successivi.

## Visualizzazione a stage (step 2)

Poiché il calcolo sulla griglia attuale impiega pochi millisecondi, non ha senso un'animazione automatica step-by-step: la pagina mostra sempre di default il risultato finale. È però possibile ispezionare manualmente ogni fase con i tasti numerici:

- **1** — Geoide (solo ametista)
- **2** — Confini stretti (celle adiacenti all'ametista, non ancora filtrate)
- **3** — Confini validi (dopo lo scarto delle aree troppo piccole o senza percorso a L)
- **4** *(default)* — Raggruppamenti finali da max 12 blocchi, ogni gruppo con un colore diverso

Quando si aggiungeranno gli step 3+, andranno integrati in questa stessa vista a stage.

## Stato attuale

- Step 1 (geoide random) e step 2 (tutti e 3 gli assi, con vista a stage 1-4) funzionanti.
- Rendering con Three.js: camera principale + 3 camere ortogonali (una per asse) per vedere il risultato da più angolazioni contemporaneamente.
- Nessun build step: file JS separati caricati direttamente in `index.html`, niente bundler.

## Struttura del codice

- `js/Blocks.js` — enum dei tipi di voxel/blocco.
- `js/Matrix2D.js` / `js/Matrix3D.js` — wrapper per matrici 2D/3D con helper per scorrerle, leggere le celle vicine e clonarle (usato per gli snapshot degli stage).
- `js/Tools.js` — generazione del geoide casuale.
- `js/BuildingTools.js` — tutta la logica dello step 2 (perimetro, aree, supporti, raggruppamento a 12 blocchi).
- `js/SceneTools.js` — setup scena/camere Three.js e rendering dei voxel (inclusa la colorazione per gruppo dello stage 4).
- `main.js` — orchestratore: genera il geoide, lancia la pipeline con gli snapshot per stage, gestisce i tasti (1-4 per lo stage, `r` per rigenerare, `i` per il debug info).

## Prossimo passo

Iniziare lo step 3: dalla coppia perimetro+supporti di ciascun asse, generare la struttura fisica della macchina che scava su quell'asse — tenendo conto dei due requisiti aperti (asse swappabile, sistema di ritorno).
