# Autominer

Sistema che, data la disposizione di un filone di ametista (il "geoide"), calcola il modo ottimale per scavarlo. Lo scavo è affidato a **tre macchine automatiche**, una per ciascun asse (X, Y, Z), che spingono blocchi di slime/miele per rompere l'ametista circostante senza doverla minare manualmente.

Il progetto nasce ispirato al mod [Geodesy](https://github.com/kosmolot-mods/geodesy) (Fabric), che fa la stessa cosa in-game via comandi. Diversi vincoli già implementati qui sono stati confermati/presi dal suo codice sorgente: il range 4-12 blocchi per gruppo, la regola della forma a L (richiesta sul gruppo da spingere, non sulla macchina), l'alternanza slime/honey tra gruppi adiacenti, e il design esatto della flying machine (step 6).

## Pipeline prevista

0. **Ricostruzione da foto** *(in corso, stage 1 nell'app)*
   L'idea: partire da uno screenshot Minecraft reale di una geode e ricostruire la posizione 3D dei blocchi di ametista, così lo step 1 non deve più generare un geoide casuale ma può lavorare su dati reali. Primo pezzo (calibrazione della camera - angolazione, FOV, posizione) in corso:
   1. **Rilevamento linee** (`js/CalibrationTools.js::detectLines`) — Canny + Hough probabilistico via [OpenCV.js](https://docs.opencv.org/4.9.0/opencv.js) (CDN, ~10MB, caricato async), su una versione ridotta dell'immagine (smorza il rumore di texture fine mantenendo gli spigoli strutturali lunghi). Visibile allo **stage 1**.
   2. **Punti di fuga** (`findVanishingPoints`) — clustering RANSAC-like delle intersezioni a coppie di linee (accelerato con una griglia spaziale), rifinito con intersezione ai minimi quadrati. *Non ancora collegato allo stage 1* - vedi sotto.
   3. **Calibrazione** (`calibrateFromPair`) — dalla condizione di ortogonalità tra 2 punti di fuga si ricava la focale (quindi FOV) e l'orientamento della camera. **Validata**: un test sintetico con camera nota (f=500px) la recupera esatta.
   **Stato reale:** sul primo screenshot provato (`reference/screenshots/geode-01.png`) il rilevamento automatico non converge a una coppia di punti di fuga ortogonale valida, nemmeno dopo aver ridotto la risoluzione e stretto i filtri — i cristalli di ametista non sono cubi (bordi irregolari) e il pavimento di calcite è molto rumoroso, quindi non ci sono abbastanza spigoli lunghi e puliti allineati alla griglia in quella foto. Prossimo tentativo probabile: click manuale su 4-6 angoli riconoscibili invece del rilevamento automatico. C'è anche un prototipo standalone separato (`camera-calibration.html`, slider interattivi per i parametri Canny/Hough) usato per questi test, indipendente dall'app principale.

1. **Geoide** — mappa 3D del filone di ametista.
   Oggi viene generato casualmente ad ogni refresh della pagina, solo per avere dati di demo. In futuro andrà sostituito con un geoide reale (vedi step 0) e persistito.

2. **Perimetro e supporti per asse** *(completo su tutti e 3 gli assi)*
   Per ciascuno dei 3 assi: appiattisce il volume in un piano 2D, trova le celle d'aria adiacenti all'ametista ("confini stretti"), individua le aree isolate, scarta quelle troppo piccole o senza un percorso a L percorribile, poi fonde i confini stretti vicini in strutture contigue più larghe aggiungendo blocchi di supporto ("confini larghi").
   **Vincolo Minecraft (dimensione):** un pistone può spingere al massimo **12 blocchi in fila**, quindi nessun gruppo fuso può superare i 12 blocchi.
   **Vincolo Minecraft (materiale):** slime si attacca a slime, honey si attacca a honey, ma slime e honey **non** si attaccano tra loro. Due gruppi finali che si toccano fisicamente devono quindi usare materiali diversi, altrimenti si fonderebbero in uno solo sovradimensionato quando un pistone spinge. È un problema di **2-colorazione** sul grafo di adiacenza tra gruppi — non sempre risolvibile se 3+ gruppi si toccano a vicenda (ciclo dispari).
   **Algoritmo di raggruppamento** (`BuildingTools.js`): è un problema noto in letteratura — partizionamento di un grafo in componenti connesse con vincolo di capienza, minimizzando il numero di componenti — NP-hard per riduzione dallo Steiner Tree. Approccio a due fasi:
   1. **Steiner tree approssimato** (`computeAreaDistances` + `buildMSTForest`): BFS multi-sorgente da ogni confine stretto grezzo attraverso le sole celle d'aria, per trovare la distanza (e il cammino) più breve verso ogni altro confine raggiungibile — non solo quelli adiacenti a un singolo blocco. MST su queste distanze (metodo classico "metric closure MST", 2-approssimazione per Steiner tree).
   2. **Partizionamento ottimale dell'albero** (`partitionForest`): DFS post-order greedy — ogni nodo prova a fondere i sotto-alberi dei figli (dal più piccolo) finché stanno sotto i 12 blocchi, altrimenti li finalizza come gruppo a sé. Per questo specifico problema (minimizzare il numero di pezzi su un albero con vincolo di peso) questo è **ottimale**, non euristico.
   L'insieme (`simulateGrouping`) gira **40 volte** con tie-break casuali nell'MST, tenendo il risultato migliore: prima quelli 2-colorabili (slime/honey), poi quelli con meno gruppi. Se nessun tentativo è 2-colorabile, tiene il migliore comunque e lo segnala (`data_layers.support.bipartite`, `touchingConflicts`, `console.warn`) invece di ignorarlo.
   La randomicità è **deterministica**: ogni esecuzione usa un PRNG seedato (`makePRNG` in `Tools.js`), quindi stesso seed ⇒ stesso risultato (vena + raggruppamento), seed diverso ⇒ risultato diverso.
   **Limite noto:** se un singolo confine stretto (prima di qualsiasi fusione) è già oltre 12 blocchi da solo, oggi **non viene spezzato** — resta sovradimensionato e viene segnalato in `data_layers.support.oversizedAreas` (+ `console.warn`). Spezzare un'area contigua troppo grande in più chunk da ≤12 è un problema a sé, ancora da affrontare.

3. **Struttura delle 3 macchine** *(prima versione fatta, step 7 — vedi sotto)*
   Dal perimetro/supporti di ciascun asse, generare la struttura fisica della macchina che scava su quell'asse. Implementato come **stage 7** nell'app: una flying machine per ogni gruppo finale, usando il design esatto del mod Geodesy (`js/MachineTools.js`, `MACHINE_TEMPLATE` trascritto dalle chiamate `setBlock()` reali di `GeodesyCore.java::buildMachine()`, verificate riga per riga sul sorgente — struttura lineare da 20 blocchi, 9×3×1 più un gap d'aria, non ad L: la L richiesta dal solver è sulla *forma del gruppo* da spingere, non sulla macchina stessa).
   **Requisito "asse swappabile":** *fatto* — i checkbox "Inverti asse" nel menu impostazioni decidono su quale lato del geoide si costruisce il blueprint/la macchina di quell'asse.
   **Requisito "sistema di ritorno":** *risolto concettualmente* — la macchina è ancorata tra due blocchi di obsidian fissi (non si sposta fisicamente nel mondo): quello lato geoide è separato dal primo pistone da **un blocco d'aria** (il mod cancella lì il marker del giocatore), lo spazio in cui quel pistone deve estendersi per funzionare — senza quel gap sarebbe incollato all'ossidiana e non potrebbe mai spingere. Il meccanismo redstone esatto che fa scattare i pistoni in sequenza non è stato tracciato nel dettaglio, solo il layout statico dei blocchi.
   **Limite noto:** le macchine di gruppi vicini non vengono controllate per sovrapposizioni — possono compenetrarsi visivamente. Non ancora affrontato.

4. **Struttura dei blocchi di slime** *(da fare)*
   Dalla struttura delle macchine, i blocchi di slime/miele necessari per spingere ed eseguire lo scavo.

5. **Piston machine** *(da fare)*
   Generare i pistoni che spingono i blocchi di slime — una macchina per ogni gruppo definito nello step 2.

6. **Modello 3D completo** *(da fare)*
   Risultato finale: visionabile e costruibile **layer per layer**, con possibilità di **esportare uno schematic** (es. formato Minecraft .schematic/.litematic).
   **Requisito:** calcolare anche il **costo in numero di risorse** (pistoni, blocchi di slime/miele, ecc.) necessario a costruire il tutto.

## Requisiti di interfaccia (trasversali)

- **Menu impostazioni generazione** *(fatto, tasto `m`)* — densità ore, range (spessore guscio), distanza macchine dal geoide, inversione per asse (quale lato del geoide ospita il blueprint/confini di quell'asse — primo passo verso il requisito "asse swappabile" dello step 3), import di un JSON (sparse o denso), bottone Generate (usa il JSON incollato se presente, altrimenti genera random dagli slider). Include anche uno slider di preferenza slime/honey (0=honey..100=slime, default 100) — **solo UI per ora**, non ancora collegato all'algoritmo di raggruppamento/colorazione (verrà implementato in seguito: più lo slider pende verso slime, più il sistema dovrebbe preferire quel materiale nella 2-colorazione, pur restando garantito un minimo di entrambi dato che una build di un solo materiale è estremamente improbabile).
- Menu per: caricare una nuova build a partire da una foto (da definire come, rimandato), aprirne una tra quelle salvate in **local storage** *(ancora da fare — oggi solo import via JSON incollato)*.
- Vista di avanzamento manuale della pipeline (vedi sotto) — già presente per lo step 2, da estendere man mano che si aggiungono gli step successivi.

## Visualizzazione a stage (step 2)

Poiché il calcolo sulla griglia attuale impiega pochi millisecondi, non ha senso un'animazione automatica step-by-step: la pagina mostra sempre di default il risultato finale. È però possibile ispezionare manualmente ogni fase con i tasti numerici:

- **1** — Foto + linee rilevate (step 0, ricostruzione da foto - vedi sopra): lo screenshot di riferimento con sopra i segmenti trovati da Canny+Hough, per seguire visivamente quanto bene il rilevamento sta andando
- **2** — Geoide (solo ametista)
- **3** — Confini stretti (celle adiacenti all'ametista, non ancora filtrate)
- **4** — Confini validi (dopo lo scarto delle aree troppo piccole o senza percorso a L)
- **5** — Raggruppamenti finali da max 12 blocchi, ogni gruppo con un colore diverso (palette fissa di 8 colori, non calcolata — evita che due gruppi vicini ricevano tonalità troppo simili)
- **6** *(default)* — Materiali: lo stesso raggruppamento ridotto ai soli 2 colori slime (verde) / honey (giallo)
- **7** — Flying machines: una macchina (design Geodesy, 19 blocchi + gap) per ogni gruppo finale, ancorata al suo centroide ed estesa verso l'esterno lungo l'asse

Stage 1 sostituisce la scena 3D con un canvas 2D (foto + overlay linee); tutti gli altri stage usano la scena Three.js come sempre. Dallo stage 5 in su, ogni gruppo ha anche un numero identificativo (0, 1, 2...) stampato sopra di sé in ciascuna delle 3 viste laterali, assegnato in ordine di id area crescente — utile per riferirsi a un gruppo specifico senza ambiguità.

**Vista a livelli (step 8, tasto `l`)** — mostra un solo livello Y alla volta invece dell'intera scena (geoide + blueprint + macchine), per gli stage 2-7 (non si applica allo stage 1, che è 2D). Serve a costruire e verificare il risultato in Minecraft un layer orizzontale per volta, come si fa davvero in gioco (utile soprattutto allo stage 7 per controllare che una flying machine funzioni davvero prima di costruire tutto). Il range dei livelli naviga dal primo all'ultimo che contengono davvero qualcosa (non l'intero bounding box, quasi sempre più grande), e salendo di livello quelli già attraversati restano visibili sotto ma semi-trasparenti, come riferimento di quanto già costruito. Frecce su/giù per cambiare livello, `l` di nuovo per tornare alla vista completa.

Altri tasti: `r` rigenera una nuova vena casuale (con le impostazioni correnti), `e` copia vena+seed negli appunti (vedi sotto), `i` mostra/nasconde il pannello di debug, `m` mostra/nasconde il menu impostazioni.

Quando si aggiungeranno gli step 3+, andranno integrati in questa stessa vista a stage.

## Riproducibilità (seed)

Ogni run (vena + raggruppamento sui 3 assi) è guidato da un singolo seed numerico, generato casualmente a ogni avvio/rigenerazione ma completamente deterministico: lo stesso seed produce sempre esattamente lo stesso risultato. Premendo `e` si copia negli appunti un JSON compatto `{seed, size, ores}` (dimensione della griglia + coordinate `[x,y,z]` delle sole celle di ametista, 0-based come gli indici della matrice; ~180 byte invece di ~7 KB per una griglia 15×15×15). Per ricaricarlo: `let {seed, vein} = veinFromExport(json); processVein(vein, seed)` — legge anche il vecchio formato denso `{seed, vein}`. Per una vena casuale il solo `seed` basta già a rigenerarla; `ores` serve per veine non generate (geoide reale).

## Stato attuale

- Step 1 (geoide random, seedato), step 2 (tutti e 3 gli assi) e una prima versione dello step 3 (flying machines, stage 7) funzionanti. Step 0 (ricostruzione da foto) in corso: rilevamento linee ok, calibrazione camera validata ma non ancora convergente sulla foto reale di test. Vista a stage 1-7, più vista a livelli (step 8, tasto `l`, stage 2-7) per ispezionare/costruire un singolo livello Y alla volta.
- Rendering con Three.js (stage 2-7): camera principale + 3 camere ortogonali (una per asse) per vedere il risultato da più angolazioni contemporaneamente. Stage 1 usa invece un canvas 2D separato (foto + linee rilevate).
- Nessun build step: file JS separati caricati direttamente in `index.html`, niente bundler. Unica eccezione: OpenCV.js (per lo stage 1) caricato da CDN, non vendorizzato nel repo.
- Pagina di riferimento a parte (`flying-machine-templates.html`, aprila direttamente nel browser): modelli 3D esplorabili dei meccanismi a pistoni, utile per verificare visivamente i design prima di fidarsene.
- Altra pagina a parte (`camera-calibration.html`): sandbox per tarare interattivamente i parametri di rilevamento linee (Canny/Hough) su una foto, usata per lo sviluppo dello step 0.

## Struttura del codice

- `js/Blocks.js` — enum dei tipi di voxel/blocco.
- `js/Matrix2D.js` / `js/Matrix3D.js` — wrapper per matrici 2D/3D con helper per scorrerle, leggere le celle vicine e clonarle (usato per gli snapshot degli stage).
- `js/Tools.js` — generazione del geoide casuale (seedata) + PRNG deterministico (`makePRNG`), formato compatto delle vene (`veinToSparse`/`veinFromSparse`/`veinFromExport`).
- `js/BuildingTools.js` — tutta la logica dello step 2 (perimetro, aree, supporti, raggruppamento a 12 blocchi con 2-colorazione slime/honey, centroidi dei gruppi per i numeri identificativi).
- `js/MachineTools.js` — step 3: `MACHINE_TEMPLATE` (design Geodesy) e `computeMachineBlocks()`, che lo posiziona per ogni gruppo finale.
- `js/CalibrationTools.js` — step 0: rilevamento linee (`detectLines`, Canny+Hough via OpenCV.js) e la matematica di calibrazione camera (`findVanishingPoints`, `calibrateFromPair`) — quest'ultima non ancora collegata allo stage 1, vedi sopra.
- `js/SceneTools.js` — setup scena/camere Three.js, rendering dei voxel (palette fissa per gruppo allo stage 5, 2 colori materiale allo stage 6, blocchi macchina allo stage 7), numeri identificativi dei gruppi proiettati sulle viste laterali, toggle scena 3D on/off (`set3DVisible`) per lo stage 1.
- `main.js` — orchestratore: genera il geoide da un seed secondo le impostazioni correnti, lancia la pipeline con gli snapshot per stage, gestisce i tasti (1-7 per lo stage, `r` per rigenerare, `e` per esportare, `i` per il debug info, `m` per il menu impostazioni, `l` + frecce su/giù per la vista a livelli) e il menu impostazioni stesso (`setupSettingsMenu()`).

## Prossimo passo

Step 0: probabilmente passare al click manuale per la calibrazione camera (il rilevamento automatico non converge sulla foto di test). Poi: risolvere la sovrapposizione tra macchine di gruppi vicini (step 3), proseguire con lo step 4 (struttura dei blocchi di slime come dato a sé, non solo visualizzazione) e lo step 5 (pistoni veri, collegamento redstone tra le macchine).
