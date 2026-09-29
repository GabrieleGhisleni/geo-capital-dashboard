# Geo Capital Dashboard

Mappa interattiva (globo 3D e proiezione piana) di Stati, capitali, regioni di primo livello (admin-1) e città principali. Gli Stati si colorano per popolazione, superficie, densità, popolazione urbana, PIL, PIL pro capite (nominale e a parità di potere d'acquisto), aspettativa di vita, quota di over 65, figli per donna o CO₂ pro capite; le regioni per popolazione, superficie, densità, PIL, PIL pro capite e aspettativa di vita. Si passa dalla vista Mondo a quella dei singoli continenti (Europa, Asia, Africa, Nord America, Sud America, Oceania). Cliccando su uno Stato compaiono le sue regioni con i capoluoghi e la tabella delle città più popolose.

L'app è statica: i dati vengono precompilati in `public/data` e il sito si pubblica su GitHub Pages senza backend. L'unica eccezione è lo sfondo a rilievo, facoltativo, che carica le immagini dai server NASA.

Per orientarsi nel codice senza rileggerlo tutto: [CLAUDE.md](CLAUDE.md) descrive la struttura dei file, il formato dei dati, il funzionamento interno della mappa e le procedure per aggiungere un indicatore.

## Funzionalità

- **Mappa**: globo, proiezione piana Equal Earth (aree proporzionali) o Mercatore. Pinch e scroll a due dita sul trackpad.
- **Sfondo**: semplice (solo colori) o a rilievo, con montagne e fondali dalle immagini NASA Blue Marble. Con il rilievo i colori dell'indicatore diventano semitrasparenti. Il rilievo funziona su globo e Mercatore, non nella vista Piana; è nitido fino allo zoom 8, oltre si sfoca. Al polo nord il globo mostra una calotta con leggere striature, perché MapLibre chiude i poli oltre gli 85° stirando il bordo delle tile.
- **Colori**: si sceglie l'indicatore tra i pulsanti raggruppati in Popolazione e territorio, Economia, Salute e società, Ambiente. Fonti e scorciatoie sono raccolte in fondo alla barra di sinistra, in "Fonti e scorciatoie". Le grandezze che variano di ordini di grandezza usano una scala logaritmica; percentuali, anni e figli per donna una scala lineare. La legenda indica il valore sotto il cursore.
- **Stato selezionato**: la mappa lo divide in regioni. Le regioni sono colorate per l'indicatore scelto se c'è il dato regionale, altrimenti con tinte che distinguono le regioni vicine. Il pannello mostra bandiera, statistiche, Stati confinanti (cliccabili), la tabella delle regioni con la quota di popolazione sul totale dello Stato e le città principali con la loro quota. La tabella è ordinata per popolazione; cliccando le intestazioni si ordina per nome o per la terza colonna.
- **Telefono**: il pannello dello Stato diventa un riquadro in basso; statistiche compatte (quattro per riga, il testo si rimpicciolisce se un valore non ci sta), Stati confinanti, regioni e città principali chiusi, da aprire con un tocco. Le fonti sulla mappa sono raccolte nel pulsante ⓘ. Toccando una regione, un capoluogo o una città si apre una scheda con i suoi dati (su desktop compaiono al passaggio del mouse).
- **Linea del tempo**: sotto la legenda, un cursore dell'anno (dal 1960, dal 1990 per il PIL a parità di potere d'acquisto, dal 1970 per la CO₂) e il pulsante ▶ che anima la mappa anno per anno. La scala dei colori resta la stessa per tutti gli anni. La scheda di uno Stato mostra l'andamento dell'indicatore scelto.
- **Link condivisibili**: l'indirizzo contiene vista, indicatore, Stato, proiezione, sfondo, anno e notte (es. `#v=asia&m=gdp&c=JPN&y=1990`). Il pulsante con la catena lo copia (o apre la condivisione sul telefono).
- **Giorno e notte**: interruttore nelle opzioni; ombreggia la parte del mondo dove ora è notte. La scheda dello Stato mostra l'ora locale della capitale e i fusi orari dello Stato; il riquadro di una regione mostra l'ora locale del suo capoluogo.
- **Scorciatoie**: <kbd>R</kbd> ripristina la mappa, <kbd>S</kbd> entra ed esce dalla modalità studio, <kbd>/</kbd> porta alla ricerca, <kbd>Esc</kbd> chiude lo Stato selezionato. Cmd/Ctrl+T e Cmd/Ctrl+R restano al browser, che non permette di intercettare la prima.
- **Tema**: chiaro di base; il pulsante con la luna passa al tema scuro (mappa compresa) e la scelta resta salvata nel browser.
- **Cursore**: freccia sulla mappa, mirino circolare su ciò che si può cliccare, mano chiusa durante il trascinamento.
- **Simboli**: le capitali hanno un simbolo a bersaglio (anello con punto centrale), i capoluoghi regionali un punto pieno, le città un punto semplice. Sul globo i simboli sono appoggiati alla superficie: verso l'orizzonte si schiacciano come le terre invece di ammassarsi sul bordo.
- **Modalità studio**: esercizi raggruppati in Capitali (Stato → capitale, capitale → Stato, "dov'è la capitale?" toccando la mappa, giusto entro 150 km), Stati (mappa → Stato, "dov'è lo Stato?" toccando la mappa, bandiere, confini), Numeri e ripasso (popolazione, flashcard) e Regioni (capoluoghi e regione evidenziata, per lo Stato scelto). Dopo una risposta sulla mappa compaiono il punto toccato, quello giusto e la distanza. "Progressi sulla mappa" colora gli Stati indovinati, sbagliati e da fare; "Ricomincia" riparte da capo nell'esercizio attuale, "Azzera tutto" cancella progressi e record. Ogni Stato esce una volta per giro e le risposte sbagliate tornano solo alla fine del giro. I progressi restano salvati nel browser per ogni vista e modalità. Passando il mouse su uno Stato se ne vedono le regioni; dopo la risposta compaiono i dati dello Stato, compresi gli abitanti della capitale.

