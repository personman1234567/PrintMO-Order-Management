# Garment recognition vectors

`garment-icons.svg` contains fourteen owner-supplied vector views. Original
filenames are recorded above each symbol. The source set consists of T-shirt,
pocket T-shirt, long-sleeve T-shirt, crewneck sweatshirt, hoodie and polo
front/back pairs, plus hat front/side views.

The paths, transforms and seam geometry are preserved. Export metadata and the
external SVG DTD are omitted. The T-shirt back's extra canvas margins are removed
through its symbol viewBox, without changing paths.

Source dark fills map to `--garment-ink`; light gray fills map to
`--garment-fill`; the hat's secondary gray maps to `--garment-shadow`.
`order-garment-summary.js` supplies an authored cloth/seam pair for each color family; dark cloth uses
a darker complementary seam rather than automatic white linework.
The hat uses the real side view rather than pretending it is a rear view.

The same module adds separate white-backed blue placement outlines over the
vectors. Their coordinates describe schematic areas, not artwork size or print
instructions. Unknown garment assignments and unspecified sleeve sides must not
be invented. Original product/color names remain visible in the summary.

When changing the sprite, update its content hash in `diagram()` so cached assets
cannot mix with a new release. Keep the model's icon dimensions synchronized with
the symbol viewBoxes. Run `node --test scripts/garment-summary.test.js` and inspect
the actual small card frames, including black, navy and white garments.
