# Stilkontrakt för genererade assets

Alla AI-genererade assets (Higgsfield) använder exakt samma stilformel,
byte-identiskt inklistrad i varje genereringsprompt. Ändra inte formeln för
enskilda assets – en ny stil kräver att alla assets genereras om.

## STYLE FORMULA

> crisp realistic 3D game render with clean PBR materials and grounded
> physical detail; solid, grounded silhouettes with no outlines; environment
> in cool arena whites and steel blues with charcoal-grey concrete and deep
> navy stands, the zamboni in saturated workshop blue with safety-yellow and
> chrome accents that pop against the white ice, obstacles and hazards marked
> in vivid traffic orange; bright, even stadium floodlighting with a cold
> clean atmosphere; high contrast between game elements and backgrounds,
> clean readable silhouettes, three-quarter isometric view on all concept
> assets

## STYLE TOKEN (för längdbegränsade fält, t.ex. texture_prompt)

> crisp realistic 3D game render, workshop-blue zamboni with safety-yellow
> and chrome accents, cold clean arena light

## Assetmanifest

| id | typ | fil | beskrivning |
|---|---|---|---|
| zamboni_3d | 3D-modell (GLB) | `public/assets/zamboni.glb` | Zambonin, image→3D (Meshy via Higgsfield) från `design/zamboni_concept.png`, 8 000 tris, texturerad |
| board_ads | textur (horisontellt sömlös) | `public/assets/board_ads.png` | Sargreklam med fiktiva sponsorer, beskuren för sömlös wrap (sömkvot 0,16) |
| crowd | textur (horisontellt sömlös) | `public/assets/crowd.png` | Publikrader till läktarna (sömkvot 0,48) |
| scoreboard | bild | `public/assets/scoreboard.png` | LED-skärmsgrafik till mediakuben |
| zamboni_concept | konceptbild | `design/zamboni_concept.png` | 3D-referens: en figur, vit bakgrund, trekvartsvy |

Hämtning: sandboxens nätverkspolicy blockerar Higgsfields CDN, så
`.github/workflows/fetch-assets.yml` (triggas av push till
`design/assets-to-fetch.txt`) laddar ner filerna på en Actions-runner och
committar dem till branchen.
