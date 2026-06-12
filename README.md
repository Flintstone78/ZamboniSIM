# ZamboniSIM 🧊🚜

Ett webbaserat simulatorspel där du kör ismaskin (zamboni) på hockeyarenor.
Spola hela isen så perfekt och snabbt som möjligt – men kör inte in i sargen!

## Spela

```bash
npm install
npm run dev
```

Öppna webbläsaren på adressen Vite skriver ut (normalt `http://localhost:5173`).

### Kontroller

| Tangent | Funktion |
| --- | --- |
| `W` / `↑` | Gas |
| `S` / `↓` | Broms / back |
| `A` `D` / `←` `→` | Styrning |
| `C` | Växla kamera (chase → förarvy → översikt) |
| `M` | Ljud av/på |
| `R` | Börja om |

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
- Rinken följer IIHF-mått (60×30 m, hörnradie 8,5 m); arenan runtomkring är
  utbytbar per bana.
- Fordonsmodellen är en enkel cykelmodell med sidledes glid för iskänslan.
- Allt ljud syntetiseras med Web Audio – motorbrum (detunade sågtänder genom
  lågpass, varvtal följer farten), skrapljud (bandpassat brus när skrapan är
  nere), publiksorl, krocksmällar och måljingel. Inga ljudfiler behövs.

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
- [ ] Fler arenor – från lokala ishallen till storarenan
- [ ] Riktig zamboni-modell (GLTF) i stället för den procedurella
- [ ] Nivåprogression med stigande svårighetsgrad
