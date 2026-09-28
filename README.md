# Geo Capital Dashboard

Mappa interattiva (globo 3D e proiezione piana) di Stati, capitali, regioni di primo livello (admin-1) e città principali. Gli Stati si colorano per popolazione, superficie o densità. Si passa dalla vista Mondo a quella dei singoli continenti (Europa, Asia, Africa, Nord America, Sud America, Oceania). Cliccando su uno Stato compaiono le sue regioni con i capoluoghi e la tabella delle città più popolose.

L'app è completamente statica: i dati vengono precompilati in `public/data` e il sito si pubblica su GitHub Pages senza backend.

## Stack

- React 19 + TypeScript + Vite
- [MapLibre GL JS](https://maplibre.org) v6 per la mappa
- d3-scale / d3-scale-chromatic per le scale di colore, topojson-client per la geometria
- Vitest per i test
- Python 3 (solo libreria standard) + [mapshaper](https://github.com/mbloch/mapshaper) per la pipeline dati

Perché MapLibre: ha la proiezione a globo nativa e il rendering WebGL, e funziona con uno stile interamente locale (sorgenti GeoJSON e glifi serviti dal sito stesso). Non servono quindi tile server, API key o servizi a pagamento, e il sito resta al 100% statico.

## Fonti dati

| Fonte | Uso | Licenza |
| --- | --- | --- |
| [World Bank WDI](https://data.worldbank.org) (`SP.POP.TOTL`, `AG.SRF.TOTL.K2`) | Popolazione e superficie degli Stati | CC BY 4.0 |
| [Wikidata](https://www.wikidata.org) | Capitali; popolazione, superficie e capoluogo delle regioni admin-1; etichette in italiano; popolazione delle città, collegate tramite GeoNames ID (P1566) | CC0 |
| [GeoNames](https://www.geonames.org) `cities5000`, `alternateNamesV2` | Città principali, coordinate e popolazione; nomi italiani delle città | CC BY 4.0 |
| [Natural Earth](https://www.naturalearthdata.com) (admin-0 1:50m, admin-1 1:10m) | Confini di Stati e regioni | Pubblico dominio |
| [OpenFreeMap](https://openfreemap.org) fonts | Glifi Noto Sans (`.pbf`) per le etichette | SIL OFL 1.1 (Noto Sans) |

Le licenze CC BY 4.0 di World Bank e GeoNames richiedono l'attribuzione, che l'app mostra nell'interfaccia (fonti lette da `public/data/meta.json`). Chi riusa i dati o ne pubblica una derivazione deve mantenerla. Per Wikidata e Natural Earth l'attribuzione non è obbligatoria, ma è comunque indicata.

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
- `public/data/admin1/<ADM0>.json`: regioni di primo livello di ogni Stato, con statistiche e capoluogo, caricate on demand al click
- `public/data/meta.json`: data di generazione e fonti
- `public/fonts/Noto Sans {Regular,Bold}/*.pbf`: glifi per gli intervalli Unicode 0-8447

Scelte principali:

- **Province fuse in regioni.** Natural Earth modella alcuni Paesi a livello di province, dipartimenti o comuni. Per ITA, FRA, ESP, GBR, PHL e SVN le geometrie vengono fuse (dissolve) nelle regioni reali di primo livello. Le regioni risultanti sono poi collegate a Wikidata tramite il codice ISO 3166-2.
- **Popolazione.** Per gli Stati vale il dato World Bank più recente. Per le regioni si usa, tra i valori di Wikidata, quello con la data (`P585`) più recente. Se manca il dato della regione fusa, si usa la somma delle province.
- **Controlli sulla superficie.** La superficie Wikidata di uno Stato si usa solo se è coerente con l'area geodetica calcolata dal poligono (rapporto tra 0,6 e 1,6); altrimenti vale l'area calcolata. Una regione più grande del 105% del proprio Stato viene scartata (unità o ambito errati).

## Limiti noti

- Le popolazioni regionali di Wikidata possono essere datate: per esempio le regioni italiane sono ferme al 2019. L'anno di riferimento viene salvato insieme al valore.
- I nomi italiani delle città vengono da GeoNames (`alternateNamesV2`, ~200 MB scaricati una volta e tenuti in cache); dove manca un nome italiano si usa l'etichetta Wikidata o il nome GeoNames. La popolazione delle città è quella datata di Wikidata solo quando Wikidata collega la località al suo GeoNames ID (circa metà dei casi: spesso collega il comune invece della località); altrimenti è il valore GeoNames, senza anno.
- I confini Natural Earth rappresentano la situazione de facto e non implicano alcuna posizione su territori contesi.

## Sviluppo

```sh
npm install
npm run dev        # server di sviluppo Vite
npm test           # test Vitest
npm run typecheck  # tsc -b
npm run build      # typecheck + build di produzione in dist/
npm run data       # rigenera public/data e public/fonts
```

Il worker di MapLibre viene incluso come asset separato (`maplibre-gl-worker-*.js`) e registrato con `setWorkerUrl`. Per questo `vite.config.ts` usa `worker: { format: 'es' }`.

## Deploy

Il workflow `.github/workflows/deploy.yml` parte a ogni push su `main` (o a mano). Esegue `npm ci`, `npm test` e `npm run build`, poi pubblica `dist/` su GitHub Pages.

Per attivarlo: nelle impostazioni del repository, Settings > Pages > Build and deployment > Source, scegliere **GitHub Actions**.

Il base path predefinito è `/geo-capital-dashboard/`. Si può cambiare con la variabile d'ambiente `BASE_PATH`, per esempio `BASE_PATH=/ npm run build` per un dominio dedicato. Il workflow la imposta già a `/<nome-repo>/`.