## Stack

- React 19 + TypeScript + Vite
- [MapLibre GL JS](https://maplibre.org) v6 per la mappa
- d3-scale / d3-scale-chromatic per le scale di colore, topojson-client per la geometria
- Vitest per i test
- Python 3 (solo libreria standard) + [mapshaper](https://github.com/mbloch/mapshaper) per la pipeline dati

Perché MapLibre: ha la proiezione a globo nativa e il rendering WebGL, e funziona con uno stile interamente locale (sorgenti GeoJSON e glifi serviti dal sito stesso). Non servono quindi tile server propri, API key o servizi a pagamento. Lo sfondo a rilievo (facoltativo, spento di default) usa le tile pubbliche di NASA GIBS; con lo sfondo semplice il sito non contatta nessun servizio esterno.

## Fonti dati

| Fonte | Uso | Licenza |
| --- | --- | --- |
| [World Bank WDI](https://data.worldbank.org), serie storiche 1960–oggi | Linea del tempo (`public/data/history/`) | CC BY 4.0 |
| [World Bank WDI](https://data.worldbank.org) (`SP.POP.TOTL`, `AG.SRF.TOTL.K2`, `NY.GDP.MKTP.CD`, `NY.GDP.PCAP.CD`, `NY.GDP.PCAP.PP.CD`, `SP.DYN.LE00.IN`, `SP.POP.65UP.TO.ZS`, `SP.DYN.TFRT.IN`, `SP.URB.TOTL.IN.ZS`, `EN.GHG.CO2.PC.CE.AR5`) | Indicatori degli Stati: popolazione, superficie, PIL (nominale e PPA), aspettativa di vita, over 65, fecondità, urbanizzazione, CO₂ | CC BY 4.0 |
| [NASA GIBS](https://earthdata.nasa.gov/gibs) (`BlueMarble_ShadedRelief_Bathymetry`) | Sfondo a rilievo, caricato dal browser solo se scelto | Pubblico dominio (NASA) |
| [flag-icons](https://github.com/lipis/flag-icons) | Bandiere SVG (`public/flags`, copiate con `npm run flags`) | MIT |
| [DOSE v2.9](https://doi.org/10.5281/zenodo.13773040) (MCC-PIK, Wenz et al. 2023) | PIL pro capite delle regioni in US$ correnti (~1.500 regioni di 83 Paesi, anni 2017-2020 per lo più) | CC BY 4.0 |
| [OECD Regional Statistics](https://data-explorer.oecd.org) (`DF_LIFE_EXP`) | Aspettativa di vita delle regioni (~840 regioni: Paesi OCSE e partner) | CC BY 4.0 |
| [Wikidata](https://www.wikidata.org) | Capitali; popolazione, superficie e capoluogo delle regioni admin-1; etichette in italiano; popolazione delle città, collegate tramite GeoNames ID (P1566) | CC0 |
| [GeoNames](https://www.geonames.org) `cities5000`, `alternateNamesV2` | Città principali, coordinate e popolazione; nomi italiani delle città | CC BY 4.0 |
| [Natural Earth](https://www.naturalearthdata.com) (admin-0 1:50m, admin-1 1:10m) | Confini di Stati e regioni | Pubblico dominio |
| [OpenFreeMap](https://openfreemap.org) fonts | Glifi Noto Sans (`.pbf`) per le etichette | SIL OFL 1.1 (Noto Sans) |

Le licenze CC BY 4.0 di World Bank, GeoNames, DOSE e OCSE richiedono l'attribuzione, che l'app mostra nell'interfaccia (fonti lette da `public/data/meta.json`). Chi riusa i dati o ne pubblica una derivazione deve mantenerla. Per Wikidata e Natural Earth l'attribuzione non è obbligatoria, ma è comunque indicata.

## Pipeline dati

```sh
npm install      # installa anche mapshaper (devDependency)
npm run data     # python3 scripts/build_data.py
```

Lo script richiede la rete. I download (shapefile, dump GeoNames, risposte delle API) finiscono in cache in `.data-cache/`, che è in `.gitignore`. Per forzare un nuovo download basta cancellare la cartella.

Cosa produce:

- `public/data/countries.topo.json`: confini degli Stati (TopoJSON semplificato)
- `public/data/countries.json`: attributi per Stato (nome IT/EN, ISO, continente, popolazione, superficie, capitali, bbox)
- `public/data/cities.json`: le città principali per Stato (fino a 20)
- `public/data/admin1/<ADM0>.json`: regioni di primo livello di ogni Stato, con statistiche (popolazione, superficie, PIL, aspettativa di vita dove disponibili) e capoluogo, caricate on demand al click
- `public/data/meta.json`: data di generazione e fonti
- `public/fonts/Noto Sans {Regular,Bold}/*.pbf`: glifi per gli intervalli Unicode 0-8447

Scelte principali:

- **Province fuse in regioni.** Natural Earth modella alcuni Paesi a livello di province, dipartimenti o comuni. Per ITA, FRA, ESP, GBR, PHL e SVN le geometrie vengono fuse (dissolve) nelle regioni reali di primo livello. Le regioni risultanti sono poi collegate a Wikidata tramite il codice ISO 3166-2.
- **Popolazione.** Per gli Stati vale il dato World Bank più recente. Per le regioni si usa, tra i valori di Wikidata, quello con la data (`P585`) più recente. Se manca il dato della regione fusa, si usa la somma delle province.
- **Indicatori regionali per nome.** DOSE e OCSE hanno liste di regioni proprie (codici GADM e TL2/TL3), senza un codice in comune con Natural Earth. Ogni regione della fonte si collega a una regione Natural Earth dello stesso Stato per nome: nomi Natural Earth, etichette ed alias Wikidata (inglese, italiano, nome nativo), prima uguali, poi con piccole varianti di grafia. Il collegamento è uno a uno e, se la fonte dà la popolazione, deve concordare entro un fattore 2. Le regioni di suddivisioni diverse (le 47 contee del Kenya contro le 8 province Natural Earth, le NUTS 3 portoghesi) restano senza dato. Per l'OCSE si usa, Stato per Stato, il livello (TL2 o TL3) che trova più corrispondenze: TL3 sono per esempio le prefetture giapponesi.
- **PIL regionale.** DOSE dà il PIL pro capite in US$ correnti (stessa unità del PIL World Bank degli Stati); il PIL totale della regione è il pro capite per la popolazione DOSE dello stesso anno.
- **Popolazione delle città.** Il valore Wikidata si scarta quando supera di oltre 10 volte quello GeoNames: in quei casi il collegamento Wikidata punta al distretto o alla provincia (Masvingo: 1,6 milioni invece di 90 mila).
- **Fusi orari.** Ogni capitale (anche regionale) prende il fuso della località GeoNames più vicina; i fusi di uno Stato sono quelli delle sue località, filtrati con la tabella `zone.tab` di tzdata perché GeoNames assegna ad alcune località di confine il fuso del vicino. L'ora e gli scostamenti da UTC (ora legale compresa) sono calcolati nel browser.
- **Serie storiche.** Ogni indicatore copre gli anni in cui almeno il 40% degli Stati ha un valore; i file (10–55 KB compressi) si scaricano solo quando si apre la linea del tempo o una scheda Stato.
- **Confini.** Gli Stati confinanti si calcolano nel browser dai tratti di confine condivisi nella topologia Natural Earth 1:50m. Contano solo i confini terrestri; i territori d'oltremare sono parte dello Stato (la Francia confina con il Brasile tramite la Guyana francese).
- **Controlli sulla superficie.** La superficie Wikidata di uno Stato si usa solo se è coerente con l'area geodetica calcolata dal poligono (rapporto tra 0,6 e 1,6); altrimenti vale l'area calcolata. Una regione più grande del 105% del proprio Stato viene scartata (unità o ambito errati).

## Limiti noti

- Le popolazioni regionali di Wikidata possono essere datate: per esempio le regioni italiane sono ferme al 2019. L'anno di riferimento viene salvato insieme al valore.
- I nomi italiani delle città vengono da GeoNames (`alternateNamesV2`, ~200 MB scaricati una volta e tenuti in cache); dove manca un nome italiano si usa l'etichetta Wikidata o il nome GeoNames. La popolazione delle città è quella datata di Wikidata solo quando Wikidata collega la località al suo GeoNames ID (circa metà dei casi: spesso collega il comune invece della località); altrimenti è il valore GeoNames, senza anno.
- PIL e aspettativa di vita regionali coprono solo parte del mondo (DOSE: 83 Paesi; OCSE: circa 50) e hanno anni diversi da quelli nazionali. Per gli Stati senza dato regionale la mappa colora lo Stato intero e lo segnala nella legenda.
- I confini Natural Earth rappresentano la situazione de facto e non implicano alcuna posizione su territori contesi.

## Sviluppo

```sh
npm install
npm run dev        # server di sviluppo Vite
npm test           # test Vitest
npm run typecheck  # tsc -b
npm run build      # typecheck + build di produzione in dist/
npm run lint       # oxlint
npm run data       # rigenera public/data e public/fonts
npm run validate   # controlli di plausibilità sui dati generati
npm run flags      # copia le bandiere da flag-icons in public/flags
```

La pipeline sovrascrive i file di `public/data/admin1/` senza cancellare la cartella: se la cartella sparisce mentre `npm run dev` è attivo, Vite smette di servirla e l'app mostra "Regioni non disponibili" (in quel caso basta riavviare il server). In sviluppo il sito è su `http://localhost:5173/geo-capital-dashboard/`.

Il worker di MapLibre viene incluso come asset separato (`maplibre-gl-worker-*.js`) e registrato con `setWorkerUrl`. Per questo `vite.config.ts` usa `worker: { format: 'es' }`.

## Deploy

La quantità di dati non è un problema per GitHub Pages. Il sito compilato (`dist/`) pesa circa 11 MB in circa 580 file (4,7 MB compressi): 3 MB di dati, 4,6 MB di glifi, 1,6 MB di bandiere e 1,3 MB di JavaScript. I limiti di GitHub Pages sono 1 GB per sito, 100 MB per file e un limite indicativo di 100 GB di traffico al mese. Alla prima visita si scaricano circa 230 KB di dati compressi (`countries.topo.json`, `countries.json`, `cities.json`). Le regioni (`admin1/<ADM0>.json`, da meno di 1 KB a 110 KB), le bandiere e i glifi si caricano solo quando servono. La cache della pipeline (`.data-cache/`, circa 300 MB) resta fuori dal repository, dove si pubblicano solo i dati già compilati in `public/data`.

Passi per pubblicare:

1. Creare il repository su GitHub e collegarlo: `git remote add origin git@github.com:<utente>/geo-capital-dashboard.git`, poi `git push -u origin main`.
2. In Settings > Pages > Build and deployment > Source, scegliere **GitHub Actions**.
3. Ogni push su `main` ripubblica il sito su `https://<utente>.github.io/geo-capital-dashboard/`.

Il workflow `.github/workflows/deploy.yml` parte a ogni push su `main` (o a mano). Esegue `npm ci`, `npm test` e `npm run build`, poi pubblica `dist/` su GitHub Pages.

Il base path predefinito è `/geo-capital-dashboard/`. Si può cambiare con la variabile d'ambiente `BASE_PATH`, per esempio `BASE_PATH=/ npm run build` per un dominio dedicato. Il workflow la imposta già a `/<nome-repo>/`.
