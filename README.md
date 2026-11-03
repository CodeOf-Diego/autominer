# Autominer

Sistema che, data la disposizione di un filone di ametista (il "geoide"), calcola il modo ottimale per scavarlo. Lo scavo è affidato a **tre macchine automatiche**, una per ciascun asse (X, Y, Z), che spingono blocchi di slime/miele per rompere l'ametista circostante senza doverla minare manualmente.

## Pipeline prevista

1. **Geoide** — mappa 3D del filone di ametista.
   Oggi viene generato casualmente ad ogni refresh della pagina, solo per avere dati di demo. In futuro andrà sostituito con un geoide reale e persistito.

2. **Perimetro e supporti per asse** *(step attuale, implementato solo sull'asse X)*
   Per ciascuno dei 3 assi: appiattisce il volume in un piano 2D, trova le celle d'aria adiacenti all'ametista, individua le aree isolate, scarta quelle troppo piccole o senza un percorso a L percorribile, e calcola i blocchi di supporto minimi per tenere insieme le aree rimaste.
   Y e Z sono disabilitati (commentati in `main.js` e `BuildingTools.js`) — da riattivare quando si passa allo step 3.

3. **Struttura delle 3 macchine** *(da fare)*
   Dal perimetro/supporti di ciascun asse, generare la struttura fisica della macchina che scava su quell'asse.

4. **Struttura dei blocchi di slime** *(da fare)*
   Dalla struttura delle macchine, i blocchi di slime/miele necessari per spingere ed eseguire lo scavo.

5. **Piston machine** *(da fare)*
   Generare i pistoni che spingono i blocchi di slime.

6. **Modello 3D completo** *(da fare)*
   Risultato finale, visionabile e costruibile layer per layer.

L'idea di fondo è che il sistema ragioni in automatico sui vari passaggi e li mostri graficamente, uno step alla volta.

## Stato attuale

- Step 1 (geoide random) e step 2 (solo asse X) funzionanti.
- Rendering con Three.js: camera principale + 3 camere ortogonali (una per asse) per vedere il risultato da più angolazioni contemporaneamente.
- Nessun build step: file JS separati caricati direttamente in `index.html`, niente bundler.

## Struttura del codice

- `js/Blocks.js` — enum dei tipi di voxel/blocco.
- `js/Matrix2D.js` / `js/Matrix3D.js` — wrapper per matrici 2D/3D con helper per scorrerle e leggere le celle vicine.
- `js/Tools.js` — generazione del geoide casuale.
- `js/BuildingTools.js` — tutta la logica dello step 2 (perimetro, aree, supporti).
- `js/SceneTools.js` — setup scena/camere Three.js e rendering dei voxel.
- `main.js` — orchestratore: genera il geoide, lancia la pipeline, avvia il rendering.

## Prossimo passo

Riattivare l'asse Y e poi Z (uno alla volta) nello step 2, prima di iniziare lo step 3 (struttura delle macchine).
