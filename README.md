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

Från startmenyn väljer du arena och rinkstandard. Du jobbar dig upp genom
divisionerna – **Div 5 → Div 2 → HockeyAllsvenskan → SHL** – där varje nivå har
kortare tid och fler hinder. Klara en nivå för att låsa upp nästa; ta tre
stjärnor på alla fyra för att låsa upp bonusnivån **Landslagscampen**.

Rinken kan köras i **Europa** (30 m bred) eller **Nordamerika** (smalare 26 m,
NHL-mått). Varje nivå börjar i maskinrummet – porten i sargen glider upp och du
kör ut på isen.

### Kontroller

| Tangent | Funktion |
| --- | --- |
| `W` / `↑` | Gas |
| `S` / `↓` | Broms / back |
| `A` `D` / `←` `→` | Styrning |
| `SPACE` | Skrapa upp / ner (spolar bara när den är nere) |
| `C` | Växla kamera (chase → förarvy → översikt) |
| `M` | Ljud av/på |
| `R` | Börja om |
| `ESC` | Tillbaka till menyn |

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
- Den drivbara ytan är en signed-distance-funktion: unionen av rinken och
  garagekorridoren. När porten öppnas låter den korridoren överlappa in i
  rinken så att infarten blir mjuk, utan osynlig vägg vid porten.
- Fordonsmodellen är en enkel cykelmodell med sidledes glid för iskänslan.
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
målskärm, rekord) deterministiskt. Starta `npm run preview` först; peka
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
