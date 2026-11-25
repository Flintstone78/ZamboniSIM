# ZamboniSIM 🧊🚜

Ett webbaserat simulatorspel där du kör ismaskin (zamboni) på hockeyarenor.
Spola hela isen så perfekt och snabbt som möjligt – men kör inte in i sargen!

Spela direkt i webbläsaren: **https://flintstone78.github.io/ZamboniSIM/**

## Spela

```bash
npm install
npm run dev
```

Öppna webbläsaren på adressen Vite skriver ut (normalt `http://localhost:5173`).

### Karriär

Spelets UI är på engelska. Från startsidan väljer du region, som styr både
rinkbredd och vilken karriärstege du klättrar – två separata banor med egna
stjärnor och upplåsningar:

- **Europe** (30 m bred rink): Div 5 *Training Hall* → Div 2 *Local Rink* →
  *Allsvenskan Arena* → SHL *Top Arena*, plus bonusnivån *National Team Camp*.
- **North America** (smalare 26 m NHL-rink): Juniors *Practice Rink* → ECHL →
  AHL → NHL *Arena*, plus bonusnivån *All-Star Game*.

Varje nivå har kortare tid och fler hinder än den förra. Klara en nivå för att
låsa upp nästa; ta tre stjärnor på alla fyra för att låsa upp regionens
bonusnivå. Varje nivå börjar i maskinrummet – porten i sargen glider upp och du
kör ut på isen. Precis som i en riktig spolning står målburarna avlyfta från
mållinjen och parkerade mot långsidornas sarg medan du jobbar.

### Kontroller

| Tangent | Funktion |
| --- | --- |
| `W` / `↑` | Gas |
| `S` / `↓` | Broms / back |
| `A` `D` / `←` `→` | Styrning |
| `SPACE` | Skrapa upp / ner (spolar bara när den är nere) |
| `SHIFT` | Turbo |
| `C` | Växla kamera (chase → förarvy → översikt), med mjuk övergång |
| `M` | Ljud av/på |
| `R` | Börja om |
| `ESC` / `P` | Paus (fortsätt, börja om eller gå till menyn). Spelet pausar också själv om fönstret tappar fokus |

**Handkontroll** (standardmappning, t.ex. Xbox/PlayStation): vänster spak eller
D-pad styr, `RT`/`LT` gas och back (analogt), `A` skrapa/dumpa snö, `RB` eller
`X` turbo, `Y` kamera, `Back` börja om, `Start` paus. I menyerna flyttar
D-pad fokus och `A` väljer, `B` backar. På mobil finns en pausknapp under
nivånamnet.

### Poäng

- **Täckning** – varje kvadratmeter spolad is ger poäng. Spåret läggs bara när
  du kör framåt (skrapan är nere).
- **Precision** – att köra över redan spolad is räknas som överlapp och sänker
  precisionen.
- **Tidsbonus** – ju snabbare isen är klar, desto större bonus.
- **Krockar** – varje smäll i sargen kostar 300 poäng.
- **Hinder** – konor som glömts kvar på isen måste rundas; att tippa en kostar
  150 poäng. Puckar är ofarliga – de skjuts iväg glidande över isen.
- **Rekord** – bästa resultatet sparas lokalt (localStorage).

## Teknik

