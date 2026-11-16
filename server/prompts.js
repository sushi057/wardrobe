// Prompt templates. Bump PROMPT_VERSION whenever a template changes: it is part of the render cache key.
export const PROMPT_VERSION = 4;

const CATEGORY_WORD = {
  top: 'top',
  bottom: 'bottom (trousers, jeans, shorts or skirt)',
  dress: 'dress / one-piece',
  outerwear: 'outerwear layer (jacket or coat)',
  shoes: 'pair of shoes',
  accessory: 'accessory',
};

const HOW_TO_WEAR = {
  top: 'replacing the top they currently wear',
  bottom: 'replacing the trousers/skirt they currently wear',
  dress: 'replacing both their current top and bottom',
  outerwear: 'worn open over the rest of the outfit',
  shoes: 'replacing their current shoes',
  accessory: 'added naturally where it belongs',
};

/** sheet=true: all garments are on ONE numbered sheet (Image 2), since Gemini web stalls with 3+ attachments. */
export function tryOnPrompt(garments, { sheet = false } = {}) {
  const lines = garments.map((g, i) => sheet
    ? `- Item ${i + 1} on the sheet: ${CATEGORY_WORD[g.category] || g.category}${g.name ? ` ("${g.name}")` : ''}, ${HOW_TO_WEAR[g.category] || 'worn naturally'}.`
    : `- Image ${i + 2}: ${CATEGORY_WORD[g.category] || g.category}${g.name ? ` ("${g.name}")` : ''}, ${HOW_TO_WEAR[g.category] || 'worn naturally'}.`);
  const covered = new Set(garments.map((g) => g.category));
  if (covered.has('dress')) { covered.add('top'); covered.add('bottom'); }
  const keep = ['top', 'bottom', 'shoes'].filter((c) => !covered.has(c));
  return [
    'Virtual try-on photo edit.',
    sheet
      ? 'Image 1 is a full-body photo of a real person. Image 2 is a product sheet with numbered clothing items (number in the top-left of each cell):'
      : 'Image 1 is a full-body photo of a real person. The other images are clothing items:',
    ...lines,
    sheet ? 'Edit Image 1 so the person is wearing ALL of these items at once.' : 'Edit Image 1 so the person is wearing these items.',
    'Keep EVERYTHING else exactly the same as Image 1: face, identity, expression, hair, skin tone, body shape and proportions, pose, hands, background, lighting, camera angle, framing and aspect ratio.',
    keep.length ? `Keep their current ${keep.join(', ')} unchanged.` : '',
    'Reproduce each garment faithfully: same colour, fabric, pattern, print, logos and details; realistic fit, drape and wrinkles for this body.',
    'Do not add any other clothing, accessories, text, numbers or watermark. Photorealistic. Return exactly one image.',
  ].filter(Boolean).join('\n');
}

export function cutoutPrompt(category, name) {
  const what = CATEGORY_WORD[category] || 'clothing item';
  return [
    `The attached photo shows a ${what}${name ? ` ("${name}")` : ''}.`,
    'Turn it into a clean e-commerce product photo of only this item, exactly as it is: same colour, fabric, pattern, print, logos and details. Do not redesign it.',
    'Show it neatly laid flat (ghost-mannequin style for garments), centred, filling most of the frame, on a pure white background (#FFFFFF), soft even studio lighting, subtle shadow.',
    'No person, no hanger, no props, no text. Square image. Return exactly one image.',
  ].join('\n');
}
