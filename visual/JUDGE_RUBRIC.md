# Blind Dream Loop judge rubric

The judge receives only the anonymized A/B image pairs in the blind pack. Do **not**
read implementation code, commit messages, metrics, target filenames, or the answer
key until all scores are locked.

The task is not to choose the prettier image. For each anonymous pair, determine
how closely the two images describe the **same authored 3D scene**.

Score each lane independently from 0 to 5:

## Composition / camera

- 5 — framing, camera height/angle/FOV, major silhouettes, horizon/vanishing point,
  and negative-space distribution are nearly interchangeable.
- 3 — same scene idea and subject layout, but obvious camera/framing differences.
- 1 — only the broad concept matches.
- 0 — materially different composition.

## Geometry / structure

- 5 — dominant forms, topology, scale relationships, density, and foreground /
  midground / background structure closely match.
- 3 — major forms correspond but proportions/density/depth are substantially off.
- 1 — only a few semantic objects correspond.
- 0 — different structural scene.

## Materials / lighting

- 5 — palette, exposure, black point, highlights, emissive balance, reflections,
  fog, bloom, and material response closely match.
- 3 — correct palette family but substantial exposure/material differences.
- 1 — only broad hue/style is similar.
- 0 — materially different lighting/material treatment.

## Notes

Record the three largest mismatches in observable language. Examples:

- "camera is 2x too close; outer ring is clipped"
- "wet reflective floor is absent"
- "highlight area is much larger and clips to white"

Do not mention which side you think is the reference. Do not score website chrome;
the pack contains scene-only captures.

A single catastrophic lane may not be averaged away. Preserve all component scores.