- [Three.js](https://threejs.org/) + TypeScript + Vite, helt klientside.
- Spolningsprogressen är en dynamisk canvas-textur: skrapans bredd målas in i
  isens **roughness map** (matt sliten is → spegelblank nyspolad) och som en
  våt ton i färgkartan. Täckning och överlapp beräknas ur samma data via ett
  0,5 m-rutnät – progress, poäng och minimap faller ut ur en och samma källa.
- Rinken är 60 m lång med hörnradie 8,5 m och 30 m (Europa) eller 26 m
  (Nordamerika) bred; arena, målburar och maskinrumsport byggs om per nivå.
- Arenan eskalerar med nivåns `tier` (0–4): från en kall träningslada med
  synliga takstolar och ingen publik, via läktarskålar med växande publik, upp
  till en kupolförsedd storarena med dubbla läktarrader, jumbotron, strålkastare
  och hängande mästerskapsbanderoller. Allt parametriseras i `arena.ts`.
- Den drivbara ytan är en signed-distance-funktion: unionen av rinken och
  garagekorridoren. När porten öppnas låter den korridoren överlappa in i
  rinken så att infarten blir mjuk, utan osynlig vägg vid porten.
- **Fast tidssteg.** Simuleringen stegar i 120 Hz oberoende av skärmen, och
  varje bildruta ritas interpolerad mellan de två senaste stegen (zambonin,
  puckar, åkare, power-ups och parkeringsbilar). Fysik, kollisioner och poäng
  blir därmed identiska på 30, 60 eller 144 Hz, och rörelser är mjuka även på
  högfrekventa skärmar. All utjämning (kamera, styrning, glid) är exponentiell
  och bildfrekvensoberoende.
- Fordonsmodellen är en enkel cykelmodell med sidledes glid för iskänslan.
  Styrutslaget avtar med farten så maskinen inte blir ryckig i full fart, och
  karossen krängar, sätter sig och nigar på en fjäder (rent kosmetiskt).
  Kontakt mot sarg och mål: en riktig smäll bromsar en gång; att luta sig mot
  sargen ger en mjuk glidning längs den, så man kan köra tätt längs kanterna.
  Mot små saker (puckar, åkare) är zambonin en kapsel som följer karossen.
- Kameran: chase-vyn släpar efter i kurvor, drar sig bakåt och vidgar
  synfältet med farten och turbon; förarvyn följer karossens rörelser;
  översikten klipper bort tak och kuber. Byten mellan lägen, starten och
  målskärmen glider över i stället för att klippa.
- Adaptiv upplösning: om bildfrekvensen sjunker under ~42 fps sänks
  pixeltätheten stegvis (och återställs när det finns marginal). Hjälper ett
  steg inte, återställs det och anpassningen stängs av.
- Allt ljud syntetiseras med Web Audio – motorbrum (detunade sågtänder genom
  lågpass, varvtal följer farten), skrapljud (bandpassat brus när skrapan är
  nere), publiksorl, krocksmällar och måljingel. Inga ljudfiler behövs.
- Grafikassets (zamboni-GLB, sargreklam, publik, scoreboard) är AI-genererade
  via Higgsfield enligt stilkontraktet i `design/style.md`; allt laddas från
  `/assets` med graciös fallback till den procedurella looken om en fil
  saknas.

## Utveckling

```bash
npm run build    # typkoll + produktionsbygge till dist/
npm run preview  # servera produktionsbygget lokalt
```

`scripts/screenshot.mjs` kör spelet i headless Chromium (Playwright) och tar
skärmdumpar till `/tmp` för visuell verifiering. `scripts/verify.mjs` stegar
simulationen direkt via `__game.tick()` och testar spellogiken (konor, puckar,
målskärm, rekord) deterministiskt. `scripts/shots.mjs` iscensätter
nyckelögonblick (startvy, sväng, förarvy, översikt, parkering, paus) och
fotograferar dem, och `scripts/profile.mjs` mäter draw calls och CPU-tid per
nivå. Starta `npm run preview` först; peka
`PW_CHROMIUM_PATH` på en Chromium-binär om Playwrights egen inte är
installerad.

## Roadmap

- [x] Ljud: motor, skrapljud, publiksorl
- [x] Hinder på isen (puckar, konor) och fler saker att krocka med
- [x] Lokalt rekord (localStorage)
- [x] Riktig zamboni-modell (GLTF) i stället för den procedurella
- [x] AI-genererad arenagrafik: sargreklam, publik, scoreboard
- [x] Fler arenor – Div 5 till SHL plus bonusnivå, med maskinrumsport och målburar
- [x] Nivåprogression med stjärnor, upplåsning och stigande svårighetsgrad
- [x] Rinkstandard: Europa (30 m) eller Nordamerika (26 m)
- [ ] Co-op: två maskiner på samma is
- [ ] Onlineranking
